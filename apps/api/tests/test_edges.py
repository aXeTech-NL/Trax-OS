import asyncio
import json
import logging
from datetime import date

import pytest
from pydantic import ValidationError
from starlette.requests import Request
from starlette.responses import Response

from trax_api.database import Database
from trax_api.request_id import request_id_middleware
from trax_api.server_errors import application_error_handler
from trax_api.server_models import SegmentCreate
from trax_api.settings import Settings


def test_segment_validation_rejects_incomplete_and_reversed_details() -> None:
    with pytest.raises(ValidationError):
        SegmentCreate(kind="stay")
    with pytest.raises(ValidationError):
        SegmentCreate(kind="move", origin_name="Only origin")
    with pytest.raises(ValidationError):
        SegmentCreate(
            kind="stay",
            place_name="Utrecht",
            start_date=date(2027, 5, 2),
            end_date=date(2027, 5, 1),
        )


def test_unexpected_application_error_type_is_reraised() -> None:
    error = RuntimeError("probe")
    with pytest.raises(RuntimeError, match="probe"):
        asyncio.run(application_error_handler(None, error))  # type: ignore[arg-type]


def test_database_readiness_converts_connection_failure() -> None:
    database = Database(
        Settings(
            database_url="postgresql+asyncpg://trax:invalid@127.0.0.1:1/missing",
            session_cookie_secure=False,
            session_ttl_seconds=60,
        )
    )
    assert database.engine.sync_engine.hide_parameters is True
    assert asyncio.run(database.ready()) is False
    asyncio.run(database.close())


def test_unexpected_errors_log_only_sanitized_constant_and_return_stable_envelope(
    caplog: pytest.LogCaptureFixture,
) -> None:
    secret = "payload-secret command=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa digest=deadbeef"
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/failure",
            "headers": [(b"x-request-id", b"safe-request")],
        }
    )

    async def fail(_request: Request) -> Response:
        raise RuntimeError(secret)

    with caplog.at_level(logging.ERROR, logger="trax_api.request_id"):
        response = asyncio.run(request_id_middleware(request, fail))
    payload = json.loads(response.body)
    assert response.status_code == 500
    assert payload["error"]["code"] == "internal_error"
    assert payload["error"]["request_id"] == "safe-request"
    assert caplog.messages == ["Unhandled exception while serving request"]
    assert "payload-secret" not in caplog.text
    assert "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" not in caplog.text
    assert "deadbeef" not in caplog.text
