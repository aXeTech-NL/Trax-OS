"""Runtime evidence for the authored Python wire contract."""

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel, ValidationError

from trax_api.main import create_app
from trax_api.models import (
    CapabilitiesResponse,
    ErrorResponse,
    LiveResponse,
    ReadyResponse,
    VersionResponse,
)
from trax_api.server_models import (
    CommandEntityVersion,
    JourneyCreate,
    JourneyListResponse,
    JourneyResponse,
    JourneyUpdate,
    JourneyUpdateCommand,
    JourneyUpdateCommandPayload,
    JourneyUpdateCommandResponse,
    LoginRequest,
    LogoutResponse,
    PackingCreate,
    PackingListResponse,
    PackingProgressUpdate,
    PackingResponse,
    PackingUpdate,
    RegisterRequest,
    SegmentCreate,
    SegmentListResponse,
    SegmentReorder,
    SegmentResponse,
    SegmentUpdate,
    SessionResponse,
)

ROOT = Path(__file__).resolve().parents[3]
RUNTIME_FIXTURES = ROOT / "packages/api-contract/generated/runtime-fixtures.json"
USER_ID = "11111111-1111-4111-8111-111111111111"
WORKSPACE_ID = "22222222-2222-4222-8222-222222222222"
JOURNEY_ID = "33333333-3333-4333-8333-333333333333"
SEGMENT_ID = "44444444-4444-4444-8444-444444444444"
PACKING_ID = "55555555-5555-4555-8555-555555555555"
CREATED_AT = "2026-08-02T12:00:00Z"
UPDATED_AT = "2026-08-02T12:30:00+00:00"

JOURNEY_RESPONSE: dict[str, Any] = {
    "id": JOURNEY_ID,
    "name": "Contract fixture journey",
    "start_date": "2026-09-01",
    "end_date": None,
    "status": "planning",
    "record_version": 2,
    "created_at": CREATED_AT,
    "updated_at": UPDATED_AT,
}
SEGMENT_RESPONSE: dict[str, Any] = {
    "id": SEGMENT_ID,
    "journey_id": JOURNEY_ID,
    "kind": "move",
    "position": 1,
    "start_date": "2026-09-02",
    "end_date": "2026-09-02",
    "place_name": None,
    "origin_name": "Utrecht",
    "destination_name": "Antwerpen",
    "transport_mode": "train",
    "notes": "",
    "record_version": 3,
    "created_at": CREATED_AT,
    "updated_at": UPDATED_AT,
}
PACKING_RESPONSE: dict[str, Any] = {
    "id": PACKING_ID,
    "journey_id": JOURNEY_ID,
    "label": "Reusable bottle",
    "category": "other",
    "quantity": 2,
    "essential": True,
    "packed_quantity": 1,
    "record_version": 4,
    "created_at": CREATED_AT,
    "updated_at": UPDATED_AT,
}

