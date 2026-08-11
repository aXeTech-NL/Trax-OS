import asyncio
from os import getenv
from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from trax_api.main import create_app

DATABASE_URL = getenv(
    "TRAX_DATABASE_URL",
    "postgresql+asyncpg://trax_app:trax-application-development-only@127.0.0.1:5432/trax",
)
ADMIN_DATABASE_URL = getenv(
    "TRAX_ADMIN_DATABASE_URL",
    "postgresql+asyncpg://trax_admin:trax-admin-development-only@127.0.0.1:5432/trax",
)


async def reset_database() -> None:
    engine = create_async_engine(ADMIN_DATABASE_URL, hide_parameters=True)
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "TRUNCATE command_receipts, command_change_events, command_change_sets, "
                "packing_items, journey_segments, journeys, "
                "auth_refresh_sessions, workspace_memberships, workspaces, "
                "auth_password_credentials, users RESTART IDENTITY CASCADE"
            )
        )
    await engine.dispose()


@pytest.fixture(autouse=True)
def clean_database() -> None:
    asyncio.run(reset_database())


def csrf(client: TestClient) -> dict[str, str]:
    value = client.cookies.get("trax_csrf")
    assert value
    return {"X-CSRF-Token": value}


def register(client: TestClient, email: str = "owner@axetech.nl") -> dict[str, Any]:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "correct horse battery staple",
            "display_name": "Owner",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def create_journey(client: TestClient, name: str = "Japan") -> dict[str, Any]:
    response = client.post(
        "/api/v1/journeys",
        headers=csrf(client),
        json={"name": name, "start_date": "2027-04-01", "end_date": "2027-04-20"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_authentication_session_csrf_login_and_logout() -> None:
    with TestClient(create_app()) as client:
        anonymous = client.get("/api/v1/auth/session")
        assert anonymous.status_code == 401
        assert anonymous.json()["error"]["code"] == "authentication_required"

        account_response = client.post(
            "/api/v1/auth/register",
            json={
                "email": "owner@axetech.nl",
                "password": "correct horse battery staple",
                "display_name": "Owner",
            },
        )
        assert account_response.status_code == 201
        assert "HttpOnly" in account_response.headers["set-cookie"]
        assert "SameSite=lax" in account_response.headers["set-cookie"]
        account = account_response.json()
        assert account["authenticated"] is True
        assert UUID(str(account["user"]["workspace_id"]))
        cookie = client.cookies.get("trax_session")
        assert cookie and "correct horse" not in cookie

        session = client.get("/api/v1/auth/session")
        assert session.status_code == 200
        assert session.json()["user"]["email"] == "owner@axetech.nl"

        blocked = client.post("/api/v1/journeys", json={"name": "No CSRF"})
        assert blocked.status_code == 403
        assert blocked.json()["error"]["code"] == "csrf_failed"

        logout = client.post("/api/v1/auth/logout", headers=csrf(client))
        assert logout.status_code == 200
        assert logout.json() == {"authenticated": False}
        assert client.get("/api/v1/auth/session").status_code == 401

        invalid = client.post(
            "/api/v1/auth/login",
            json={"email": "owner@axetech.nl", "password": "wrong"},
        )
        missing = client.post(
            "/api/v1/auth/login",
            json={"email": "missing@axetech.nl", "password": "wrong"},
        )
        assert invalid.status_code == missing.status_code == 401
        assert invalid.json()["error"]["code"] == "invalid_credentials"
        assert missing.json()["error"]["code"] == "invalid_credentials"

        duplicate = client.post(
            "/api/v1/auth/register",
            json={
                "email": "owner@axetech.nl",
                "password": "another secure password",
                "display_name": "Duplicate",
            },
        )
        assert duplicate.status_code == 409
        assert duplicate.json()["error"]["code"] == "email_already_registered"

        logged_in = client.post(
            "/api/v1/auth/login",
            json={
                "email": "OWNER@axetech.nl",
                "password": "correct horse battery staple",
            },
        )
        assert logged_in.status_code == 200


def test_journey_timeline_packing_and_optimistic_versions() -> None:
    with TestClient(create_app()) as client:
        register(client)
        invalid_dates = client.post(
            "/api/v1/journeys",
            headers=csrf(client),
            json={"name": "Invalid", "start_date": "2027-05-02", "end_date": "2027-05-01"},
        )
        assert invalid_dates.status_code == 422

        journey = create_journey(client)
        journey_id = journey["id"]
        assert client.get("/api/v1/journeys").json()["items"][0]["name"] == "Japan"

        updated = client.put(
            f"/api/v1/journeys/{journey_id}",
            headers=csrf(client),
            json={
                "name": "Japan spring",
                "start_date": "2027-04-01",
                "end_date": "2027-04-21",
                "status": "active",
                "expected_record_version": journey["record_version"],
            },
        )
        assert updated.status_code == 200
        assert updated.json()["status"] == "active"
        stale = client.put(
            f"/api/v1/journeys/{journey_id}",
            headers=csrf(client),
            json={
                "name": "Stale",
                "start_date": None,
                "end_date": None,
                "status": "planning",
                "expected_record_version": journey["record_version"],
            },
        )
        assert stale.status_code == 409
        assert stale.json()["error"]["code"] == "version_conflict"

        stay = client.post(
            f"/api/v1/journeys/{journey_id}/segments",
            headers=csrf(client),
            json={"kind": "stay", "place_name": "Tokyo"},
        )
        move = client.post(
            f"/api/v1/journeys/{journey_id}/segments",
            headers=csrf(client),
            json={
                "kind": "move",
                "origin_name": "Tokyo",
                "destination_name": "Kyoto",
                "transport_mode": "Train",
            },
        )
        assert stay.status_code == move.status_code == 201
        reordered = client.post(
            f"/api/v1/journeys/{journey_id}/segments/{move.json()['id']}/reorder",
            headers=csrf(client),
            json={"expected_record_version": move.json()["record_version"], "new_position": 0},
        )
        assert reordered.status_code == 200
        assert (
            client.get(f"/api/v1/journeys/{journey_id}/segments").json()["items"][0]["kind"]
            == "move"
        )

        packing = client.post(
            f"/api/v1/journeys/{journey_id}/packing",
            headers=csrf(client),
            json={
                "label": "Passport",
                "category": "documents",
                "quantity": 1,
                "essential": True,
            },
        )
        assert packing.status_code == 201
        too_many = client.put(
            f"/api/v1/journeys/{journey_id}/packing/{packing.json()['id']}/progress",
            headers=csrf(client),
            json={
                "expected_record_version": packing.json()["record_version"],
                "packed_quantity": 2,
            },
        )
        assert too_many.status_code == 422
        packed = client.put(
            f"/api/v1/journeys/{journey_id}/packing/{packing.json()['id']}/progress",
            headers=csrf(client),
            json={
                "expected_record_version": packing.json()["record_version"],
                "packed_quantity": 1,
            },
        )
        assert packed.status_code == 200
        assert packed.json()["packed_quantity"] == 1


async def command_audit_rows(user_id: str, workspace_id: str, command_id: str) -> dict[str, Any]:
    engine = create_async_engine(DATABASE_URL, hide_parameters=True)
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "SELECT set_config('trax.user_id', :user_id, true), "
                "set_config('trax.workspace_id', :workspace_id, true)"
            ),
            {"user_id": user_id, "workspace_id": workspace_id},
        )
        receipt = (
            (
                await connection.execute(
                    text(
                        "SELECT outcome, result_record_version, change_set_id "
                        "FROM command_receipts "
                        "WHERE command_id=:command_id"
                    ),
                    {"command_id": command_id},
                )
            )
            .mappings()
            .one_or_none()
        )
        counts = (
            (
                await connection.execute(
                    text(
                        "SELECT (SELECT count(*) FROM command_change_sets "
                        "WHERE command_id=:command_id) change_sets, "
                        "(SELECT count(*) FROM command_change_events event "
                        "JOIN command_change_sets change_set "
                        "ON change_set.id=event.change_set_id "
                        "WHERE change_set.command_id=:command_id) events"
                    ),
                    {"command_id": command_id},
                )
            )
            .mappings()
            .one()
        )
        event = (
            (
                await connection.execute(
                    text(
                        "SELECT event.before_state, event.after_state "
                        "FROM command_change_events event "
                        "JOIN command_change_sets change_set ON change_set.id=event.change_set_id "
                        "WHERE change_set.command_id=:command_id"
                    ),
                    {"command_id": command_id},
                )
            )
            .mappings()
            .one_or_none()
        )
    await engine.dispose()
    return {
        "receipt": dict(receipt) if receipt else None,
        "counts": dict(counts),
        "event": dict(event) if event else None,
    }


