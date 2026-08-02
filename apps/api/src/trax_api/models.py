"""Public foundation wire models."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class WireModel(BaseModel):
    """Strict base for public wire responses."""

    model_config = ConfigDict(extra="forbid")


class LiveResponse(WireModel):
    status: Literal["live"]


class ReadinessChecks(WireModel):
    api: Literal["ready"]
    database: Literal["ready", "unavailable"]


class ReadyResponse(WireModel):
    status: Literal["ready", "not_ready"]
    checks: ReadinessChecks


class VersionResponse(WireModel):
    application: Literal["Trax OS"]
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    api_version: Literal["1"]


class Capability(WireModel):
    key: str
    status: Literal["available", "unavailable"]


class CapabilitiesResponse(WireModel):
    schema_version: Literal["1"]
    capabilities: list[Capability]


class ErrorBody(WireModel):
    code: str
    message: str
    details: dict[str, Any]
    request_id: str


class ErrorResponse(WireModel):
    error: ErrorBody
