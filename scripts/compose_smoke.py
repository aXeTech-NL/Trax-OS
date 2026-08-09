#!/usr/bin/env python3
"""Privacy-neutral, schema-backed smoke test for the Compose evaluation stack."""

from __future__ import annotations

import json
import os
import re
import secrets
import sys
from http.cookiejar import CookieJar
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import HTTPCookieProcessor, Request, build_opener
from uuid import uuid4

BASE_URL = os.environ.get("TRAX_SMOKE_URL", "http://web:8080").rstrip("/") + "/"
TIMEOUT_SECONDS = 10
MAX_RESPONSE_BYTES = 1024 * 1024
UUID_PATH_SEGMENT = re.compile(
    r"/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}"
    r"-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


class SmokeFailure(RuntimeError):
    """A bounded failure that never includes response bodies or credentials."""


class Client:
    def __init__(self) -> None:
        self.cookies = CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.cookies))

    def request(
        self,
        path: str,
        *,
        method: str = "GET",
        payload: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        expected_status: int = 200,
    ) -> tuple[Any, dict[str, str]]:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request_headers = {"Accept": "application/json", **(headers or {})}
        if data is not None:
            request_headers["Content-Type"] = "application/json"
        request = Request(
            urljoin(BASE_URL, path.lstrip("/")),
            data=data,
            headers=request_headers,
            method=method,
        )
        try:
            response = self.opener.open(request, timeout=TIMEOUT_SECONDS)
            status = response.status
            body = read_bounded(response, method, path)
            response_headers = {
                key.lower(): value for key, value in response.headers.items()
            }
        except HTTPError as error:
            status = error.code
            body = read_bounded(error, method, path)
            response_headers = {
                key.lower(): value for key, value in error.headers.items()
            }
        except (TimeoutError, URLError) as error:
            raise SmokeFailure(
                f"{method} {safe_path(path)} could not reach the stack"
            ) from error

        if status != expected_status:
            raise SmokeFailure(
                f"{method} {safe_path(path)} returned HTTP {status}, "
                f"expected {expected_status}"
            )
        if status == 204:
            return None, response_headers
        try:
            return json.loads(body), response_headers
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise SmokeFailure(
                f"{method} {safe_path(path)} did not return JSON"
            ) from error

    def text(self, path: str) -> tuple[str, dict[str, str]]:
        request = Request(urljoin(BASE_URL, path.lstrip("/")), method="GET")
        try:
            response = self.opener.open(request, timeout=TIMEOUT_SECONDS)
            body = read_bounded(response, "GET", path).decode("utf-8")
            return body, {key.lower(): value for key, value in response.headers.items()}
        except (HTTPError, TimeoutError, URLError, UnicodeDecodeError) as error:
            raise SmokeFailure(
                f"GET {safe_path(path)} did not return the web application"
            ) from error

    def csrf_header(self) -> dict[str, str]:
        token = next(
            (cookie.value for cookie in self.cookies if cookie.name == "trax_csrf"),
            None,
        )
        if token is None:
            raise SmokeFailure("registration did not establish the CSRF cookie")
        return {"X-CSRF-Token": token}


def safe_path(path: str) -> str:
    return UUID_PATH_SEGMENT.sub("/{id}", path)


def read_bounded(response: Any, method: str, path: str) -> bytes:
    body: bytes = response.read(MAX_RESPONSE_BYTES + 1)
    if len(body) > MAX_RESPONSE_BYTES:
        raise SmokeFailure(
            f"{method} {safe_path(path)} exceeded the response size limit"
        )
    return body


def require(condition: bool, stage: str) -> None:
    if not condition:
        raise SmokeFailure(f"unexpected response during {stage}")


def object_payload(payload: Any, stage: str) -> dict[str, Any]:
    require(isinstance(payload, dict), stage)
    return payload


