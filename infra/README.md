# infra

Environment configuration that is applied by hand to external services, as
opposed to code that runs when the app does. Each file is applied by a mise
task where one exists; see the root README's Deploy section for when to run
them.

| File | Purpose | Applied by |
| --- | --- | --- |
| `gcs/cors.json` | CORS policy for the `SEPARATED_TRACKS_BUCKET` Google Cloud Storage bucket. Lets the browser on `the-tuul.com` and `beta.the-tuul.com` GET finished separation results straight from the bucket. | `mise run gcs-cors` |
| `compose-separation-provider/` | Docker Compose [provider service](https://github.com/docker/compose/blob/main/docs/extension.md) that runs the separator as a **host** process, so it can reach the Mac GPU. Compose starts it on `up` and stops it on `down`. `tuul-separator` is a shim that checks for `uv` and hands off to `provider.py`, which does the work. | `docker compose ... up` |
| `../compose.yaml` | Self-hosted stack, CPU-only: the app in a single container, separating in-process. Runs on its own. | `mise run selfhosted` |
| `../compose.cuda.yaml` | Overlay that builds the CUDA image and hands the app container an NVIDIA GPU, so it separates with CUDA. | `mise run selfhosted-cuda` |
| `../compose.host-gpu.yaml` | Overlay that moves separation to a **host** process via the provider above, for accelerators a container cannot reach (notably a Mac GPU). | `mise run selfhosted-host-gpu` |
| `deploy_modal.py` | The audio-separator API as a [Modal](https://modal.com) app, which the API server calls when `SEPARATION_METHOD=modal_api`. Each separation runs on a serverless GPU. | `modal deploy infra/deploy_modal.py` |

The compose files live in the repo root, next to the `Dockerfile` they build,
so a plain `docker compose up` works. The `Dockerfile` is the same one
production builds; its `TORCH_GROUP` build arg picks the `cpu` (default) or
`cuda` dependency group.

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
docker compose -f compose.yaml up --build

# NVIDIA GPU, passed into the container.
docker compose -f compose.yaml \
               -f compose.cuda.yaml up --build

# Any other accelerator (notably a Mac GPU), by separating on the host.
PATH="$PWD/infra/compose-separation-provider:$PATH" \
  docker compose -f compose.yaml \
                 -f compose.host-gpu.yaml up --build
```

What differs is which image runs, where separation happens and what it can
reach:

| Stack | Image | `SEPARATION_METHOD` | Separation runs | Execution provider |
| --- | --- | --- | --- | --- |
| base | `the-tuul:cpu` | `api` | in the app container | `CPUExecutionProvider` |
| `+ cuda` | `the-tuul:cuda` | `api` | in the app container | `CUDAExecutionProvider` |
| `+ host-gpu` | `the-tuul:cpu` | `compose_provider` | on the host, over HTTP | whatever the host has |

The CPU image installs torch from PyTorch's CPU-only index. PyPI's Linux torch
wheel depends on the whole CUDA stack, which is most of the CUDA image's size;
the CPU image never touches it.

### Requirements

- **cuda**: an NVIDIA GPU, its driver, and the [NVIDIA Container
  Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).
  The overlay builds with `TORCH_GROUP=cuda`, which installs CUDA 13 torch and
  `onnxruntime-gpu`. The CUDA runtime libraries come with them as `nvidia-*`
  pip wheels, so the container carries its own CUDA userspace and the host
  needs only the device and a driver new enough for CUDA 13 (580+). CUDA 13
  does not support Pascal or Volta GPUs (GTX 10-series and older).
- **host-gpu**: Docker Compose v2.36+ (for provider services) and `uv` on the
  host. The `PATH` entry is how Compose finds the `tuul-separator` provider.

If the GPU is not visible at runtime, onnxruntime quietly falls back to
`CPUExecutionProvider` — separation still succeeds, just slowly. To check:

```sh
docker compose -f compose.yaml -f compose.cuda.yaml \
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
`compose.host-gpu.yaml` resolves it by name on `PATH`.

### The host-gpu overlay is not macOS-only

A Mac is the case that *forces* the split, but the overlay is worth using on
any host where you would rather not pass the GPU into a container: because the
separator runs on the host, it uses whatever acceleration that machine has,
with no container toolkit. The provider runs `uv sync` with the dependency
group that fits the host:

| Host | Group | Wheels | Execution provider |
| --- | --- | --- | --- |
| Linux with `nvidia-smi` on `PATH` | `cuda` | CUDA torch, `onnxruntime-gpu` | `CUDAExecutionProvider` |
| macOS (Apple Silicon) | `cpu` (default) | PyPI torch, `onnxruntime` | `CoreMLExecutionProvider` |
| Anything else | `cpu` (default) | CPU torch, `onnxruntime` | `CPUExecutionProvider` |

The group names mislead on a Mac: `onnxruntime-gpu` publishes no macOS wheel
at all, and it doesn't need one — the plain `onnxruntime` wheel in `cpu`
already contains CoreML, the Apple GPU/ANE path. So on a Mac, `cpu` is what
gives you the GPU.

`audio-separator` detects this at runtime (`setup_torch_device`) and selects
CUDA, then CoreML, then DirectML, falling back to CPU when a host has no GPU —
so an accelerator-less machine still works, just slower.

## Modal separator

`deploy_modal.py` deploys the audio-separator HTTP API to Modal as the app
`audio-separator`. The API server's `modal_api` separation method talks to it
through audio-separator's own `AudioSeparatorAPIClient`: it uploads the song to
`/separate`, polls `/status/{task_id}`, and downloads the stems from
`/download/{task_id}/{file_hash}`. Separation runs in `separate_audio_function`
on a GPU; the web endpoints run in `api()` on CPU. Job status lives in the
Modal Dict `audio-separator-job-status`, and uploads and stems are kept in the
Volume `audio-separator-storage`. Downloaded models are cached in the Volume
`audio-separator-models`.

```sh
modal deploy infra/deploy_modal.py     # deploy, or redeploy to the same URL
modal app logs audio-separator         # tail the deployed app's logs
modal app rollback audio-separator     # go back to the previous version
modal serve infra/deploy_modal.py      # a temporary copy at ...-api-dev.modal.run
```

`modal serve` is the way to test a change before deploying it: point
`SEPARATOR_MODAL_API_URL` at the `-dev` URL it prints and separate a song. The
temporary copy uses the same named Dict and Volumes as the deployed app, so
test jobs show up alongside real ones. Stop it when you're done; if it still
lists running tasks in `modal app list`, stop it with `modal app stop`.

Web and container-only imports (`fastapi`, `audio_separator`, `filetype`) sit
under `with image.imports()`, and the FastAPI app is built by
`create_web_app()` inside `api()`. That is so the bare `modal` CLI can import
the file to deploy it without any of those packages installed locally.

### Cost

Modal bills by the second for whatever GPU each container gets, including the
time a container sits idle waiting for more work. Two settings on
`separate_audio_function` keep that down:

- `gpu=["T4", "L4"]`: T4 is Modal's cheapest GPU and has plenty of headroom for
  the small ONNX models; L4 is the fallback when T4s are scarce. `gpu="ANY"`
  often landed on L40S and A10G instead, at roughly 2–3x the price.
- `scaledown_window=60`: songs arrive one at a time and rarely reuse a warm
  container, so a longer window mostly bills idle GPU time.

`modal billing report --for "this month" --show-resources` breaks the bill
down by GPU type.

### The image

The image is `debian_slim` with ffmpeg and a few audio libraries, not a CUDA
base image. Modal provides the NVIDIA driver, and torch's pip wheels bring the
CUDA runtime libraries, which `onnxruntime-gpu` picks up because
audio-separator imports torch first. If that ever breaks, onnxruntime quietly
falls back to the CPU and separation just gets slow, so after changing the
image check that the logs say `CUDAExecutionProvider available, enabling
acceleration`.

Python dependencies are pinned exactly. audio-separator leaves its own
dependencies unbounded, and librosa 1.0 broke a rebuild once already. Bump
`torch` and `onnxruntime-gpu` together, since onnxruntime runs on torch's CUDA
libraries.

Two details keep a cold start short:

- **Uploads are decoded to WAV with ffmpeg before separation.** librosa 1.0
  only reads what libsndfile can, which leaves out m4a, aac and webm, the
  formats songs from YouTube usually arrive in.
- **The build step `import librosa.util.utils` compiles librosa's numba
  functions into the image.** They take ~30s to compile on first use, which
  would otherwise land on every new container. `NUMBA_CPU_NAME=generic` keeps
  that cache valid on the GPU hosts, whose CPUs differ from the build
  machine's.
