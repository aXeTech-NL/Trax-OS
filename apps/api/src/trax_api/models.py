"""Public foundation wire models."""

from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


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


class SupportedVersionRange(WireModel):
    current: int = Field(ge=1)
    minimum_supported: int = Field(ge=1)
    maximum_supported: int = Field(ge=1)

    @model_validator(mode="after")
    def current_is_supported(self) -> Self:
        if not self.minimum_supported <= self.current <= self.maximum_supported:
            raise ValueError("current version must be inside the supported range")
        return self


class CommandVersionSupport(SupportedVersionRange):
    command_type: str = Field(min_length=1, max_length=120, pattern=r"^[a-z][a-z0-9_.-]*$")


class ContractDiscoveryResponse(WireModel):
    schema_version: Literal["1"]
    api: SupportedVersionRange
    commands: list[CommandVersionSupport]

    @model_validator(mode="after")
    def command_types_are_unique(self) -> Self:
        command_types = [command.command_type for command in self.commands]
        if len(command_types) != len(set(command_types)):
            raise ValueError("command types must be unique")
        return self


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
