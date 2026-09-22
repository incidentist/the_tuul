# infra

Environment configuration that is applied by hand to external services, as
opposed to code that runs when the app does. Each file is applied by a mise
task where one exists; see the root README's Deploy section for when to run
them.

| File | Purpose | Applied by |
| --- | --- | --- |
| `gcs/cors.json` | CORS policy for the `SEPARATED_TRACKS_BUCKET` Google Cloud Storage bucket. Lets the browser on `the-tuul.com` and `beta.the-tuul.com` GET finished separation results straight from the bucket. | `mise run gcs-cors` |
| `compose-separation-provider/` | Docker Compose [provider service](https://github.com/docker/compose/blob/main/docs/extension.md) that runs the separator as a **host** process, so it can reach the Mac GPU. Compose starts it on `up` and stops it on `down`. `tuul-separator` is a shim that checks for `uv` and hands off to `provider.py`, which does the work. | `docker compose ... up` |
| `compose.selfhosted.yaml` | Self-hosted stack, CPU-only: the app in a single container, separating in-process. Runs on its own. | `mise run selfhosted` |
| `compose.selfhosted.cuda.yaml` | Overlay that hands the app container an NVIDIA GPU, so it separates with CUDA. | `mise run selfhosted-cuda` |
| `compose.selfhosted.host-gpu.yaml` | Overlay that moves separation to a **host** process via the provider above, for accelerators a container cannot reach (notably a Mac GPU). | `mise run selfhosted-host-gpu` |
| `Dockerfile.selfhosted` | Image for the self-hosted app container. | Built by the compose files above |

## Self-hosted stack

One base file plus two optional overlays. The base file runs by itself and is
CPU-only; each overlay adds one way of going faster. There is a mise task per
flavor, each taking a `docker compose` subcommand plus an optional `--build`:

```sh
mise run selfhosted --build            # CPU only
mise run selfhosted-cuda --build       # NVIDIA GPU, in the container
mise run selfhosted-host-gpu --build   # separation on the host (Mac)

mise run selfhosted-cuda down          # any compose subcommand works
```

The equivalent raw commands, which the tasks wrap:

```sh
# CPU only. Works everywhere, needs nothing but Docker, and is slow.
docker compose -f infra/compose.selfhosted.yaml up --build

# NVIDIA GPU, passed into the container.
docker compose -f infra/compose.selfhosted.yaml \
               -f infra/compose.selfhosted.cuda.yaml up --build

# Any other accelerator (notably a Mac GPU), by separating on the host.
PATH="$PWD/infra/compose-separation-provider:$PATH" \
  docker compose -f infra/compose.selfhosted.yaml \
                 -f infra/compose.selfhosted.host-gpu.yaml up --build
```

The image is the same in all three cases. What differs is where separation
happens and what it can reach:

| Stack | `SEPARATION_METHOD` | Separation runs | Execution provider |
| --- | --- | --- | --- |
| base | `api` | in the app container | `CPUExecutionProvider` |
| `+ cuda` | `api` | in the app container | `CUDAExecutionProvider` |
| `+ host-gpu` | `compose_provider` | on the host, over HTTP | whatever the host has |

### Requirements

- **cuda**: an NVIDIA GPU, its driver, and the [NVIDIA Container
  Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).
  Nothing extra goes into the image — on Linux the `selfhosted` dependency
  group already pulls `onnxruntime-gpu`, and the CUDA runtime libraries come
  with it as `nvidia-*` pip wheels, so the container carries its own CUDA
  userspace and only needs the device.
- **host-gpu**: Docker Compose v2.36+ (for provider services) and `uv` on the
  host. The `PATH` entry is how Compose finds the `tuul-separator` provider.

If the GPU is not visible at runtime, onnxruntime quietly falls back to
`CPUExecutionProvider` — separation still succeeds, just slowly. To check:

```sh
docker compose -f infra/compose.selfhosted.yaml -f infra/compose.selfhosted.cuda.yaml \
  exec app python -c "import onnxruntime; print(onnxruntime.get_available_providers())"
```

### Why a Mac needs the separator outside the container

Separation runs ONNX models, and the only GPU-backed onnxruntime execution
provider on a Mac is CoreML, which ships only in the macOS build. A Linux
container cannot reach Metal at all — that is true of Docker and of Apple's
`container` alike, and Apple closed the request for it as `wontfix`. Docker ran
into the same wall building Model Runner and put it plainly: "there is no GPU
passthrough for Metal in containers."

So the separator has to be a host process. What Compose's provider services buy
us is that it doesn't have to be a *separate setup step*: `tuul-separator` is
declared in the compose file like any other service, Compose runs it on the
host, and it reports its URL back with a `setenv` message that Compose injects
as `SEPARATOR_URL` into the app container. One `docker compose up` brings up
both; one `down` stops both.

The app reaches the host at `host.docker.internal`. On Linux, override the
provider's `hostname` option to `172.17.0.1`.

### How the provider is put together

Two files, split by what they need to be able to import:

| File | Role |
| --- | --- |
| `tuul-separator` | ~20 lines of bash. Checks that `uv` is on `PATH` and, if not, emits an `error` message and exits non-zero — which is how the provider protocol fails `docker compose up`, rather than starting the app against a separator that will never arrive. Then `exec`s into Python. |
| `provider.py` | Everything else: argument parsing, the pidfile, the `uv sync`, spawning and stopping the server, health checks, and the JSON protocol. |

`provider.py` runs under `uv run --no-project --isolated`, so it may import only
the standard library — it starts in ~50ms and reports progress before the slow
work begins. The heavyweight environment (audio-separator, torch, onnxruntime)
belongs to the separator it spawns, not to the supervisor.

`--isolated` is load-bearing rather than tidiness: `--no-project` alone still
honours an active `VIRTUAL_ENV`, which mise sets in this repo. Without it the
supervisor would import the project environment on a developer's machine and
stdlib-only on a fresh user's — working here and breaking there.

Two details are forced by the protocol. `up` is synchronous — Compose reads
stdout until the process exits — so the server is double-forked into its own
session and the supervisor returns once it is healthy. And every message is
flushed, because Python block-buffers when stdout is a pipe, which is exactly
how Compose invokes us; unflushed progress would never reach the UI.

The binary has to keep the name `tuul-separator`: `provider.type` in
`compose.selfhosted.host-gpu.yaml` resolves it by name on `PATH`.

### The host-gpu overlay is not macOS-only

A Mac is the case that *forces* the split, but the overlay is worth using on
any host where you would rather not pass the GPU into a container: because the
separator runs on the host, it uses whatever acceleration that machine has,
with no container toolkit. The provider runs `uv sync --group selfhosted`, and
that group picks the right onnxruntime wheel per platform:

| Host | Wheel | Execution provider |
| --- | --- | --- |
| Linux / Windows + NVIDIA | `onnxruntime-gpu` (`[gpu]` extra) | `CUDAExecutionProvider` |
| macOS (Apple Silicon) | `onnxruntime` (`[cpu]` extra) | `CoreMLExecutionProvider` |
| Anything else | either | `CPUExecutionProvider` |

The extra names mislead: `[gpu]` means *CUDA specifically*, and
`onnxruntime-gpu` publishes no macOS wheel at all. It doesn't need one — the
plain wheel that `[cpu]` pulls already contains CoreML, the Apple GPU/ANE path.
So on a Mac, `[cpu]` is what gives you the GPU.

`audio-separator` detects this at runtime (`setup_torch_device`) and selects
CUDA, then CoreML, then DirectML, falling back to CPU when a host has no GPU —
so an accelerator-less machine still works, just slower.
