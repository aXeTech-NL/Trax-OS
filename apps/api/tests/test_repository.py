import asyncio
from datetime import UTC, datetime
from os import getenv
from uuid import uuid4

from sqlalchemy import insert, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from trax_api.auth import AuthContext
from trax_api.journey_repository import JourneyRepository
from trax_api.schema import memberships, users, workspaces
from trax_api.server_errors import ApplicationError
from trax_api.server_models import (
    JourneyCreate,
    JourneyUpdate,
    PackingCreate,
    PackingProgressUpdate,
    PackingUpdate,
    SegmentCreate,
    SegmentUpdate,
)

DATABASE_URL = getenv(
    "TRAX_DATABASE_URL",
    "postgresql+asyncpg://trax:trax-development-only@127.0.0.1:5432/trax",
)


async def repository_scenario() -> None:
    engine = create_async_engine(DATABASE_URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    user_id = uuid4()
    workspace_id = uuid4()
    now = datetime.now(UTC)
    email = f"repository+{user_id.hex}@axetech.nl"
    async with sessions.begin() as session:
        await session.execute(
            insert(users).values(
                id=user_id,
                email=email,
                display_name="Repository",
                created_at=now,
            )
        )
        await session.execute(
            insert(workspaces).values(
                id=workspace_id,
                type="PERSONAL",
                name="Repository workspace",
                created_at=now,
            )
        )
        await session.execute(
            insert(memberships).values(
                user_id=user_id,
                workspace_id=workspace_id,
                role="OWNER",
                created_at=now,
            )
        )
    context = AuthContext(
        user_id=user_id,
        workspace_id=workspace_id,
        session_id=uuid4(),
        email=email,
        display_name="Repository",
    )

    async def scoped() -> tuple[AsyncSession, JourneyRepository]:
        session = sessions()
        await session.execute(
            text("SELECT set_config('trax.user_id', :user_id, true)"),
            {"user_id": str(user_id)},
        )
        return session, JourneyRepository(session, context)

    session, repository = await scoped()
    assert await repository.list_journeys() == []
    journey = await repository.create_journey(
        JourneyCreate(name="Direct", start_date=None, end_date=None)
    )
    await session.close()

    session, repository = await scoped()
    assert (await repository.get_journey(journey.id)).name == "Direct"
    assert len(await repository.list_journeys()) == 1
    journey = await repository.update_journey(
        journey.id,
        JourneyUpdate(
            name="Direct updated",
            start_date=None,
            end_date=None,
            status="active",
            expected_record_version=journey.record_version,
        ),
    )
    await session.close()

    session, repository = await scoped()
    try:
        await repository.update_journey(
            journey.id,
            JourneyUpdate(
                name="Stale",
                start_date=None,
                end_date=None,
                status="planning",
                expected_record_version=1,
            ),
        )
    except ApplicationError as error:
        assert error.code == "version_conflict"
    await session.close()

    session, repository = await scoped()
    stay = await repository.create_segment(
        journey.id, SegmentCreate(kind="stay", place_name="Utrecht")
    )
    await session.close()
    session, repository = await scoped()
    move = await repository.create_segment(
        journey.id,
        SegmentCreate(kind="move", origin_name="Utrecht", destination_name="Paris"),
    )
    await session.close()

    session, repository = await scoped()
    assert len(await repository.list_segments(journey.id)) == 2
    stay = await repository.update_segment(
        journey.id,
        stay.id,
        SegmentUpdate(
            kind="stay",
            place_name="Rotterdam",
            expected_record_version=stay.record_version,
        ),
    )
    await session.close()

    session, repository = await scoped()
    moved = await repository.reorder_segment(journey.id, move.id, move.record_version, 0)
    assert moved.position == 0
    await repository.delete_segment(journey.id, stay.id)
    await session.close()

    session, repository = await scoped()
    item = await repository.create_packing(
        journey.id,
        PackingCreate(label="Passport", category="documents", quantity=2, essential=True),
    )
    await session.close()
    session, repository = await scoped()
    assert len(await repository.list_packing(journey.id)) == 1
    item = await repository.update_packing(
        journey.id,
        item.id,
        PackingUpdate(
            label="Passports",
            category="documents",
            quantity=2,
            essential=True,
            expected_record_version=item.record_version,
        ),
    )
    await session.close()
    session, repository = await scoped()
    item = await repository.update_packing_progress(
        journey.id,
        item.id,
        PackingProgressUpdate(packed_quantity=2, expected_record_version=item.record_version),
    )
    assert item.packed_quantity == 2
    await session.close()
    session, repository = await scoped()
    await repository.delete_packing(journey.id, item.id)
    await session.close()
    session, repository = await scoped()
    await repository.delete_journey(journey.id)
    await session.close()
    session, repository = await scoped()
    try:
        await repository.get_journey(journey.id)
    except ApplicationError as error:
        assert error.status_code == 404
    await session.close()
    await engine.dispose()


def test_repository_contract_directly() -> None:
    asyncio.run(repository_scenario())