ROUND_TRIPS: tuple[tuple[type[BaseModel], dict[str, Any]], ...] = (
    (LiveResponse, {"status": "live"}),
    (
        ReadyResponse,
        {"status": "not_ready", "checks": {"api": "ready", "database": "unavailable"}},
    ),
    (
        VersionResponse,
        {"application": "Trax OS", "version": "0.1.0", "api_version": "1"},
    ),
    (
        CapabilitiesResponse,
        {
            "schema_version": "1",
            "capabilities": [{"key": "foundation.contract-discovery", "status": "available"}],
        },
    ),
    (
        ErrorResponse,
        {
            "error": {
                "code": "validation_failed",
                "message": "The request is invalid.",
                "details": {"field": "name"},
                "request_id": "req_contract_fixture",
            }
        },
    ),
    (
        RegisterRequest,
        {
            "email": "contract-fixture@example.com",
            "password": "correct horse battery staple",
            "display_name": "Contract Traveler",
        },
    ),
    (LoginRequest, {"email": "contract-fixture@example.com", "password": "not-logged"}),
    (
        SessionResponse,
        {
            "authenticated": True,
            "user": {
                "id": USER_ID,
                "email": "contract-fixture@example.com",
                "display_name": "Contract Traveler",
                "workspace_id": WORKSPACE_ID,
            },
        },
    ),
    (LogoutResponse, {"authenticated": False}),
    (
        JourneyCreate,
        {
            "id": JOURNEY_ID,
            "name": "Contract fixture journey",
            "start_date": "2026-09-01",
            "end_date": None,
        },
    ),
    (
        JourneyUpdate,
        {
            "name": "Contract fixture journey",
            "start_date": "2026-09-01",
            "end_date": "2026-09-10",
            "expected_record_version": 2,
            "status": "active",
        },
    ),
    (
        JourneyUpdateCommandPayload,
        {
            "journey_id": JOURNEY_ID,
            "name": "Contract fixture journey",
            "start_date": "2026-09-01",
            "end_date": "2026-09-10",
            "expected_record_version": 2,
            "status": "active",
        },
    ),
    (
        JourneyUpdateCommand,
        {
            "command_id": "66666666-6666-4666-8666-666666666666",
            "command_type": "journey.update",
            "command_version": 1,
            "payload": {
                "journey_id": JOURNEY_ID,
                "name": "Contract fixture journey",
                "start_date": "2026-09-01",
                "end_date": "2026-09-10",
                "expected_record_version": 2,
                "status": "active",
            },
        },
    ),
    (
        CommandEntityVersion,
        {"entity_type": "journey", "entity_id": JOURNEY_ID, "record_version": 3},
    ),
    (
        JourneyUpdateCommandResponse,
        {
            "command_id": "66666666-6666-4666-8666-666666666666",
            "command_type": "journey.update",
            "command_version": 1,
            "outcome": "applied",
            "replayed": False,
            "change_set_id": "77777777-7777-4777-8777-777777777777",
            "result": {"entity_type": "journey", "entity_id": JOURNEY_ID, "record_version": 3},
        },
    ),
    (JourneyResponse, JOURNEY_RESPONSE),
    (JourneyListResponse, {"items": [JOURNEY_RESPONSE]}),
    (
        SegmentCreate,
        {
            "id": SEGMENT_ID,
            "kind": "stay",
            "start_date": "2026-09-01",
            "end_date": None,
            "place_name": "Utrecht",
        },
    ),
    (
        SegmentUpdate,
        {
            "kind": "move",
            "origin_name": "Utrecht",
            "destination_name": "Antwerpen",
            "transport_mode": "train",
            "expected_record_version": 3,
        },
    ),
    (SegmentReorder, {"expected_record_version": 3, "new_position": 0}),
    (SegmentResponse, SEGMENT_RESPONSE),
    (SegmentListResponse, {"items": [SEGMENT_RESPONSE]}),
    (
        PackingCreate,
        {
            "id": PACKING_ID,
            "label": "Reusable bottle",
            "category": "other",
            "quantity": 2,
            "essential": True,
        },
    ),
    (
        PackingUpdate,
        {
            "label": "Reusable bottle",
            "category": "other",
            "quantity": 2,
            "essential": True,
            "expected_record_version": 4,
        },
    ),
    (
        PackingProgressUpdate,
        {"expected_record_version": 4, "packed_quantity": 1},
    ),
    (PackingResponse, PACKING_RESPONSE),
    (PackingListResponse, {"items": [PACKING_RESPONSE]}),
)


@pytest.mark.parametrize(("model_type", "payload"), ROUND_TRIPS)
def test_public_wire_models_round_trip_through_json(
    model_type: type[BaseModel], payload: dict[str, Any]
) -> None:
    model = model_type.model_validate(payload)
    encoded = model.model_dump_json()

    assert isinstance(json.loads(encoded), dict)
    assert model_type.model_validate_json(encoded) == model


def test_generated_instance_fixture_matches_real_http_runtime() -> None:
    fixture = json.loads(RUNTIME_FIXTURES.read_text(encoding="utf-8"))

    with TestClient(create_app()) as client:
        version = client.get("/api/v1/version")
        capabilities = client.get("/api/v1/capabilities")

    assert version.json() == fixture["version"]
    assert capabilities.json() == fixture["capabilities"]
    assert VersionResponse.model_validate_json(version.content)
    assert CapabilitiesResponse.model_validate_json(capabilities.content)


def test_wire_models_reject_undeclared_fields() -> None:
    with pytest.raises(ValidationError, match="extra_forbidden"):
        VersionResponse.model_validate(
            {
                "application": "Trax OS",
                "version": "0.1.0",
                "api_version": "1",
                "unpublished": True,
            }
        )
