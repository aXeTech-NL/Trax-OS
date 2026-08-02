from fastapi import HTTPException
from fastapi.testclient import TestClient

from trax_api.main import create_app


def test_health_endpoints_have_typed_responses() -> None:
    with TestClient(create_app()) as client:
        live = client.get("/health/live")
        ready = client.get("/health/ready")

    assert live.status_code == 200
    assert live.json() == {"status": "live"}
    assert ready.status_code == 200
    assert ready.json() == {"status": "ready", "checks": {"api": "ready"}}


def test_version_and_capability_discovery() -> None:
    with TestClient(create_app()) as client:
        version = client.get("/api/v1/version")
        capabilities = client.get("/api/v1/capabilities")

    assert version.json() == {"application": "Trax OS", "version": "0.1.0", "api_version": "1"}
    assert capabilities.json() == {
        "schema_version": "1",
        "capabilities": [
            {"key": "foundation.contract-discovery", "status": "available"},
        ],
    }


def test_request_id_is_preserved_when_safe() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/health/live", headers={"X-Request-ID": "review-123"})

    assert response.headers["X-Request-ID"] == "review-123"


def test_unsafe_request_id_is_replaced_and_returned_in_error_envelope() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/missing", headers={"X-Request-ID": "unsafe request id"})

    request_id = response.headers["X-Request-ID"]
    assert response.status_code == 404
    assert request_id.startswith("req_")
    assert response.json() == {
        "error": {
            "code": "resource_not_found",
            "message": "Not Found",
            "details": {},
            "request_id": request_id,
        }
    }


def test_validation_errors_use_stable_envelope() -> None:
    application = create_app()

    @application.get("/_test/validated")
    def validated(limit: int) -> dict[str, int]:
        return {"limit": limit}

    with TestClient(application) as client:
        validation = client.get("/_test/validated", params={"limit": "not-an-integer"})

    assert validation.status_code == 422
    assert validation.json()["error"]["code"] == "validation_failed"
    assert validation.json()["error"]["details"]["errors"]


def test_unexpected_errors_keep_supplied_and_generated_request_ids() -> None:
    application = create_app()

    @application.get("/_test/failure")
    def failure() -> None:
        raise RuntimeError("sensitive implementation detail")

    with TestClient(application, raise_server_exceptions=False) as client:
        supplied = client.get("/_test/failure", headers={"X-Request-ID": "review-500"})
        generated = client.get("/_test/failure")

    for response in (supplied, generated):
        request_id = response.headers["X-Request-ID"]
        assert response.status_code == 500
        assert response.json() == {
            "error": {
                "code": "internal_error",
                "message": "An unexpected error occurred.",
                "details": {},
                "request_id": request_id,
            }
        }
        assert "sensitive implementation detail" not in response.text

    assert supplied.headers["X-Request-ID"] == "review-500"
    assert generated.headers["X-Request-ID"].startswith("req_")


def test_http_exception_authentication_header_is_preserved() -> None:
    application = create_app()

    @application.get("/_test/protected")
    def protected() -> None:
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
            headers={"WWW-Authenticate": 'Bearer realm="trax-os"'},
        )

    with TestClient(application) as client:
        response = client.get("/_test/protected")

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="trax-os"'
    assert response.json()["error"]["code"] == "http_error"


def test_custom_http_status_and_headers_are_preserved() -> None:
    application = create_app()

    @application.get("/_test/custom-status")
    def custom_status() -> None:
        raise HTTPException(
            status_code=499,
            detail="Custom status",
            headers={"X-Probe": "kept"},
        )

    with TestClient(application) as client:
        response = client.get("/_test/custom-status")

    assert response.status_code == 499
    assert response.headers["X-Probe"] == "kept"
    assert response.json()["error"]["code"] == "http_error"
    assert response.json()["error"]["message"] == "Custom status"


def test_method_not_allowed_header_is_preserved() -> None:
    application = create_app()

    @application.post("/_test/write-only")
    def write_only() -> None:
        return None

    with TestClient(application) as client:
        response = client.get("/_test/write-only")

    assert response.status_code == 405
    assert response.headers["Allow"] == "POST"
    assert response.json()["error"]["code"] == "method_not_allowed"


def test_openapi_exposes_typed_foundation_contracts_and_correlation() -> None:
    schema = create_app().openapi()

    assert schema["info"]["version"] == "0.1.0"
    assert schema["paths"]["/health/live"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"]["$ref"].endswith("/LiveResponse")
    assert schema["paths"]["/api/v1/capabilities"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"]["$ref"].endswith("/CapabilitiesResponse")

    for path in (
        "/health/live",
        "/health/ready",
        "/api/v1/version",
        "/api/v1/capabilities",
    ):
        responses = schema["paths"][path]["get"]["responses"]
        assert responses["200"]["headers"]["X-Request-ID"]["schema"] == {"type": "string"}
        assert responses["500"]["headers"]["X-Request-ID"]["schema"] == {"type": "string"}
        assert responses["500"]["content"]["application/json"]["schema"]["$ref"].endswith(
            "/ErrorResponse"
        )
