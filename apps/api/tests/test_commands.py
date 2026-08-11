from dataclasses import replace
from datetime import date
from types import MappingProxyType
from uuid import UUID

import pytest

from trax_api.application_errors import ApplicationError
from trax_api.command_registry import (
    COMMANDS,
    JOURNEY_WRITE_PERMISSION,
    QUERIES,
    CommandDefinition,
    QueryDefinition,
    _immutable_query_registry,
    _immutable_registry,
    command_digest_v1,
    command_version_ranges,
    resolve_command,
    resolve_query,
    role_allows,
)
from trax_api.server_models import JourneyUpdateCommandPayload

COMMAND_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
JOURNEY_ID = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")


def payload(**changes: object) -> JourneyUpdateCommandPayload:
    values: dict[str, object] = {
        "journey_id": JOURNEY_ID,
        "name": "Canonical journey",
        "start_date": date(2027, 4, 1),
        "end_date": date(2027, 4, 20),
        "status": "active",
        "expected_record_version": 7,
    }
    values.update(changes)
    return JourneyUpdateCommandPayload.model_validate(values)


def test_command_and_query_registries_are_exact_and_immutable() -> None:
    assert isinstance(COMMANDS, MappingProxyType)
    assert isinstance(QUERIES, MappingProxyType)
    command = resolve_command("journey.update", 1)
    assert (command.permission, command.risk, command.reversibility, command.handler_key) == (
        JOURNEY_WRITE_PERMISSION,
        "low",
        "full",
        "journey.update.v1",
    )
    assert resolve_query("journey.get", 1).permission == "journey.read"
    assert resolve_query("journey.list", 1).permission == "journey.read"
    assert role_allows("OWNER", command.permission)
    assert role_allows("EDITOR", command.permission)
    assert not role_allows("VIEWER", command.permission)
    assert not role_allows("OWNER", "unregistered.permission")
    with pytest.raises(TypeError):
        COMMANDS[("journey.update", 2)] = command  # type: ignore[index]


def test_command_support_projection_requires_positive_contiguous_versions() -> None:
    definition = resolve_command("journey.update", 1)
    second = CommandDefinition(
        command_type=definition.command_type,
        version=2,
        payload_model=definition.payload_model,
        permission=definition.permission,
        risk=definition.risk,
        reversibility=definition.reversibility,
        handler_key="journey.update.v2",
    )
    support = command_version_ranges((definition, second))
    assert len(support) == 1
    assert support[0].command_type == "journey.update"
    assert (support[0].minimum_supported, support[0].current, support[0].maximum_supported) == (
        1,
        2,
        2,
    )
    with pytest.raises(ValueError, match="contiguous"):
        command_version_ranges((definition, replace(second, version=3)))
    with pytest.raises(ValueError, match="positive"):
        command_version_ranges((replace(definition, version=0),))


def test_registry_rejects_duplicates_and_resolves_stable_errors() -> None:
    definition = resolve_command("journey.update", 1)
    with pytest.raises(ValueError, match="Duplicate command"):
        _immutable_registry((definition, definition))
    query = QueryDefinition("journey.get", 1, "journey.read")
    with pytest.raises(ValueError, match="Duplicate query"):
        _immutable_query_registry((query, query))
    with pytest.raises(ApplicationError) as unsupported:
        resolve_command("journey.missing", 1)
    assert unsupported.value.code == "unsupported_command"
    with pytest.raises(ApplicationError) as version:
        resolve_command("journey.update", 2)
    assert version.value.code == "unsupported_command_version"
    with pytest.raises(ApplicationError) as missing_query:
        resolve_query("journey.missing", 1)
    assert missing_query.value.code == "unsupported_query"
    with pytest.raises(ApplicationError) as query_version:
        resolve_query("journey.get", 2)
    assert query_version.value.code == "unsupported_query_version"


def test_digest_v1_has_a_golden_and_binds_every_validated_field() -> None:
    base = payload()
    digest = command_digest_v1(
        command_id=COMMAND_ID,
        command_type="journey.update",
        command_version=1,
        payload=base,
    )
    assert digest == "0f3c6b4a92e9b9d0ef41c94d4c967b9f91b23080f90924643ab8b60fac55d784"
    variants = [
        (
            "command",
            command_digest_v1(
                command_id="cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                command_type="journey.update",
                command_version=1,
                payload=base,
            ),
        ),
        (
            "type",
            command_digest_v1(
                command_id=COMMAND_ID,
                command_type="journey.update.other",
                command_version=1,
                payload=base,
            ),
        ),
        (
            "version",
            command_digest_v1(
                command_id=COMMAND_ID,
                command_type="journey.update",
                command_version=2,
                payload=base,
            ),
        ),
        (
            "journey",
            command_digest_v1(
                command_id=COMMAND_ID,
                command_type="journey.update",
                command_version=1,
                payload=payload(journey_id=UUID("dddddddd-dddd-4ddd-8ddd-dddddddddddd")),
            ),
        ),
        (
            "name",
            command_digest_v1(
                command_id=COMMAND_ID,
                command_type="journey.update",
                command_version=1,
                payload=payload(name="Other"),
            ),
        ),
        (
            "start",
            command_digest_v1(
                command_id=COMMAND_ID,
                command_type="journey.update",
                command_version=1,
                payload=payload(start_date=date(2027, 4, 2)),
            ),
        ),
        (
            "end",
            command_digest_v1(
                command_id=COMMAND_ID,
                command_type="journey.update",
                command_version=1,
                payload=payload(end_date=None),
            ),
        ),
        (
            "status",
            command_digest_v1(
                command_id=COMMAND_ID,
                command_type="journey.update",
                command_version=1,
                payload=payload(status="planning"),
            ),
        ),
        (
            "expected",
            command_digest_v1(
                command_id=COMMAND_ID,
                command_type="journey.update",
                command_version=1,
                payload=payload(expected_record_version=8),
            ),
        ),
    ]
    assert all(candidate != digest for _, candidate in variants)
    reordered = JourneyUpdateCommandPayload.model_validate(
        {
            "status": "active",
            "end_date": "2027-04-20",
            "name": "Canonical journey",
            "journey_id": str(JOURNEY_ID),
            "expected_record_version": 7,
            "start_date": "2027-04-01",
        }
    )
    assert (
        command_digest_v1(
            command_id=COMMAND_ID,
            command_type="journey.update",
            command_version=1,
            payload=reordered,
        )
        == digest
    )


def test_registry_constructor_type_is_documented() -> None:
    # Keeps the constructor exercised without widening the production registry.
    assert isinstance(
        CommandDefinition("x", 1, JourneyUpdateCommandPayload, "x", "low", "none", "x.v1"),
        CommandDefinition,
    )
