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
    "postgresql+asyncpg://trax:trax-development-only@127.0.0.1:5432/trax",
)


async def reset_database() -> None:
    engine = create_async_engine(DATABASE_URL)
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "TRUNCATE packing_items, journey_segments, journeys, "
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


def test_workspace_isolation_and_privacy_neutral_not_found() -> None:
    first = TestClient(create_app())
    second = TestClient(create_app())
    with first, second:
        register(first, "first@axetech.nl")
        private = create_journey(first, "Private")
        register(second, "second@axetech.nl")

        hidden = second.get(f"/api/v1/journeys/{private['id']}")
        assert hidden.status_code == 404
        assert hidden.json()["error"]["code"] == "resource_not_found"
        assert second.get("/api/v1/journeys").json() == {"items": []}

        deleted = first.delete(f"/api/v1/journeys/{private['id']}", headers=csrf(first))
        assert deleted.status_code == 204
        assert first.get(f"/api/v1/journeys/{private['id']}").status_code == 404
