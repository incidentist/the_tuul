"""Tests for the Docker Compose provider that runs the separator on the host.

The provider lives outside the `api` package (it is deliberately stdlib-only, so
it can run under `uv run --isolated` without the project environment), so we load
it by path rather than importing it.
"""

import importlib.util
import json
import os
import signal
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock

import pytest

PROVIDER_PATH = (
    Path(__file__).resolve().parents[2]
    / "infra"
    / "compose-separation-provider"
    / "provider.py"
)


def _load_provider():
    spec = importlib.util.spec_from_file_location("tuul_provider", PROVIDER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


provider = _load_provider()


@pytest.fixture
def state(tmp_path, monkeypatch):
    """A State rooted in tmp_path rather than the real TMPDIR."""
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    st = provider.State("testproject")
    st.dir.mkdir(parents=True, exist_ok=True)
    return st


def emitted(capsys):
    """The JSON messages written to stdout, parsed."""
    return [json.loads(line) for line in capsys.readouterr().out.splitlines() if line]


# --- protocol ----------------------------------------------------------------


def test_emit_writes_one_json_object_per_line(capsys):
    provider.info("first")
    provider.info("second")

    messages = emitted(capsys)
    assert messages == [
        {"type": "info", "message": "first"},
        {"type": "info", "message": "second"},
    ]


def test_emit_escapes_characters_that_would_break_the_stream(capsys):
    provider.info('has "quotes", a \\ backslash and a\nnewline')

    # The point is that it survives as ONE line and round-trips.
    out = capsys.readouterr().out
    assert len(out.strip().splitlines()) == 1
    assert json.loads(out)["message"] == 'has "quotes", a \\ backslash and a\nnewline'


def test_fail_emits_error_and_exits_nonzero(capsys):
    with pytest.raises(SystemExit) as exc:
        provider.fail("it broke")

    assert exc.value.code == 1
    assert emitted(capsys) == [{"type": "error", "message": "it broke"}]


# --- argument parsing --------------------------------------------------------


def test_parses_the_argv_compose_actually_sends():
    """Compose invokes us as: compose --project-name X up --port=8001 <service>."""
    args = provider.parse_args(
        [
            "compose",
            "--project-name",
            "the-tuul",
            "up",
            "--port=8001",
            "--hostname=host.docker.internal",
            "--startup-timeout=120",
            "separator",
        ]
    )

    assert args.command == "up"
    assert args.project_name == "the-tuul"
    assert args.port == "8001"
    assert args.hostname == "host.docker.internal"
    assert args.startup_timeout == 120


@pytest.mark.parametrize("command", ["up", "down", "stop"])
def test_parses_each_supported_command(command):
    args = provider.parse_args(["compose", "--project-name", "p", command, "separator"])

    assert args.command == command


def test_accepts_both_flag_spellings():
    """provider.options may arrive as --flag value or --flag=value."""
    spaced = provider.parse_args(["compose", "up", "--port", "9000"])
    equals = provider.parse_args(["compose", "up", "--port=9000"])

    assert spaced.port == equals.port == "9000"


def test_uses_defaults_when_options_are_omitted():
    args = provider.parse_args(["compose", "up", "separator"])

    assert args.port == "8001"
    assert args.hostname == "host.docker.internal"
    assert args.startup_timeout == 120
    assert args.project_name == ""


def test_ignores_options_it_does_not_use(capsys):
    """Unknown provider.options are somebody else's business, not an error."""
    args = provider.parse_args(["compose", "up", "--some-future-option=1", "separator"])

    assert args.command == "up"
    assert any(m["type"] == "debug" for m in emitted(capsys))


def test_rejects_argv_that_does_not_start_with_compose(capsys):
    with pytest.raises(SystemExit):
        provider.parse_args(["not-compose", "up"])

    assert emitted(capsys)[-1]["type"] == "error"


def test_rejects_a_missing_command(capsys):
    with pytest.raises(SystemExit):
        provider.parse_args(["compose", "--project-name", "p", "separator"])

    assert emitted(capsys)[-1]["type"] == "error"


# --- url ---------------------------------------------------------------------


def test_builds_the_url_containers_use_to_reach_the_host():
    assert (
        provider.separator_url("host.docker.internal", "8001")
        == "http://host.docker.internal:8001"
    )
    # Linux hosts override the hostname to the bridge address.
    assert provider.separator_url("172.17.0.1", "9000") == "http://172.17.0.1:9000"


# --- state -------------------------------------------------------------------


def test_running_pid_is_none_without_a_pidfile(state):
    assert state.running_pid() is None


def test_running_pid_finds_a_live_process(state):
    state.pid_file.write_text(str(os.getpid()))

    assert state.running_pid() == os.getpid()


def test_running_pid_is_none_when_the_process_is_gone(state):
    # A pid that exited: spawn one and reap it, so we know it is dead.
    dead = subprocess.Popen(["true"])
    dead.wait()
    state.pid_file.write_text(str(dead.pid))

    assert state.running_pid() is None


def test_running_pid_survives_a_corrupt_pidfile(state):
    state.pid_file.write_text("not-a-pid")

    assert state.running_pid() is None


# --- health ------------------------------------------------------------------


class _HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        status = 200 if self.path == "/health" else 404
        self.send_response(status)
        self.end_headers()
        self.wfile.write(b'{"status": "ok"}')

    def log_message(self, *args):
        pass  # keep the test output clean


@pytest.fixture
def health_server():
    """A real HTTP server on a real port, so the check is not mocked away."""
    server = HTTPServer(("127.0.0.1", 0), _HealthHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield str(server.server_port)
    server.shutdown()
    server.server_close()


def test_is_healthy_when_the_server_answers(health_server):
    assert provider.is_healthy(health_server) is True


def test_is_not_healthy_when_nothing_is_listening():
    # Port 1 is privileged and unused; nothing will answer.
    assert provider.is_healthy("1") is False


def test_wait_until_healthy_returns_as_soon_as_it_answers(state, health_server):
    state.pid_file.write_text(str(os.getpid()))

    assert provider.wait_until_healthy(state, health_server, timeout=5) is True


def test_wait_until_healthy_gives_up_when_the_process_died(state):
    dead = subprocess.Popen(["true"])
    dead.wait()
    state.pid_file.write_text(str(dead.pid))

    # Returns promptly rather than burning the whole timeout.
    assert provider.wait_until_healthy(state, "1", timeout=30) is False


# --- up ----------------------------------------------------------------------


def test_up_is_idempotent_when_already_running(state, capsys):
    """The protocol requires `up` on a running service to re-report the same URL."""
    state.pid_file.write_text(str(os.getpid()))
    args = provider.parse_args(["compose", "up", "--port=8001"])

    with mock.patch.object(provider, "spawn_detached") as spawn:
        with mock.patch.object(provider.subprocess, "run") as run:
            provider.cmd_up(args, state)

    spawn.assert_not_called()
    run.assert_not_called()  # no second sync either
    assert {"type": "setenv", "message": "URL=http://host.docker.internal:8001"} in (
        emitted(capsys)
    )


def test_up_reports_a_failed_sync_and_does_not_start_the_server(state, capsys):
    args = provider.parse_args(["compose", "up"])

    with mock.patch.object(provider, "spawn_detached") as spawn:
        with mock.patch.object(
            provider.subprocess, "run", return_value=subprocess.CompletedProcess([], 1)
        ):
            with pytest.raises(SystemExit):
                provider.cmd_up(args, state)

    spawn.assert_not_called()
    assert emitted(capsys)[-1]["type"] == "error"


def test_up_emits_setenv_after_a_healthy_start(state, capsys):
    args = provider.parse_args(["compose", "up", "--port=8001"])

    with mock.patch.object(
        provider.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)
    ):
        with mock.patch.object(provider, "spawn_detached", return_value=4321):
            with mock.patch.object(provider, "wait_until_healthy", return_value=True):
                provider.cmd_up(args, state)

    messages = emitted(capsys)
    assert messages[-1] == {
        "type": "setenv",
        "message": "URL=http://host.docker.internal:8001",
    }
    assert state.read_pid() == 4321


def test_up_cleans_up_when_the_server_never_becomes_healthy(state, capsys):
    args = provider.parse_args(["compose", "up", "--startup-timeout=1"])

    with mock.patch.object(
        provider.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)
    ):
        with mock.patch.object(provider, "spawn_detached", return_value=4321):
            with mock.patch.object(provider, "wait_until_healthy", return_value=False):
                with mock.patch.object(provider, "stop_process") as stop:
                    with pytest.raises(SystemExit):
                        provider.cmd_up(args, state)

    stop.assert_called_once_with(4321)
    assert state.read_pid() is None  # no stale pidfile left behind
    assert emitted(capsys)[-1]["type"] == "error"


