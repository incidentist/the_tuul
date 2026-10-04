"""
Logging configuration for FastAPI application.
"""

import structlog

from . import error_reporting
from . import loggers
from . import settings


def setup():
    """Configure logging based on settings."""
    if settings.LOGGING_FORMAT == "gcp":
        structlog.configure(
            processors=gcp_processors(),
            logger_factory=structlog.stdlib.LoggerFactory(),
            cache_logger_on_first_use=True,
        )
    else:
        structlog.configure(
            processors=[
                structlog.dev.ConsoleRenderer(),
            ],
            logger_factory=structlog.stdlib.LoggerFactory(),
            cache_logger_on_first_use=True,
        )


def gcp_processors():
    """Processors that render log entries as Cloud Logging / Error Reporting JSON."""
    return [
        structlog.contextvars.merge_contextvars,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.CallsiteParameterAdder(
            {
                structlog.processors.CallsiteParameter.PATHNAME,
                structlog.processors.CallsiteParameter.LINENO,
                structlog.processors.CallsiteParameter.FUNC_NAME,
            }
        ),
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        loggers.CloudLoggingFormatter(),
        error_reporting.ErrorReportingFormatter(service="the-tuul"),
        structlog.processors.JSONRenderer(),
    ]
