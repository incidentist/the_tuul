"""
Helpers for getting log entries picked up by GCP Error Reporting.
See https://cloud.google.com/error-reporting/docs/formatting-error-messages
"""

import re
from typing import Optional

REPORTED_ERROR_EVENT_TYPE = (
    "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent"
)

# Firefox and Safari frames look like `functionName@https://host/file.js:10:5`.
GECKO_FRAME = re.compile(r"^\s*(?P<function>[^@]*)@(?P<location>.+:\d+:\d+)\s*$")
V8_FRAME = re.compile(r"^\s+at\s")
# Frames from our console.error/warn overrides in frontend/lib/util.ts. Left in, they
# would be the top frame of every console-generated error and Error Reporting would
# group all of those errors together.
CONSOLE_OVERRIDE_FRAME = re.compile(r"console\.(error|warn)")


def v8_stack_trace(
    stack: Optional[str], error_type: Optional[str], message: Optional[str]
) -> Optional[str]:
    """
    Rewrite a browser stack trace into the V8 (Chrome/Node) format, which is the only
    JavaScript format Error Reporting can parse. Returns None if no frames are found.
    """
    if not stack:
        return None

    frames = []
    for line in stack.splitlines():
        if CONSOLE_OVERRIDE_FRAME.search(line):
            continue
        if V8_FRAME.match(line):
            frames.append(f"    {line.strip()}")
        elif match := GECKO_FRAME.match(line):
            function = match["function"]
            location = match["location"]
            frames.append(
                f"    at {function} ({location})" if function else f"    at {location}"
            )

    if not frames:
        return None
    error_type = error_type or "Error"
    header = f"{error_type}: {message}" if message else error_type
    return "\n".join([header, *frames])


class ErrorReportingFormatter:
    """
    Structlog processor that makes error-level entries visible to Error Reporting.

    Must run after CloudLoggingFormatter, which sets `severity`, and after
    CallsiteParameterAdder, whose fields become the report location of errors that
    have no stack trace.
    """

    ERROR_SEVERITIES = {"error", "critical"}
    CALLSITE_FIELDS = ("pathname", "lineno", "func_name")

    def __init__(self, service: str):
        self.service = service

    def __call__(self, logger, log_method: str, event_dict: dict) -> dict:
        pathname, lineno, func_name = (
            event_dict.pop(field, None) for field in self.CALLSITE_FIELDS
        )
        if str(event_dict.get("severity", "")).lower() not in self.ERROR_SEVERITIES:
            return event_dict

        event_dict["serviceContext"] = {"service": self.service}
        if "stack_trace" not in event_dict and "exception" not in event_dict:
            event_dict["@type"] = REPORTED_ERROR_EVENT_TYPE
            event_dict["context"] = {
                "reportLocation": {
                    "filePath": pathname or "unknown",
                    "lineNumber": lineno or 0,
                    "functionName": func_name or "unknown",
                }
            }
        return event_dict
