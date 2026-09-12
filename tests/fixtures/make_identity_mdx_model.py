"""Generate identity_mdx_kara2.onnx, a stand-in for the real UVR_MDXNET_KARA_2 model.

The e2e suite serves this file in place of the Hugging Face download so that
web-audio-separation runs its whole pipeline in the browser without fetching
30MB of weights. It has the same tensor names and shapes as the real MDX-Net
model (input "input", output "output", float32 [batch, 4, dim_f, dim_t]) but
just passes the spectrogram through, so the "separated" stems are the mix and
near-silence. That is enough for the app to carry on and build a video.

Run with:  uv run python tests/fixtures/make_identity_mdx_model.py
"""

from pathlib import Path

import onnx
from onnx import TensorProto, helper

# From web-audio-separation's MODEL_REGISTRY entry for UVR_MDXNET_KARA_2:
# mdx_dim_f_set = 2048, mdx_dim_t_set = 8 (dim_t = 2 ** 8).
DIM_F = 2048
DIM_T = 2**8
SHAPE = ["batch", 4, DIM_F, DIM_T]

OUTPUT_PATH = Path(__file__).parent / "identity_mdx_kara2.onnx"


def build_model() -> onnx.ModelProto:
    graph = helper.make_graph(
        nodes=[helper.make_node("Identity", inputs=["input"], outputs=["output"])],
        name="identity_mdx_kara2",
        inputs=[helper.make_tensor_value_info("input", TensorProto.FLOAT, SHAPE)],
        outputs=[helper.make_tensor_value_info("output", TensorProto.FLOAT, SHAPE)],
    )
    model = helper.make_model(
        graph,
        producer_name="the-tuul-tests",
        opset_imports=[helper.make_opsetid("", 13)],
    )
    model.ir_version = 8
    onnx.checker.check_model(model)
    return model


if __name__ == "__main__":
    onnx.save(build_model(), OUTPUT_PATH)
    print(f"Wrote {OUTPUT_PATH} ({OUTPUT_PATH.stat().st_size} bytes)")