def normalized_error(response: Any) -> dict[str, Any]:
    body = response.json()
    body["error"]["request_id"] = "<request-id>"
    return {"status": response.status_code, "body": body}


async def set_membership_role(user_id: str, workspace_id: str, role: str) -> None:
    engine = create_async_engine(ADMIN_DATABASE_URL, hide_parameters=True)
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "UPDATE workspace_memberships SET role=:role "
                "WHERE user_id=:user_id AND workspace_id=:workspace_id"
            ),
            {"role": role, "user_id": user_id, "workspace_id": workspace_id},
        )
    await engine.dispose()


def canonical_update(
    client: TestClient,
    journey_id: str,
    command_id: str,
    expected_version: int,
    *,
    name: str = "Canonical update",
) -> Any:
    return client.post(
        "/api/v1/commands/journey.update",
        headers=csrf(client),
        json={
            "command_id": command_id,
            "command_type": "journey.update",
            "command_version": 1,
            "payload": {
                "journey_id": journey_id,
                "name": name,
                "start_date": "2027-04-01",
                "end_date": "2027-04-21",
                "status": "active",
                "expected_record_version": expected_version,
            },
        },
    )


def test_canonical_journey_update_is_atomic_idempotent_and_legacy_compatible() -> None:
    command_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    stale_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    with TestClient(create_app()) as client:
        account = register(client)
        journey = create_journey(client)
        unsupported_id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        unsupported = client.post(
            "/api/v1/commands/journey.update",
            headers=csrf(client),
            json={
                "command_id": unsupported_id,
                "command_type": "journey.update",
                "command_version": 2,
                "payload": {
                    "journey_id": journey["id"],
                    "name": "Unsupported",
                    "start_date": None,
                    "end_date": None,
                    "status": "active",
                    "expected_record_version": 1,
                },
            },
        )
        assert unsupported.status_code == 422
        assert unsupported.json()["error"]["code"] == "unsupported_command_version"
        assert asyncio.run(
            command_audit_rows(
                account["user"]["id"], account["user"]["workspace_id"], unsupported_id
            )
        ) == {
            "receipt": None,
            "counts": {"change_sets": 0, "events": 0},
            "event": None,
        }

        applied = canonical_update(client, journey["id"], command_id, 1)
        assert applied.status_code == 200, applied.text
        body = applied.json()
        assert body == {
            "command_id": command_id,
            "command_type": "journey.update",
            "command_version": 1,
            "outcome": "applied",
            "replayed": False,
            "change_set_id": body["change_set_id"],
            "result": {
                "entity_type": "journey",
                "entity_id": journey["id"],
                "record_version": 2,
            },
        }
        evidence = asyncio.run(
            command_audit_rows(account["user"]["id"], account["user"]["workspace_id"], command_id)
        )
        assert evidence["counts"] == {"change_sets": 1, "events": 1}
        assert evidence["receipt"]["outcome"] == "applied"
        assert evidence["receipt"]["result_record_version"] == 2
        assert evidence["event"]["before_state"]["name"] == "Japan"
        assert evidence["event"]["before_state"]["record_version"] == 1
        assert evidence["event"]["after_state"]["name"] == "Canonical update"
        assert evidence["event"]["after_state"]["record_version"] == 2

        replay = canonical_update(client, journey["id"], command_id, 1)
        assert replay.status_code == 200
        assert replay.json() == {**body, "replayed": True}
        assert asyncio.run(
            command_audit_rows(account["user"]["id"], account["user"]["workspace_id"], command_id)
        )["counts"] == {"change_sets": 1, "events": 1}

        changed = canonical_update(client, journey["id"], command_id, 1, name="Changed digest")
        assert changed.status_code == 409
        assert changed.json()["error"]["code"] == "idempotency_conflict"
        changed_version_body = {
            "command_id": command_id,
            "command_type": "journey.update",
            "command_version": 2,
            "payload": {
                "journey_id": journey["id"],
                "name": "Canonical update",
                "start_date": "2027-04-01",
                "end_date": "2027-04-21",
                "status": "active",
                "expected_record_version": 1,
            },
        }
        changed_version = client.post(
            "/api/v1/commands/journey.update",
            headers=csrf(client),
            json=changed_version_body,
        )
        assert changed_version.status_code == 422
        assert changed_version.json()["error"]["code"] == "unsupported_command_version"

        stale = canonical_update(client, journey["id"], stale_id, 1, name="Stale")
        assert stale.status_code == 409
        assert stale.json()["error"]["code"] == "version_conflict"
        legacy = client.put(
            f"/api/v1/journeys/{journey['id']}",
            headers=csrf(client),
            json={
                "name": "Legacy adapter",
                "start_date": None,
                "end_date": None,
                "status": "planning",
                "expected_record_version": 2,
            },
        )
        assert legacy.status_code == 200
        assert legacy.json()["name"] == "Legacy adapter"
        assert legacy.json()["record_version"] == 3
        stale_replay = canonical_update(client, journey["id"], stale_id, 1, name="Stale")
        assert stale_replay.status_code == 409
        assert stale_replay.json()["error"]["code"] == "version_conflict"
        stale_evidence = asyncio.run(
            command_audit_rows(account["user"]["id"], account["user"]["workspace_id"], stale_id)
        )
        assert stale_evidence["receipt"]["outcome"] == "version_conflict"
        assert stale_evidence["counts"] == {"change_sets": 0, "events": 0}