def test_up_warns_before_the_slow_sync(state, capsys):
    """A cold sync takes minutes; say so before starting it, not after."""
    args = provider.parse_args(["compose", "up"])

    with mock.patch.object(
        provider.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)
    ):
        with mock.patch.object(provider, "spawn_detached", return_value=1):
            with mock.patch.object(provider, "wait_until_healthy", return_value=True):
                provider.cmd_up(args, state)

    messages = emitted(capsys)
    assert "syncing" in messages[0]["message"]
    assert messages[0]["type"] == "info"


# --- down --------------------------------------------------------------------


def test_down_is_a_clean_noop_when_nothing_is_running(state, capsys):
    args = provider.parse_args(["compose", "down"])

    provider.cmd_down(args, state)  # must not raise

    assert emitted(capsys) == [{"type": "info", "message": "separator not running"}]


def test_down_stops_the_running_server_and_clears_the_pidfile(state, capsys):
    state.pid_file.write_text(str(os.getpid()))
    args = provider.parse_args(["compose", "down"])

    with mock.patch.object(provider, "stop_process") as stop:
        provider.cmd_down(args, state)

    stop.assert_called_once_with(os.getpid())
    assert state.read_pid() is None


def test_down_removes_a_stale_pidfile(state):
    dead = subprocess.Popen(["true"])
    dead.wait()
    state.pid_file.write_text(str(dead.pid))
    args = provider.parse_args(["compose", "down"])

    provider.cmd_down(args, state)

    assert not state.pid_file.exists()


