"""Foundation HTTP routes."""

from typing import Any

from fastapi import APIRouter

from trax_api import __version__
from trax_api.models import (
    CapabilitiesResponse,
    Capability,
    ErrorResponse,
    LiveResponse,
    ReadinessChecks,
    ReadyResponse,
    VersionResponse,
)

REQUEST_ID_RESPONSE_HEADER: dict[str, Any] = {
    "description": "Request correlation identifier.",
    "schema": {"type": "string"},
}
RESPONSE_HEADERS = {"X-Request-ID": REQUEST_ID_RESPONSE_HEADER}
ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    404: {
        "model": ErrorResponse,
        "description": "Resource not found",
        "headers": RESPONSE_HEADERS,
    },
    422: {
        "model": ErrorResponse,
        "description": "Request validation failed",
        "headers": RESPONSE_HEADERS,
    },
    500: {
        "model": ErrorResponse,
        "description": "Unexpected server error",
        "headers": RESPONSE_HEADERS,
    },
}
SUCCESS_RESPONSE: dict[int | str, dict[str, Any]] = {200: {"headers": RESPONSE_HEADERS}}

health_router = APIRouter(
    prefix="/health",
    tags=["health"],
    responses={500: ERROR_RESPONSES[500]},
)
api_router = APIRouter(prefix="/api/v1", tags=["instance"], responses=ERROR_RESPONSES)


@health_router.get("/live", response_model=LiveResponse, responses=SUCCESS_RESPONSE)
def live() -> LiveResponse:
    """Report that the API process can serve requests."""
    return LiveResponse(status="live")


@health_router.get("/ready", response_model=ReadyResponse, responses=SUCCESS_RESPONSE)
def ready() -> ReadyResponse:
    """Report readiness of the implemented foundation dependencies."""
    return ReadyResponse(status="ready", checks=ReadinessChecks(api="ready"))


@api_router.get("/version", response_model=VersionResponse, responses=SUCCESS_RESPONSE)
def version() -> VersionResponse:
    """Return the public application and API contract versions."""
    return VersionResponse(application="Trax OS", version=__version__, api_version="1")


@api_router.get("/capabilities", response_model=CapabilitiesResponse, responses=SUCCESS_RESPONSE)
def capabilities() -> CapabilitiesResponse:
    """Advertise only capabilities provided by this foundation."""
    return CapabilitiesResponse(
        schema_version="1",
        capabilities=[Capability(key="foundation.contract-discovery", status="available")],
    )