def test_workspace_isolation_and_privacy_neutral_not_found() -> None:
    first = TestClient(create_app())
    second = TestClient(create_app())
    with first, second:
        register(first, "first@axetech.nl")
        private = create_journey(first, "Private")
        second_account = register(second, "second@axetech.nl")

        hidden = second.get(f"/api/v1/journeys/{private['id']}")
        assert hidden.status_code == 404
        assert hidden.json()["error"]["code"] == "resource_not_found"
        assert second.get("/api/v1/journeys").json() == {"items": []}
        hidden_command_id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
        hidden_update = canonical_update(second, private["id"], hidden_command_id, 1)
        assert hidden_update.status_code == 404
        assert hidden_update.json()["error"]["code"] == "resource_not_found"
        hidden_evidence = asyncio.run(
            command_audit_rows(
                second_account["user"]["id"],
                second_account["user"]["workspace_id"],
                hidden_command_id,
            )
        )
        assert hidden_evidence["receipt"]["outcome"] == "resource_not_found"
        assert hidden_evidence["counts"] == {"change_sets": 0, "events": 0}
        hidden_replay = canonical_update(second, private["id"], hidden_command_id, 1)
        assert normalized_error(hidden_replay) == normalized_error(hidden_update)

        missing_command_id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
        missing_update = canonical_update(
            second,
            "ffffffff-ffff-4fff-8fff-ffffffffffff",
            missing_command_id,
            1,
        )
        assert normalized_error(missing_update) == normalized_error(hidden_update)

        deleted = first.delete(f"/api/v1/journeys/{private['id']}", headers=csrf(first))
        assert deleted.status_code == 204
        assert first.get(f"/api/v1/journeys/{private['id']}").status_code == 404


