#!/usr/bin/env python3
"""
Docker Compose provider that runs the Tuul separator as a *host* process.

Linux containers on macOS cannot reach the Metal GPU -- onnxruntime's
CoreMLExecutionProvider only exists in the macOS build -- so separation inside
the container is always CPU-bound. Compose's provider services let us declare
the separator in compose.yaml anyway: Compose runs this script on the host
instead of starting a container, and injects the URL we report back into any
service that `depends_on` us.

Protocol: https://github.com/docker/compose/blob/main/docs/extension.md
  - MUST accept `compose up` / `compose down` subcommands
  - provider.options arrive as --flags
  - communicate via newline-delimited JSON on stdout
  - `up` is synchronous: Compose reads stdout until we exit, so the server has
    to be detached before we return.

Run by the `tuul-separator` shim with `uv run --no-project --isolated`, so ONLY
the standard library is importable here. The heavyweight environment
(audio-separator, torch, onnxruntime) belongs to the server we spawn, not to us.
"""

import argparse
import errno
import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import NoReturn

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# How long to wait for the server to stop after SIGTERM before SIGKILLing it.
SHUTDOWN_TIMEOUT = 10

# How often to poll the health endpoint while waiting for startup.
HEALTH_POLL_INTERVAL = 1.0

# Per-request timeout for a health poll. Short: we retry in a loop anyway.
HEALTH_TIMEOUT = 2


# --- Compose protocol --------------------------------------------------------


def emit(message_type: str, message: str) -> None:
    """Write one newline-delimited JSON message to Compose.

    Compose reads stdout incrementally, but Python block-buffers when stdout is
    a pipe -- which is exactly how Compose invokes us. Without the flush,
    progress messages would sit in the buffer instead of reaching the UI.
    """
    print(json.dumps({"type": message_type, "message": message}), flush=True)


def info(message: str) -> None:
    emit("info", message)


def debug(message: str) -> None:
    emit("debug", message)


def fail(message: str) -> NoReturn:
    """Report failure and exit non-zero, which fails `docker compose up`."""
    emit("error", message)
    sys.exit(1)


# --- Arguments ---------------------------------------------------------------


def parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse the argv Compose hands us.

    Compose invokes us as:
        tuul-separator compose --project-name <NAME> up --port=8001 <SERVICE>

    `provider.options` from the compose file arrive as --flags, so anything we
    do not recognise is another option we simply do not use -- ignore it rather
    than failing.
    """
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--project-name", default="")
    parser.add_argument("--port", default="8001")
    parser.add_argument("--hostname", default="host.docker.internal")
    parser.add_argument("--startup-timeout", type=int, default=120)

    args, extra = parser.parse_known_args(argv)

    # What is left is positional: the literal "compose", the up/down/stop verb,
    # and the service name. Unknown --flags are ignored.
    positionals = [a for a in extra if not a.startswith("-")]
    if not positionals or positionals[0] != "compose":
        fail(f"expected 'compose' subcommand, got {positionals[:1] or ['nothing']}")

    commands = [p for p in positionals[1:] if p in ("up", "down", "stop")]
    if not commands:
        fail("expected 'up', 'down' or 'stop'")
    args.command = commands[0]

    for flag in (a for a in extra if a.startswith("-")):
        debug(f"ignoring unknown flag: {flag}")

    return args


# --- State -------------------------------------------------------------------


class State:
    """Where we track the running server, namespaced so two checkouts can run
    side by side."""

    def __init__(self, project_name: str) -> None:
        base = Path(os.environ.get("TMPDIR", "/tmp")) / "tuul-separator"
        self.dir = base / (project_name or "default")
        self.pid_file = self.dir / "separator.pid"
        self.log_file = self.dir / "separator.log"

    def read_pid(self) -> int | None:
        try:
            return int(self.pid_file.read_text().strip())
        except (FileNotFoundError, ValueError):
            return None

    def running_pid(self) -> int | None:
        """The PID of the live server, or None if nothing is running."""
        pid = self.read_pid()
        if pid is None:
            return None
        try:
            os.kill(pid, 0)
        except OSError as e:
            # ESRCH: gone. EPERM: alive but not ours, which still counts.
            if e.errno == errno.ESRCH:
                return None
            if e.errno != errno.EPERM:
                raise
        return pid

    def clear(self) -> None:
        self.pid_file.unlink(missing_ok=True)


# --- Health ------------------------------------------------------------------


def is_healthy(port: str) -> bool:
    """Ask the server on localhost whether it is up.

    We health-check 127.0.0.1 even though containers reach the server via
    host.docker.internal -- that name means nothing from the host side.
    """
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/health", timeout=HEALTH_TIMEOUT
        ) as response:
            return response.status == 200
    except (urllib.error.URLError, OSError):
        return False


def wait_until_healthy(state: State, port: str, timeout: int) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if is_healthy(port):
            return True
        # If the process died there is nothing left to wait for.
        if state.running_pid() is None:
            return False
        time.sleep(HEALTH_POLL_INTERVAL)
    return False


# --- Spawning ----------------------------------------------------------------

SERVER_COMMAND = [
    "uv",
    "run",
    "--group",
    "selfhosted",
    "--locked",
    "python",
    "-m",
    "api.separator_server",
]


def spawn_detached(port: str, log_file: Path) -> int:
    """Start the separator so it outlives us, and return ITS pid.

    Compose reads our stdout until we exit, so the server cannot be an ordinary
    child -- we have to detach it and return. Double-fork: the middle process
    calls setsid() to leave our session, then forks the server and reports the
    server's own pid back through a pipe before exiting.

    Reporting the real pid matters. `uv run` execs python as a *child*, so the
    obvious pid to record is uv's wrapper rather than the server, which is why
    stopping it used to need process-group signalling. With the true pid, a
    plain kill() is enough.
    """
    read_fd, write_fd = os.pipe()

    middle_pid = os.fork()
    if middle_pid == 0:
        # --- middle process ---
        try:
            os.close(read_fd)
            os.setsid()  # new session: survives our exit, detaches the terminal

            server_pid = os.fork()
            if server_pid > 0:
                os.write(write_fd, str(server_pid).encode())
                os.close(write_fd)
                os._exit(0)

            # --- server process ---
            os.close(write_fd)
            os.chdir(REPO_ROOT)
            with open(os.devnull, "rb") as devnull, open(log_file, "ab") as log:
                os.dup2(devnull.fileno(), sys.stdin.fileno())
                os.dup2(log.fileno(), sys.stdout.fileno())
                os.dup2(log.fileno(), sys.stderr.fileno())
            os.environ["SEPARATOR_PORT"] = port
            os.execvp(SERVER_COMMAND[0], SERVER_COMMAND)
        except BaseException:
            os._exit(1)

    # --- provider process ---
    os.close(write_fd)
    os.waitpid(middle_pid, 0)  # reap the middle process; the server lives on
    with os.fdopen(read_fd, "rb") as pipe:
        raw = pipe.read().strip()

    if not raw:
        raise RuntimeError("failed to start the separator process")
    return int(raw)


# --- Commands ----------------------------------------------------------------


def separator_url(hostname: str, port: str) -> str:
    return f"http://{hostname}:{port}"


def cmd_up(args: argparse.Namespace, state: State) -> None:
    state.dir.mkdir(parents=True, exist_ok=True)

    # `compose up` MUST be idempotent: if it is already running, report the same
    # URL rather than starting a second copy.
    if state.running_pid() is not None:
        info(f"separator already running on port {args.port}")
        emit("setenv", f"URL={separator_url(args.hostname, args.port)}")
        return

    # The `selfhosted` group carries audio-separator with the right onnxruntime
    # wheel for THIS machine: onnxruntime-gpu (CUDA) on Linux/Windows, plain
    # onnxruntime (which ships CoreML) on macOS. audio-separator then autodetects
    # and uses whatever acceleration the host actually has, falling back to CPU.
    #
    # `uv run` would sync this anyway, but doing it as its own step lets us say
    # what is happening first: a cold run downloads torch and onnxruntime and
    # takes minutes, and Compose shows nothing until we print something.
    info("syncing host Python environment (first run downloads ~1GB, be patient)")
    with open(state.log_file, "ab") as log:
        sync = subprocess.run(
            ["uv", "sync", "--group", "selfhosted", "--locked"],
            cwd=REPO_ROOT,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
    if sync.returncode != 0:
        fail(f"uv sync failed. See {state.log_file}")

    info(f"starting separator on port {args.port}")
    try:
        pid = spawn_detached(args.port, state.log_file)
    except (OSError, RuntimeError) as e:
        fail(f"could not start the separator: {e}. See {state.log_file}")
    state.pid_file.write_text(str(pid))

    if not wait_until_healthy(state, args.port, args.startup_timeout):
        stop_process(pid)
        state.clear()
        fail(
            f"separator failed to become healthy within {args.startup_timeout}s. "
            f"See {state.log_file}"
        )

    info(f"separator ready on port {args.port}")
    emit("setenv", f"URL={separator_url(args.hostname, args.port)}")


def stop_process(pid: int) -> None:
    """SIGTERM, wait, then SIGKILL."""
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        return

    deadline = time.monotonic() + SHUTDOWN_TIMEOUT
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except OSError:
            return
        time.sleep(0.5)

    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        pass


def cmd_down(args: argparse.Namespace, state: State) -> None:
    pid = state.running_pid()
    if pid is None:
        info("separator not running")
        state.clear()
        return

    info(f"stopping separator (pid {pid})")
    stop_process(pid)
    state.clear()
    info("separator stopped")


def main(argv: list[str]) -> None:
    args = parse_args(argv)
    state = State(args.project_name)

    if args.command == "up":
        cmd_up(args, state)
    else:  # down, stop
        cmd_down(args, state)


if __name__ == "__main__":
    main(sys.argv[1:])
