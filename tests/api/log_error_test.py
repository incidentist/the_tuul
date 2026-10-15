from unittest import mock

from fastapi.testclient import TestClient

from api.main import app


def test_log_error_success():
    """Test that LogError view logs client errors and returns success."""
    client = TestClient(app)
    url = "/log_error"

    error_data = {
        "message": "JavaScript error occurred",
        "stack": "Error: test error\n    at function1 (app.js:10:5)",
        "url": "https://example.com/page",
        "line": 10,
        "column": 5,
    }

    with mock.patch("api.main.logger") as mock_logger:
        response = client.post(url, json=error_data)

    # Check response
    assert response.status_code == 200
    assert response.json() == {"success": True}

    # Check that logger.error was called with correct parameters
    mock_logger.error.assert_called_once_with(
        "Client error: JavaScript error occurred", extra=error_data
    )


def test_log_error_no_message():
    """Test LogError view handles missing message field."""
    client = TestClient(app)
    url = "/log_error"

    error_data = {
        "stack": "Error: test error\n    at function1 (app.js:10:5)",
        "url": "https://example.com/page",
    }

    with mock.patch("api.main.logger") as mock_logger:
        response = client.post(url, json=error_data)

    # Check response
    assert response.status_code == 200
    assert response.json() == {"success": True}

    # Check that logger.error was called with default message (FastAPI includes all fields)
    expected_data = {
        "message": None,
        "stack": "Error: test error\n    at function1 (app.js:10:5)",
        "url": "https://example.com/page",
        "line": None,
        "column": None,
    }
    mock_logger.error.assert_called_once_with(
        "Client error: <no message>", extra=expected_data
    )


def test_log_error_empty_data():
    """Test LogError view handles empty request data."""
    client = TestClient(app)
    url = "/log_error"

    with mock.patch("api.main.logger") as mock_logger:
        response = client.post(url, json={})

    # Check response
    assert response.status_code == 200
    assert response.json() == {"success": True}

    # Check that logger.error was called with default message and empty data (FastAPI includes all fields)
    expected_data = {
        "message": None,
        "stack": None,
        "url": None,
        "line": None,
        "column": None,
    }
    mock_logger.error.assert_called_once_with(
        "Client error: <no message>", extra=expected_data
    )


def test_log_error_keeps_undeclared_fields():
    """Test LogError view passes client context through to the log."""
    client = TestClient(app)

    with mock.patch("api.main.logger") as mock_logger:
        response = client.post(
            "/log_error",
            json={"message": "Boom", "userAgent": "Chrome"},
        )

    assert response.status_code == 200
    extra = mock_logger.error.call_args.kwargs["extra"]
    assert extra["userAgent"] == "Chrome"


def test_log_error_uses_requested_level():
    """Test LogError view logs at the level the client asks for."""
    client = TestClient(app)

    with mock.patch("api.main.logger") as mock_logger:
        response = client.post(
            "/log_error", json={"level": "warning", "message": "Lookup failed"}
        )

    assert response.status_code == 200
    mock_logger.error.assert_not_called()
    mock_logger.warning.assert_called_once()
    assert mock_logger.warning.call_args.args == ("Client warning: Lookup failed",)
    assert "level" not in mock_logger.warning.call_args.kwargs["extra"]


def test_log_error_rejects_unknown_level():
    """Test LogError view refuses a level it has no logger method for."""
    client = TestClient(app)

    response = client.post("/log_error", json={"level": "critical"})

    assert response.status_code == 422
