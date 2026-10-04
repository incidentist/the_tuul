import json
import logging

import pytest
import structlog

from api import app_logging
from api.error_reporting import REPORTED_ERROR_EVENT_TYPE, v8_stack_trace

CHROME_STACK = (
    "TypeError: Cannot read properties of undefined (reading 'x')\n"
    "    at doThing (https://tuul.example/assets/index.js:42:7)\n"
    "    at https://tuul.example/assets/index.js:1:99"
)
V8_FRAMES = (
    "    at doThing (https://tuul.example/assets/index.js:42:7)\n"
    "    at https://tuul.example/assets/index.js:1:99"
)


def test_v8_stack_trace_keeps_chrome_frames():
    result = v8_stack_trace(
        CHROME_STACK, "TypeError", "Cannot read properties of undefined (reading 'x')"
    )

    assert result == CHROME_STACK


def test_v8_stack_trace_converts_firefox_frames():
    stack = (
        "doThing@https://tuul.example/assets/index.js:42:7\n"
        "@https://tuul.example/assets/index.js:1:99\n"
    )

    result = v8_stack_trace(stack, "TypeError", "x is undefined")

    assert result == f"TypeError: x is undefined\n{V8_FRAMES}"


def test_v8_stack_trace_converts_safari_frames_and_skips_native_code():
    stack = (
        "doThing@https://tuul.example/assets/index.js:42:7\n"
        "forEach@[native code]\n"
        "global code@https://tuul.example/assets/index.js:1:99"
    )

    result = v8_stack_trace(stack, "TypeError", "x is undefined")

    assert result == (
        "TypeError: x is undefined\n"
        "    at doThing (https://tuul.example/assets/index.js:42:7)\n"
        "    at global code (https://tuul.example/assets/index.js:1:99)"
    )


@pytest.mark.parametrize(
    "override_frame",
    [
        "    at console.error (https://tuul.example/assets/index.js:3:3)",
        "console.error@https://tuul.example/assets/index.js:3:3",
    ],
)
def test_v8_stack_trace_drops_console_override_frames(override_frame):
    stack = f"Error: oops\n{override_frame}\n{V8_FRAMES}"

    result = v8_stack_trace(stack, "Error", "oops")

    assert result == f"Error: oops\n{V8_FRAMES}"


def test_v8_stack_trace_defaults_type_and_omits_missing_message():
    stack = "doThing@https://tuul.example/assets/index.js:42:7"

    result = v8_stack_trace(stack, None, None)

    assert result == "Error\n    at doThing (https://tuul.example/assets/index.js:42:7)"


@pytest.mark.parametrize("stack", [None, "", "Error: no frames here"])
def test_v8_stack_trace_returns_none_without_frames(stack):
    assert v8_stack_trace(stack, "Error", "oops") is None


@pytest.fixture
def log_entries(caplog):
    """A logger using the production GCP processors, and the JSON entries it writes."""
    logger = structlog.wrap_logger(
        logging.getLogger("error_reporting_test"),
        processors=app_logging.gcp_processors(),
        wrapper_class=structlog.stdlib.BoundLogger,
    )
    caplog.set_level(logging.DEBUG, logger="error_reporting_test")

    def entries():
        return [json.loads(record.getMessage()) for record in caplog.records]

    return logger, entries


def test_error_without_stack_trace_gets_report_location(log_entries):
    logger, entries = log_entries

    logger.error("separation_error", error="boom")

    [entry] = entries()
    assert entry["@type"] == REPORTED_ERROR_EVENT_TYPE
    assert entry["serviceContext"] == {"service": "the-tuul"}
    location = entry["context"]["reportLocation"]
    assert location["filePath"].endswith("error_reporting_test.py")
    assert location["functionName"] == "test_error_without_stack_trace_gets_report_location"
    assert location["lineNumber"] > 0
    assert "pathname" not in entry


def test_exception_is_reported_by_its_traceback(log_entries):
    logger, entries = log_entries

    try:
        raise ValueError("bad value")
    except ValueError:
        logger.exception("background_separation_failed")

    [entry] = entries()
    assert entry["serviceContext"] == {"service": "the-tuul"}
    assert "ValueError: bad value" in entry["exception"]
    assert "@type" not in entry
    assert "context" not in entry


def test_error_with_stack_trace_field_is_reported_by_it(log_entries):
    logger, entries = log_entries

    logger.error("Client error: oops", stack_trace=CHROME_STACK)

    [entry] = entries()
    assert entry["serviceContext"] == {"service": "the-tuul"}
    assert entry["stack_trace"] == CHROME_STACK
    assert "@type" not in entry


@pytest.mark.parametrize("level", ["debug", "info", "warning"])
def test_non_errors_are_not_reported(log_entries, level):
    logger, entries = log_entries

    getattr(logger, level)("something_happened")

    [entry] = entries()
    assert "serviceContext" not in entry
    assert "@type" not in entry
    assert "pathname" not in entry
