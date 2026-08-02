import asyncio
from datetime import date

import pytest
from pydantic import ValidationError

from trax_api.database import Database
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
    assert asyncio.run(database.ready()) is False
    asyncio.run(database.close())