def test_viewer_is_denied_consistently_across_every_journey_mutation_route() -> None:
    with TestClient(create_app()) as client:
        account = register(client, "viewer-routes@axetech.nl")
        journey = create_journey(client, "Immutable for viewer")
        journey_id = journey["id"]
        segment_response = client.post(
            f"/api/v1/journeys/{journey_id}/segments",
            headers=csrf(client),
            json={"kind": "stay", "place_name": "Utrecht"},
        )
        packing_response = client.post(
            f"/api/v1/journeys/{journey_id}/packing",
            headers=csrf(client),
            json={
                "label": "Passport",
                "category": "documents",
                "quantity": 1,
                "essential": True,
            },
        )
        assert segment_response.status_code == packing_response.status_code == 201
        segment = segment_response.json()
        packing = packing_response.json()
        current_journey = client.get(f"/api/v1/journeys/{journey_id}").json()
        before_segments = client.get(f"/api/v1/journeys/{journey_id}/segments").json()
        before_packing = client.get(f"/api/v1/journeys/{journey_id}/packing").json()

        asyncio.run(
            set_membership_role(account["user"]["id"], account["user"]["workspace_id"], "VIEWER")
        )
        command_id = "14141414-1414-4414-8414-141414141414"
        requests = (
            ("POST", "/api/v1/journeys", {"name": "Denied create"}),
            (
                "PUT",
                f"/api/v1/journeys/{journey_id}",
                {
                    "name": "Denied update",
                    "start_date": None,
                    "end_date": None,
                    "status": "active",
                    "expected_record_version": current_journey["record_version"],
                },
            ),
            (
                "POST",
                "/api/v1/commands/journey.update",
                {
                    "command_id": command_id,
                    "command_type": "journey.update",
                    "command_version": 1,
                    "payload": {
                        "journey_id": journey_id,
                        "name": "Denied canonical update",
                        "start_date": None,
                        "end_date": None,
                        "status": "active",
                        "expected_record_version": current_journey["record_version"],
                    },
                },
            ),
            ("DELETE", f"/api/v1/journeys/{journey_id}", None),
            (
                "POST",
                f"/api/v1/journeys/{journey_id}/segments",
                {"kind": "stay", "place_name": "Denied"},
            ),
            (
                "PUT",
                f"/api/v1/journeys/{journey_id}/segments/{segment['id']}",
                {
                    "kind": "stay",
                    "place_name": "Denied",
                    "expected_record_version": segment["record_version"],
                },
            ),
            (
                "POST",
                f"/api/v1/journeys/{journey_id}/segments/{segment['id']}/reorder",
                {"expected_record_version": segment["record_version"], "new_position": 0},
            ),
            (
                "DELETE",
                f"/api/v1/journeys/{journey_id}/segments/{segment['id']}",
                None,
            ),
            (
                "POST",
                f"/api/v1/journeys/{journey_id}/packing",
                {
                    "label": "Denied",
                    "category": "other",
                    "quantity": 1,
                    "essential": False,
                },
            ),
            (
                "PUT",
                f"/api/v1/journeys/{journey_id}/packing/{packing['id']}",
                {
                    "label": "Denied",
                    "category": "other",
                    "quantity": 1,
                    "essential": False,
                    "expected_record_version": packing["record_version"],
                },
            ),
            (
                "PUT",
                f"/api/v1/journeys/{journey_id}/packing/{packing['id']}/progress",
                {
                    "packed_quantity": 1,
                    "expected_record_version": packing["record_version"],
                },
            ),
            (
                "DELETE",
                f"/api/v1/journeys/{journey_id}/packing/{packing['id']}",
                None,
            ),
        )
        denials = [
            client.request(method, path, headers=csrf(client), json=body)
            for method, path, body in requests
        ]
        normalized = [normalized_error(response) for response in denials]
        assert len(normalized) == 12
        assert all(item == normalized[0] for item in normalized)
        assert normalized[0] == {
            "status": 403,
            "body": {
                "error": {
                    "code": "journey_write_forbidden",
                    "message": "You do not have permission to change this journey.",
                    "details": {},
                    "request_id": "<request-id>",
                }
            },
        }
        assert client.get(f"/api/v1/journeys/{journey_id}").json() == current_journey
        assert client.get(f"/api/v1/journeys/{journey_id}/segments").json() == before_segments
        assert client.get(f"/api/v1/journeys/{journey_id}/packing").json() == before_packing
        assert asyncio.run(
            command_audit_rows(account["user"]["id"], account["user"]["workspace_id"], command_id)
        ) == {
            "receipt": None,
            "counts": {"change_sets": 0, "events": 0},
            "event": None,
        }


