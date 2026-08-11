"""Immutable production command/query registry and canonical digest v1."""

import json
from dataclasses import dataclass
from hashlib import sha256
from types import MappingProxyType
from typing import Literal

from pydantic import BaseModel

from trax_api.application_errors import ApplicationError
from trax_api.server_models import JourneyUpdateCommandPayload

JOURNEY_WRITE_PERMISSION = "journey.write"


@dataclass(frozen=True)
class CommandDefinition:
    command_type: str
    version: int
    payload_model: type[BaseModel]
    permission: str
    risk: Literal["low", "medium", "high"]
    reversibility: Literal["full", "compensatable", "partial", "none"]
    handler_key: str


@dataclass(frozen=True)
class QueryDefinition:
    query_type: str
    version: int
    permission: str


@dataclass(frozen=True)
class CommandVersionRange:
    command_type: str
    current: int
    minimum_supported: int
    maximum_supported: int


def _immutable_registry(definitions: tuple[CommandDefinition, ...]):
    values: dict[tuple[str, int], CommandDefinition] = {}
    for definition in definitions:
        key = (definition.command_type, definition.version)
        if key in values:
            raise ValueError(f"Duplicate command definition: {key}")
        values[key] = definition
    return MappingProxyType(values)


def _immutable_query_registry(definitions: tuple[QueryDefinition, ...]):
    values: dict[tuple[str, int], QueryDefinition] = {}
    for definition in definitions:
        key = (definition.query_type, definition.version)
        if key in values:
            raise ValueError(f"Duplicate query definition: {key}")
        values[key] = definition
    return MappingProxyType(values)


COMMANDS = _immutable_registry(
    (
        CommandDefinition(
            command_type="journey.update",
            version=1,
            payload_model=JourneyUpdateCommandPayload,
            permission=JOURNEY_WRITE_PERMISSION,
            risk="low",
            reversibility="full",
            handler_key="journey.update.v1",
        ),
    )
)
ROLE_PERMISSIONS = MappingProxyType(
    {
        "OWNER": frozenset({"journey.read", JOURNEY_WRITE_PERMISSION}),
        "EDITOR": frozenset({"journey.read", JOURNEY_WRITE_PERMISSION}),
        "VIEWER": frozenset({"journey.read"}),
    }
)


def role_allows(role: str, permission: str) -> bool:
    return permission in ROLE_PERMISSIONS.get(role, frozenset())


def command_version_ranges(
    definitions: tuple[CommandDefinition, ...] | None = None,
) -> tuple[CommandVersionRange, ...]:
    """Project contiguous positive server command ranges without inventing support."""

    source = definitions if definitions is not None else tuple(COMMANDS.values())
    grouped: dict[str, set[int]] = {}
    for definition in source:
        if definition.version < 1:
            raise ValueError("Command versions must be positive")
        grouped.setdefault(definition.command_type, set()).add(definition.version)
    ranges: list[CommandVersionRange] = []
    for command_type, candidates in sorted(grouped.items()):
        versions = sorted(candidates)
        if versions != list(range(versions[0], versions[-1] + 1)):
            raise ValueError(f"Command versions must be contiguous: {command_type}")
        ranges.append(
            CommandVersionRange(
                command_type=command_type,
                current=versions[-1],
                minimum_supported=versions[0],
                maximum_supported=versions[-1],
            )
        )
    return tuple(ranges)


QUERIES = _immutable_query_registry(
    (
        QueryDefinition(query_type="journey.get", version=1, permission="journey.read"),
        QueryDefinition(query_type="journey.list", version=1, permission="journey.read"),
    )
)


def resolve_command(command_type: str, version: int) -> CommandDefinition:
    versions = {candidate for (name, candidate) in COMMANDS if name == command_type}
    if not versions:
        raise ApplicationError(422, "unsupported_command", "The command is not supported.")
    definition = COMMANDS.get((command_type, version))
    if definition is None:
        raise ApplicationError(
            422,
            "unsupported_command_version",
            "The command version is not supported.",
        )
    return definition


def resolve_query(query_type: str, version: int) -> QueryDefinition:
    versions = {candidate for (name, candidate) in QUERIES if name == query_type}
    if not versions:
        raise ApplicationError(422, "unsupported_query", "The query is not supported.")
    definition = QUERIES.get((query_type, version))
    if definition is None:
        raise ApplicationError(
            422, "unsupported_query_version", "The query version is not supported."
        )
    return definition


def command_digest_v1(
    *, command_id: str, command_type: str, command_version: int, payload: BaseModel
) -> str:
    """Bind an exact validated command with domain-separated canonical JSON."""

    canonical = json.dumps(
        {
            "command_id": command_id,
            "command_type": command_type,
            "command_version": command_version,
            "digest_version": 1,
            "payload": payload.model_dump(mode="json"),
        },
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return sha256(f"trax.command.digest.v1\0{canonical}".encode()).hexdigest()