def test_stop_process_escalates_to_sigkill_when_sigterm_is_ignored(monkeypatch):
    """A server that ignores SIGTERM still has to die."""
    monkeypatch.setattr(provider, "SHUTDOWN_TIMEOUT", 0.1)
    signals = []

    def fake_kill(pid, sig):
        signals.append(sig)  # never "dies": kill(pid, 0) keeps succeeding

    monkeypatch.setattr(provider.os, "kill", fake_kill)

    provider.stop_process(1234)

    assert signals[0] == signal.SIGTERM
    assert signals[-1] == signal.SIGKILL


# --- spawning ----------------------------------------------------------------


def test_spawn_detached_returns_a_live_pid_that_outlives_us(tmp_path, monkeypatch):
    """The real double-fork: the server must survive and be killable by pid.

    Compose reads our stdout until we exit, so the server cannot be an ordinary
    child. Substitute a sleep for the real server; everything else is real.
    """
    monkeypatch.setattr(provider, "SERVER_COMMAND", ["sleep", "30"])
    log = tmp_path / "separator.log"

    pid = provider.spawn_detached("8001", log)

    try:
        os.kill(pid, 0)  # alive, and addressable by this pid alone
    finally:
        os.kill(pid, signal.SIGKILL)
        try:
            os.waitpid(pid, 0)
        except ChildProcessError:
            pass  # reparented to init, which is the point


def test_spawn_detached_reports_the_server_not_a_wrapper(tmp_path, monkeypatch):
    """The pid we record must be the process we can actually signal.

    The old bash version recorded the `uv` wrapper instead, and had to signal
    the whole process group to compensate. A plain SIGTERM must be enough.
    """
    monkeypatch.setattr(provider, "SERVER_COMMAND", ["sleep", "30"])

    pid = provider.spawn_detached("8001", tmp_path / "log")

    # Detached: in a new session, so it is not in our process group and will
    # not be taken down with us.
    assert os.getsid(pid) != os.getsid(os.getpid())
    assert os.getpgid(pid) != os.getpgid(os.getpid())

    os.kill(pid, signal.SIGTERM)
    for _ in range(40):
        try:
            os.kill(pid, 0)
        except OSError:
            break
        time.sleep(0.05)
    else:
        os.kill(pid, signal.SIGKILL)
        pytest.fail("SIGTERM to the reported pid did not stop the server")