def test_current_permission_masks_applied_replay_and_changed_digest_equally() -> None:
    command_id = "12121212-1212-4212-8212-121212121212"
    unseen_id = "13131313-1313-4313-8313-131313131313"
    with TestClient(create_app()) as client:
        account = register(client, "permission@axetech.nl")
        journey = create_journey(client, "Permission")
        applied = canonical_update(client, journey["id"], command_id, 1, name="Applied")
        assert applied.status_code == 200
        asyncio.run(
            set_membership_role(account["user"]["id"], account["user"]["workspace_id"], "VIEWER")
        )
        exact = canonical_update(client, journey["id"], command_id, 1, name="Applied")
        changed = canonical_update(client, journey["id"], command_id, 1, name="Changed digest")
        unseen = canonical_update(client, journey["id"], unseen_id, 2, name="Unseen")
        assert normalized_error(exact) == normalized_error(changed) == normalized_error(unseen)
        assert exact.status_code == 403
        assert exact.json()["error"] == {
            "code": "journey_write_forbidden",
            "message": "You do not have permission to change this journey.",
            "details": {},
            "request_id": exact.json()["error"]["request_id"],
        }
        assert asyncio.run(
            command_audit_rows(account["user"]["id"], account["user"]["workspace_id"], command_id)
        )["counts"] == {"change_sets": 1, "events": 1}
        assert asyncio.run(
            command_audit_rows(account["user"]["id"], account["user"]["workspace_id"], unseen_id)
        ) == {
            "receipt": None,
            "counts": {"change_sets": 0, "events": 0},
            "event": None,
        }
