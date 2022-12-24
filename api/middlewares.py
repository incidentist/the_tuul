class SharedArrayBufferHeadersMiddleware:
    """
    Adds headers needed for browsers to enable SharedArrayBuffers, an important
    part of ffmpeg-wasm.
    See https://github.com/ffmpegwasm/ffmpeg.wasm#installation
    """
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response['Cross-Origin-Embedder-Policy'] = "require-corp"
        response['Cross-Origin-Opener-Policy'] = "same-origin"

        return response