def exercise_authenticated_flow(client: Client) -> None:
    journey_id: str | None = None
    registration_attempted = False
    failure: SmokeFailure | None = None
    cleanup_failures: list[SmokeFailure] = []
    try:
        email = f"compose-smoke-{uuid4().hex}@invalid.example"
        password = secrets.token_urlsafe(32)
        registration_attempted = True
        registered, _ = client.request(
            "/api/v1/auth/register",
            method="POST",
            payload={
                "email": email,
                "password": password,
                "display_name": "Compose smoke",
            },
            expected_status=201,
        )
        registered = object_payload(registered, "registration")
        require(registered.get("authenticated") is True, "registration")

        blocked, _ = client.request(
            "/api/v1/journeys",
            method="POST",
            payload={"name": "Blocked smoke journey"},
            expected_status=403,
        )
        blocked = object_payload(blocked, "CSRF rejection")
        blocked_error = blocked.get("error")
        require(
            isinstance(blocked_error, dict)
            and blocked_error.get("code") == "csrf_failed",
            "CSRF rejection",
        )

        journeys, _ = client.request("/api/v1/journeys")
        require(journeys == {"items": []}, "empty migrated workspace")

        created, _ = client.request(
            "/api/v1/journeys",
            method="POST",
            payload={"name": "Compose smoke journey"},
            headers=client.csrf_header(),
            expected_status=201,
        )
        created = object_payload(created, "Journey creation")
        created_id = created.get("id")
        require(isinstance(created_id, str), "Journey creation")
        journey_id = created_id

        journeys, _ = client.request("/api/v1/journeys")
        journeys = object_payload(journeys, "Journey query")
        journey_items = journeys.get("items")
        require(
            isinstance(journey_items, list)
            and len(journey_items) == 1
            and isinstance(journey_items[0], dict)
            and journey_items[0].get("name") == "Compose smoke journey",
            "Journey query",
        )
    except SmokeFailure as error:
        failure = error
    finally:
        unhandled_failure = sys.exc_info()[0] is not None and failure is None
        if journey_id is not None:
            try:
                client.request(
                    f"/api/v1/journeys/{journey_id}",
                    method="DELETE",
                    headers=client.csrf_header(),
                    expected_status=204,
                )
                journeys, _ = client.request("/api/v1/journeys")
                require(journeys == {"items": []}, "Journey cleanup")
            except SmokeFailure as error:
                cleanup_failures.append(error)
        if registration_attempted:
            try:
                logged_out, _ = client.request(
                    "/api/v1/auth/logout",
                    method="POST",
                    headers=client.csrf_header(),
                )
                require(logged_out == {"authenticated": False}, "logout")
            except SmokeFailure as error:
                cleanup_failures.append(error)
        if failure is None and cleanup_failures and not unhandled_failure:
            failure = cleanup_failures[0]

    if failure is not None:
        raise failure


def main() -> None:
    client = Client()

    root, root_headers = client.text("/")
    require("<title>Trax OS · Journeys</title>" in root, "web root")
    require("text/html" in root_headers.get("content-type", ""), "web content type")
    require("content-security-policy" in root_headers, "web security headers")

    deep_link, _ = client.text("/journeys/new")
    require("<title>Trax OS · Journeys</title>" in deep_link, "web deep link")

    live, live_headers = client.request("/health/live")
    require(live == {"status": "live"}, "API liveness")
    require(bool(live_headers.get("x-request-id")), "request ID proxying")

    ready, _ = client.request("/health/ready")
    require(
        ready
        == {
            "status": "ready",
            "checks": {"api": "ready", "database": "ready"},
        },
        "API readiness",
    )

    version, _ = client.request("/api/v1/version")
    version = object_payload(version, "version discovery")
    require(
        version.get("application") == "Trax OS" and version.get("api_version") == "1",
        "version discovery",
    )

    capabilities, _ = client.request("/api/v1/capabilities")
    capabilities = object_payload(capabilities, "capability discovery")
    capability_items = capabilities.get("capabilities")
    if not isinstance(capability_items, list) or not all(
        isinstance(item, dict) for item in capability_items
    ):
        raise SmokeFailure("unexpected response during capability discovery")
    capability_keys = {
        item.get("key")
        for item in capability_items
        if item.get("status") == "available"
    }
    require(
        {"foundation.contract-discovery", "identity.password-session"}
        <= capability_keys,
        "capability discovery",
    )

    anonymous, _ = client.request(
        "/api/v1/auth/session",
        expected_status=401,
    )
    anonymous = object_payload(anonymous, "anonymous auth")
    anonymous_error = anonymous.get("error")
    require(
        isinstance(anonymous_error, dict)
        and anonymous_error.get("code") == "authentication_required",
        "anonymous auth",
    )

    exercise_authenticated_flow(client)

    print(
        "Compose smoke passed: static web, same-origin API, readiness, "
        "migration-backed auth/Journey, CSRF, and cleanup."
    )


if __name__ == "__main__":
    try:
        main()
    except SmokeFailure as error:
        raise SystemExit(f"Compose smoke failed: {error}") from None
