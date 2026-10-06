from unittest import mock

import pytest
from fastapi.testclient import TestClient
from api.main import app


def test_log_error_success():
    """The /log view logs client errors and returns success."""
    client = TestClient(app)

    log_data = {
        "severity": "error",
        "message": "JavaScript error occurred",
        "stack": "Error: test error\n    at function1 (app.js:10:5)",
        "url": "https://example.com/page",
        "line": 10,
        "column": 5,
    }

    with mock.patch("api.main.logger") as mock_logger:
        response = client.post("/log", json=log_data)

    assert response.status_code == 200
    assert response.json() == {"success": True}

    unsent_fields = dict.fromkeys(
        ["file", "type", "info", "userAgent", "timestamp", "vue", "context", "repeatCount"]
    )
    mock_logger.error.assert_called_once_with(
        "Client error: JavaScript error occurred",
        extra={**log_data, **unsent_fields},
        stack_trace="Error: JavaScript error occurred\n    at function1 (app.js:10:5)",
    )


@pytest.mark.parametrize("severity", ["debug", "info", "warning", "error"])
def test_log_uses_logger_method_matching_severity(severity):
    client = TestClient(app)

    with mock.patch("api.main.logger") as mock_logger:
        response = client.post(
            "/log", json={"severity": severity, "message": "something happened"}
        )

    assert response.status_code == 200
    getattr(mock_logger, severity).assert_called_once()
    message = getattr(mock_logger, severity).call_args.args[0]
    assert message == f"Client {severity}: something happened"
    for other in {"debug", "info", "warning", "error"} - {severity}:
        getattr(mock_logger, other).assert_not_called()


@pytest.mark.parametrize("severity", ["debug", "info", "warning", "error"])
def test_log_works_with_the_real_logger_at_every_severity(severity):
    client = TestClient(app)

    response = client.post("/log", json={"severity": severity, "message": "real"})

    assert response.status_code == 200
    assert response.json() == {"success": True}


def test_log_defaults_to_error_severity():
    client = TestClient(app)

    with mock.patch("api.main.logger") as mock_logger:
        response = client.post("/log", json={"message": "no severity given"})

    assert response.status_code == 200
    mock_logger.error.assert_called_once()
    assert mock_logger.error.call_args.kwargs["extra"]["severity"] == "error"


def test_log_rejects_unknown_severity():
    client = TestClient(app)

    with mock.patch("api.main.logger") as mock_logger:
        response = client.post("/log", json={"severity": "catastrophic"})

    assert response.status_code == 422
    for level in ("debug", "info", "warning", "error"):
        getattr(mock_logger, level).assert_not_called()


def test_log_keeps_the_full_payload_the_frontend_sends():
    client = TestClient(app)

    log_data = {
        "severity": "error",
        "message": "boom",
        "stack": "Error: boom\n    at doThing (http://localhost/src/app.ts:42:7)",
        "file": "src/app.ts",
        "line": 42,
        "column": 7,
        "type": "TypeError",
        "info": "setup function",
        "userAgent": "Mozilla/5.0 (test)",
        "timestamp": "2026-10-04T13:40:00.000Z",
        "vue": {"component": "TimingAdjuster", "props": {"lyrics": ["la la"]}},
        "context": {"lyrics": "la la\n\n", "timings": [[1.5, 1], [2.25, 2]]},
        "repeatCount": 3,
    }

    with mock.patch("api.main.logger") as mock_logger:
        response = client.post("/log", json=log_data)

    assert response.status_code == 200
    extra = mock_logger.error.call_args.kwargs["extra"]
    assert extra == {**log_data, "url": None}


def test_log_accepts_vue_context_without_props():
    client = TestClient(app)

    with mock.patch("api.main.logger") as mock_logger:
        response = client.post("/log", json={"vue": {"component": "unknown"}})

    assert response.status_code == 200
    extra = mock_logger.error.call_args.kwargs["extra"]
    assert extra["vue"] == {"component": "unknown", "props": None}


def test_log_no_message():
    """The /log view handles a missing message field."""
    client = TestClient(app)

    log_data = {
        "stack": "Error: test error\n    at function1 (app.js:10:5)",
        "url": "https://example.com/page",
    }

    with mock.patch("api.main.logger") as mock_logger:
        response = client.post("/log", json=log_data)

    assert response.status_code == 200
    assert response.json() == {"success": True}

    expected_data = {
        "severity": "error",
        "message": None,
        "stack": "Error: test error\n    at function1 (app.js:10:5)",
        "url": "https://example.com/page",
        "line": None,
        "column": None,
        "file": None,
        "type": None,
        "info": None,
        "userAgent": None,
        "timestamp": None,
        "vue": None,
        "context": None,
        "repeatCount": None,
    }
    mock_logger.error.assert_called_once_with(
        "Client error: <no message>",
        extra=expected_data,
        stack_trace="Error\n    at function1 (app.js:10:5)",
    )


def test_log_empty_data():
    """The /log view handles empty request data."""
    client = TestClient(app)

    with mock.patch("api.main.logger") as mock_logger:
        response = client.post("/log", json={})

    assert response.status_code == 200
    assert response.json() == {"success": True}

    expected_data = {
        "severity": "error",
        "message": None,
        "stack": None,
        "url": None,
        "line": None,
        "column": None,
        "file": None,
        "type": None,
        "info": None,
        "userAgent": None,
        "timestamp": None,
        "vue": None,
        "context": None,
        "repeatCount": None,
    }
    mock_logger.error.assert_called_once_with(
        "Client error: <no message>", extra=expected_data
    )


def test_log_error_sends_firefox_stack_to_error_reporting_in_v8_format():
    client = TestClient(app)

    log_data = {
        "severity": "error",
        "message": "x is undefined",
        "type": "TypeError",
        "stack": "doThing@https://tuul.example/assets/index.js:42:7\n"
        "@https://tuul.example/assets/index.js:1:99\n",
    }

    with mock.patch("api.main.logger") as mock_logger:
        client.post("/log", json=log_data)

    assert mock_logger.error.call_args.kwargs["stack_trace"] == (
        "TypeError: x is undefined\n"
        "    at doThing (https://tuul.example/assets/index.js:42:7)\n"
        "    at https://tuul.example/assets/index.js:1:99"
    )


def test_log_warning_with_stack_is_not_sent_to_error_reporting():
    client = TestClient(app)

    log_data = {
        "severity": "warning",
        "message": "careful",
        "stack": "Error: careful\n    at function1 (app.js:10:5)",
    }

    with mock.patch("api.main.logger") as mock_logger:
        client.post("/log", json=log_data)

    assert "stack_trace" not in mock_logger.warning.call_args.kwargs


def test_log_passes_labels_through_as_cloud_logging_labels():
    client = TestClient(app)
    labels = {"tag": "performance:local-separation"}

    with mock.patch("api.main.logger") as mock_logger:
        response = client.post(
            "/log", json={"severity": "info", "message": "timed", "labels": labels}
        )

    assert response.status_code == 200
    assert mock_logger.info.call_args.kwargs["labels"] == labels


def test_log_sends_no_labels_when_the_client_sends_none():
    client = TestClient(app)

    with mock.patch("api.main.logger") as mock_logger:
        client.post("/log", json={"severity": "info", "message": "plain"})

    assert "labels" not in mock_logger.info.call_args.kwargs
