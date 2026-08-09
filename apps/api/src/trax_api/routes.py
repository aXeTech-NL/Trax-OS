"""Foundation HTTP routes."""

from typing import Any

from fastapi import APIRouter, Request, Response

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
    401: {
        "model": ErrorResponse,
        "description": "Authentication required or credentials invalid",
        "headers": RESPONSE_HEADERS,
    },
    403: {
        "model": ErrorResponse,
        "description": "Authenticated request is not permitted or CSRF check failed",
        "headers": RESPONSE_HEADERS,
    },
    404: {
        "model": ErrorResponse,
        "description": "Resource not found",
        "headers": RESPONSE_HEADERS,
    },
    409: {
        "model": ErrorResponse,
        "description": "Version or uniqueness conflict",
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
CREATED_RESPONSE: dict[int | str, dict[str, Any]] = {201: {"headers": RESPONSE_HEADERS}}
NO_CONTENT_RESPONSE: dict[int | str, dict[str, Any]] = {204: {"headers": RESPONSE_HEADERS}}
READINESS_RESPONSES: dict[int | str, dict[str, Any]] = {
    **SUCCESS_RESPONSE,
    503: {
        "model": ReadyResponse,
        "description": "An implemented dependency is unavailable",
        "headers": RESPONSE_HEADERS,
    },
}

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


@health_router.get("/ready", response_model=ReadyResponse, responses=READINESS_RESPONSES)
async def ready(request: Request, response: Response) -> ReadyResponse:
    """Report readiness of API and authoritative PostgreSQL storage."""
    database_ready = await request.app.state.database.ready()
    if not database_ready:
        response.status_code = 503
    return ReadyResponse(
        status="ready" if database_ready else "not_ready",
        checks=ReadinessChecks(api="ready", database="ready" if database_ready else "unavailable"),
    )


@api_router.get("/version", response_model=VersionResponse, responses=SUCCESS_RESPONSE)
def version() -> VersionResponse:
    """Return the public application and API contract versions."""
    return VersionResponse(application="Trax OS", version=__version__, api_version="1")


@api_router.get("/capabilities", response_model=CapabilitiesResponse, responses=SUCCESS_RESPONSE)
def capabilities() -> CapabilitiesResponse:
    """Advertise only capabilities provided by this foundation."""
    return CapabilitiesResponse(
        schema_version="1",
        capabilities=[
            Capability(key="foundation.contract-discovery", status="available"),
            Capability(key="identity.password-session", status="available"),
            Capability(key="journeys.server-authority", status="available"),
            Capability(key="journeys.timeline", status="available"),
            Capability(key="journeys.packing", status="available"),
        ],
    )
