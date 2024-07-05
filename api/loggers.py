"""
Structlog processors. See the LOGGING section in settings.py
For more examples see https://www.structlog.org/en/stable/_modules/structlog/processors.html#TimeStamper
"""
from django.dispatch import receiver
from django_structlog import signals
from django.http.request import HttpRequest
from django.http.response import HttpResponse
from django.conf import settings

import structlog
from structlog.types import EventDict, WrappedLogger


class CloudLoggingFormatter:
    """
    Rearrange structlog logs to match Cloud Logging format
    see https://cloud.google.com/logging/docs/structured-logging#special-payload-fields
    """

    def __call__(
        self, logger: WrappedLogger, log_method: str, event_dict: EventDict
    ) -> EventDict:
        event_map = {
            "timestamp": "time",
            "level": "severity",
            "event": "message",
            "trace": "logging.googleapis.com/trace",
            "labels": "logging.googleapis.com/labels",
            "operation": "logging.googleapis.com/operation",
        }
        # event_dict["msg"] = event_dict["event"]
        for key, gcp_key in event_map.items():
            if key in event_dict:
                event_dict[gcp_key] = event_dict[key]
                del event_dict[key]

        http_request = {}
        if "request" in event_dict and isinstance(event_dict["request"], str):
            components = event_dict["request"].split(" ")
            http_request["requestMethod"] = components[0]
            http_request["requestUrl"] = components[1]
        if "code" in event_dict:
            http_request["status"] = event_dict["code"]

        if len(http_request):
            event_dict["httpRequest"] = http_request

        return event_dict
