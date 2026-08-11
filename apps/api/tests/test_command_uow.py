import asyncio
from dataclasses import replace
from datetime import UTC, datetime
from os import getenv
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, insert, select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from trax_api.application_errors import ApplicationError
from trax_api.auth import AuthContext
from trax_api.command_executor import CommandExecution, CommandExecutor
from trax_api.journey_repository import JourneyUpdateMutation
from trax_api.schema import (
    command_change_events,
    command_change_sets,
    command_receipts,
    journeys,
    memberships,
    users,
    workspaces,
)
from trax_api.server_models import JourneyUpdateCommandPayload

DATABASE_URL = getenv(
    "TRAX_DATABASE_URL",
    "postgresql+asyncpg://trax_app:trax-application-development-only@127.0.0.1:5432/trax",
)
ADMIN_DATABASE_URL = getenv(
    "TRAX_ADMIN_DATABASE_URL",
    "postgresql+asyncpg://trax_admin:trax-admin-development-only@127.0.0.1:5432/trax",
)


async def seed(*, role: str = "OWNER") -> tuple[AsyncEngine, AuthContext, UUID]:
    admin_engine = create_async_engine(ADMIN_DATABASE_URL, hide_parameters=True)
    engine = create_async_engine(DATABASE_URL, hide_parameters=True)
    user_id, workspace_id, journey_id = uuid4(), uuid4(), uuid4()
    now = datetime.now(UTC)
    async with admin_engine.begin() as connection:
        await connection.execute(
            insert(users).values(
                id=user_id,
                email=f"command-{user_id}@example.com",
                display_name="Command test",
                created_at=now,
            )
        )
        await connection.execute(
            insert(workspaces).values(
                id=workspace_id, type="PERSONAL", name="Command", created_at=now
            )
        )
        await connection.execute(
            insert(memberships).values(
                workspace_id=workspace_id,
                user_id=user_id,
                role=role,
                created_at=now,
            )
        )
        await connection.execute(
            text(
                "SELECT set_config('trax.user_id', :user_id, true), "
                "set_config('trax.workspace_id', :workspace_id, true)"
            ),
            {"user_id": str(user_id), "workspace_id": str(workspace_id)},
        )
        await connection.execute(
            insert(journeys).values(
                id=journey_id,
                workspace_id=workspace_id,
                name="Before",
                start_date=None,
                end_date=None,
                status="planning",
                record_version=1,
                created_at=now,
                updated_at=now,
            )
        )
    await admin_engine.dispose()
    context = AuthContext(
        user_id=user_id,
        workspace_id=workspace_id,
        session_id=uuid4(),
        email=f"command-{user_id}@example.com",
        display_name="Command test",
        role=role,
    )
    return engine, context, journey_id


async def set_role(context: AuthContext, role: str) -> None:
    admin_engine = create_async_engine(ADMIN_DATABASE_URL, hide_parameters=True)
    async with admin_engine.begin() as connection:
        await connection.execute(
            update(memberships)
            .where(
                memberships.c.workspace_id == context.workspace_id,
                memberships.c.user_id == context.user_id,
            )
            .values(role=role)
        )
    await admin_engine.dispose()


async def scoped_session(engine: AsyncEngine, context: AuthContext) -> AsyncSession:
    maker = async_sessionmaker(engine, expire_on_commit=False)
    session = maker()
    await session.execute(
        text(
            "SELECT set_config('trax.user_id', :user_id, true), "
            "set_config('trax.workspace_id', :workspace_id, true)"
        ),
        {"user_id": str(context.user_id), "workspace_id": str(context.workspace_id)},
    )
    return session


def payload(journey_id: UUID, expected: int, name: str) -> JourneyUpdateCommandPayload:
    return JourneyUpdateCommandPayload(
        journey_id=journey_id,
        name=name,
        start_date=None,
        end_date=None,
        status="active",
        expected_record_version=expected,
    )


async def row_counts(engine: AsyncEngine, context: AuthContext, command_id: UUID) -> dict[str, int]:
    session = await scoped_session(engine, context)
    result = await session.execute(
        select(
            select(func.count())
            .select_from(command_receipts)
            .where(command_receipts.c.command_id == command_id)
            .scalar_subquery()
            .label("receipts"),
            select(func.count())
            .select_from(command_change_sets)
            .where(command_change_sets.c.command_id == command_id)
            .scalar_subquery()
            .label("change_sets"),
            select(func.count())
            .select_from(command_change_events)
            .join(command_change_sets)
            .where(command_change_sets.c.command_id == command_id)
            .scalar_subquery()
            .label("events"),
        )
    )
    row = result.mappings().one()
    await session.rollback()
    await session.close()
    return {key: int(row[key]) for key in ("receipts", "change_sets", "events")}


async def execute(
    engine: AsyncEngine,
    context: AuthContext,
    journey_id: UUID,
    command_id: UUID,
    expected: int,
    name: str,
    *,
    audit_writer=None,
    after_authorization=None,
):
    session = await scoped_session(engine, context)
    try:
        return await CommandExecutor(
            session,
            context,
            audit_writer=audit_writer,
            after_authorization=after_authorization,
        ).execute_journey_update(
            command_id=command_id,
            command_type="journey.update",
            command_version=1,
            payload=payload(journey_id, expected, name),
            origin="web",
        )
    finally:
        await session.close()


async def concurrency_scenario() -> None:
    engine, context, journey_id = await seed()
    same_id = uuid4()
    first, second = await asyncio.gather(
        execute(engine, context, journey_id, same_id, 1, "Same"),
        execute(engine, context, journey_id, same_id, 1, "Same"),
    )
    assert {first.replayed, second.replayed} == {False, True}
    assert first.change_set_id == second.change_set_id
    assert await row_counts(engine, context, same_id) == {
        "receipts": 1,
        "change_sets": 1,
        "events": 1,
    }

    ids = (uuid4(), uuid4())
    results = await asyncio.gather(
        execute(engine, context, journey_id, ids[0], 2, "Winner one"),
        execute(engine, context, journey_id, ids[1], 2, "Winner two"),
        return_exceptions=True,
    )
    assert sum(not isinstance(result, BaseException) for result in results) == 1
    failures = [result for result in results if isinstance(result, ApplicationError)]
    assert len(failures) == 1 and failures[0].code == "version_conflict"
    counts = [await row_counts(engine, context, command_id) for command_id in ids]
    assert sorted(item["change_sets"] for item in counts) == [0, 1]
    assert all(item["receipts"] == 1 for item in counts)
    await engine.dispose()


def test_concurrent_same_and_competing_commands_are_serialized() -> None:
    asyncio.run(concurrency_scenario())


async def committed_preimage_scenario() -> None:
    engine, context, journey_id = await seed()
    admin_engine = create_async_engine(ADMIN_DATABASE_URL, hide_parameters=True)
    admin_connection = await admin_engine.connect()
    admin_transaction = await admin_connection.begin()
    await admin_connection.execute(
        update(journeys)
        .where(journeys.c.id == journey_id, journeys.c.record_version == 1)
        .values(
            name="Concurrent committed version",
            status="active",
            record_version=2,
            updated_at=datetime.now(UTC),
        )
    )

    command_id = uuid4()
    in_flight = asyncio.create_task(
        execute(
            engine,
            context,
            journey_id,
            command_id,
            2,
            "Command version three",
        )
    )
    await asyncio.sleep(0.1)
    assert not in_flight.done(), "Journey row lock must wait for the concurrent writer"
    await admin_transaction.commit()
    await admin_connection.close()
    execution = await asyncio.wait_for(in_flight, 5)
    assert execution.record_version == 3

    session = await scoped_session(engine, context)
    event = (
        (
            await session.execute(
                select(
                    command_change_events.c.before_state,
                    command_change_events.c.after_state,
                )
                .join(command_change_sets)
                .where(command_change_sets.c.command_id == command_id)
            )
        )
        .mappings()
        .one()
    )
    assert event["before_state"]["name"] == "Concurrent committed version"
    assert event["before_state"]["record_version"] == 2
    assert event["after_state"]["name"] == "Command version three"
    assert event["after_state"]["record_version"] == 3
    await session.rollback()
    await session.close()
    await admin_engine.dispose()
    await engine.dispose()


def test_audit_preimage_is_exact_locked_version_after_concurrent_commit() -> None:
    asyncio.run(committed_preimage_scenario())


async def missing_replay_scenario() -> None:
    engine, context, _journey_id = await seed()
    command_id, missing_id = uuid4(), uuid4()
    errors: list[tuple[int, str, str]] = []
    for _ in range(2):
        with pytest.raises(ApplicationError) as caught:
            await execute(engine, context, missing_id, command_id, 1, "Missing")
        errors.append((caught.value.status_code, caught.value.code, caught.value.message))
    assert errors == [
        (404, "resource_not_found", "Resource not found."),
        (404, "resource_not_found", "Resource not found."),
    ]
    assert await row_counts(engine, context, command_id) == {
        "receipts": 1,
        "change_sets": 0,
        "events": 0,
    }
    await engine.dispose()


def test_resource_not_found_receipt_replays_exact_terminal_outcome() -> None:
    asyncio.run(missing_replay_scenario())


async def rollback_scenario() -> None:
    engine, context, journey_id = await seed()
    command_id = uuid4()

    async def fail_audit(
        session: AsyncSession,
        audit_context: AuthContext,
        execution: CommandExecution,
        mutation: JourneyUpdateMutation,
        _request_digest: str,
        _origin: str,
        _reversibility: str,
    ) -> None:
        assert execution.change_set_id is not None
        now = datetime.now(UTC)
        await session.execute(
            insert(command_change_sets).values(
                id=execution.change_set_id,
                workspace_id=audit_context.workspace_id,
                actor_user_id=audit_context.user_id,
                command_id=execution.command_id,
                command_type=execution.command_type,
                command_version=execution.command_version,
                origin="web",
                reversibility="full",
                entity_type="journey",
                entity_id=execution.entity_id,
                created_at=now,
            )
        )
        await session.execute(
            insert(command_change_events).values(
                id=uuid4(),
                change_set_id=execution.change_set_id,
                workspace_id=audit_context.workspace_id,
                actor_user_id=audit_context.user_id,
                sequence=1,
                entity_type="journey",
                entity_id=execution.entity_id,
                action="updated",
                before_state=mutation.before.model_dump(mode="json"),
                after_state=mutation.after.model_dump(mode="json"),
                created_at=now,
            )
        )
        raise RuntimeError("injected audit write failure after durable statements")

    with pytest.raises(RuntimeError, match="injected audit"):
        await execute(
            engine,
            context,
            journey_id,
            command_id,
            1,
            "Must roll back",
            audit_writer=fail_audit,
        )
    assert await row_counts(engine, context, command_id) == {
        "receipts": 0,
        "change_sets": 0,
        "events": 0,
    }
    session = await scoped_session(engine, context)
    row = (await session.execute(select(journeys.c.name, journeys.c.record_version))).one()
    assert tuple(row) == ("Before", 1)
    await session.rollback()
    await session.close()
    await engine.dispose()


def test_audit_failure_rolls_back_mutation_and_all_command_state() -> None:
    asyncio.run(rollback_scenario())


async def authority_and_rls_scenario() -> None:
    engine, context, journey_id = await seed(role="VIEWER")
    denied_id = uuid4()
    with pytest.raises(ApplicationError) as denied:
        await execute(engine, context, journey_id, denied_id, 1, "Denied")
    assert denied.value.code == "journey_write_forbidden"
    assert await row_counts(engine, context, denied_id) == {
        "receipts": 0,
        "change_sets": 0,
        "events": 0,
    }

    await set_role(context, "OWNER")
    owner = replace(context, role="OWNER")
    applied_id = uuid4()
    applied_execution = await execute(engine, owner, journey_id, applied_id, 1, "Applied")
    assert applied_execution.change_set_id is not None
    await set_role(context, "VIEWER")
    with pytest.raises(ApplicationError) as replay_denied:
        await execute(engine, context, journey_id, applied_id, 1, "Applied")
    assert replay_denied.value.code == "journey_write_forbidden"
    assert await row_counts(engine, context, applied_id) == {
        "receipts": 1,
        "change_sets": 1,
        "events": 1,
    }

    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def configure(
        session: AsyncSession, user_id: UUID | None, workspace_id: UUID | None
    ) -> None:
        if user_id is not None:
            await session.execute(
                text("SELECT set_config('trax.user_id', :value, true)"),
                {"value": str(user_id)},
            )
        if workspace_id is not None:
            await session.execute(
                text("SELECT set_config('trax.workspace_id', :value, true)"),
                {"value": str(workspace_id)},
            )

    now = datetime.now(UTC)
    insert_statements = (
        insert(journeys).values(
            id=uuid4(),
            workspace_id=context.workspace_id,
            name="RLS denied",
            status="planning",
            record_version=1,
            created_at=now,
            updated_at=now,
        ),
        insert(command_change_sets).values(
            id=uuid4(),
            workspace_id=context.workspace_id,
            actor_user_id=context.user_id,
            command_id=uuid4(),
            command_type="journey.update",
            command_version=1,
            origin="web",
            reversibility="full",
            entity_type="journey",
            entity_id=journey_id,
            created_at=now,
        ),
        insert(command_change_events).values(
            id=uuid4(),
            change_set_id=applied_execution.change_set_id,
            workspace_id=context.workspace_id,
            actor_user_id=context.user_id,
            sequence=1,
            entity_type="journey",
            entity_id=journey_id,
            action="updated",
            before_state={},
            after_state={},
            created_at=now,
        ),
        insert(command_receipts).values(
            workspace_id=context.workspace_id,
            actor_user_id=context.user_id,
            command_id=uuid4(),
            command_type="journey.update",
            command_version=1,
            digest_version=1,
            request_digest="0" * 64,
            outcome="resource_not_found",
            entity_type="journey",
            entity_id=uuid4(),
            result_record_version=None,
            change_set_id=None,
            created_at=now,
        ),
    )
    for user_id, workspace_id in (
        (None, None),
        (uuid4(), context.workspace_id),
        (context.user_id, uuid4()),
    ):
        hidden = maker()
        await configure(hidden, user_id, workspace_id)
        for table in (journeys, command_receipts, command_change_sets, command_change_events):
            assert (await hidden.execute(select(func.count()).select_from(table))).scalar_one() == 0
        await hidden.rollback()
        await hidden.close()
        for statement in insert_statements:
            denied_insert = maker()
            await configure(denied_insert, user_id, workspace_id)
            with pytest.raises(DBAPIError):
                await denied_insert.execute(statement)
            await denied_insert.rollback()
            await denied_insert.close()
    await engine.dispose()


def test_current_permission_precedes_replay_and_rls_requires_selected_workspace() -> None:
    asyncio.run(authority_and_rls_scenario())


async def demotion_race_scenario() -> None:
    engine, context, journey_id = await seed()
    command_id = uuid4()
    authorized = asyncio.Event()
    release = asyncio.Event()

    async def hold_after_authorization() -> None:
        authorized.set()
        await release.wait()

    async def demote() -> None:
        admin_engine = create_async_engine(ADMIN_DATABASE_URL, hide_parameters=True)
        async with admin_engine.begin() as connection:
            await connection.execute(
                update(memberships)
                .where(
                    memberships.c.workspace_id == context.workspace_id,
                    memberships.c.user_id == context.user_id,
                )
                .values(role="VIEWER")
            )
        await admin_engine.dispose()

    in_flight = asyncio.create_task(
        execute(
            engine,
            context,
            journey_id,
            command_id,
            1,
            "Commit before demotion",
            after_authorization=hold_after_authorization,
        )
    )
    await asyncio.wait_for(authorized.wait(), 5)
    demotion = asyncio.create_task(demote())
    await asyncio.sleep(0.1)
    assert not demotion.done(), "FOR SHARE must serialize role demotion behind the command"
    release.set()
    applied = await asyncio.wait_for(in_flight, 5)
    assert applied.outcome == "applied"
    await asyncio.wait_for(demotion, 5)
    viewer = replace(context, role="VIEWER")
    with pytest.raises(ApplicationError) as replay:
        await execute(engine, viewer, journey_id, command_id, 1, "Commit before demotion")
    assert replay.value.code == "journey_write_forbidden"

    await set_role(context, "OWNER")
    await set_role(context, "VIEWER")
    denied_id = uuid4()
    with pytest.raises(ApplicationError) as denied:
        await execute(engine, viewer, journey_id, denied_id, 2, "Demoted first")
    assert denied.value.code == "journey_write_forbidden"
    assert await row_counts(engine, viewer, denied_id) == {
        "receipts": 0,
        "change_sets": 0,
        "events": 0,
    }
    await engine.dispose()


def test_role_demotion_serializes_with_in_flight_command_and_then_denies_replay() -> None:
    asyncio.run(demotion_race_scenario())


async def add_actor(workspace_id: UUID, *, role: str = "EDITOR") -> AuthContext:
    admin_engine = create_async_engine(ADMIN_DATABASE_URL, hide_parameters=True)
    user_id = uuid4()
    now = datetime.now(UTC)
    email = f"command-{user_id}@example.com"
    async with admin_engine.begin() as connection:
        await connection.execute(
            insert(users).values(
                id=user_id,
                email=email,
                display_name="Second command actor",
                created_at=now,
            )
        )
        await connection.execute(
            insert(memberships).values(
                workspace_id=workspace_id,
                user_id=user_id,
                role=role,
                created_at=now,
            )
        )
    await admin_engine.dispose()
    return AuthContext(
        user_id=user_id,
        workspace_id=workspace_id,
        session_id=uuid4(),
        email=email,
        display_name="Second command actor",
        role=role,
    )


async def same_workspace_actor_independence_scenario() -> None:
    engine, owner, journey_id = await seed()
    editor = await add_actor(owner.workspace_id)
    command_id = uuid4()
    first = await execute(engine, owner, journey_id, command_id, 1, "Owner")
    second = await execute(engine, editor, journey_id, command_id, 2, "Editor")
    assert not first.replayed and not second.replayed
    assert first.change_set_id != second.change_set_id
    assert await row_counts(engine, owner, command_id) == {
        "receipts": 1,
        "change_sets": 1,
        "events": 1,
    }
    assert await row_counts(engine, editor, command_id) == {
        "receipts": 1,
        "change_sets": 1,
        "events": 1,
    }
    owner_session = await scoped_session(engine, owner)
    assert (
        await owner_session.execute(
            select(func.count())
            .select_from(command_receipts)
            .where(command_receipts.c.actor_user_id == editor.user_id)
        )
    ).scalar_one() == 0
    assert (
        await owner_session.execute(
            select(func.count())
            .select_from(command_change_sets)
            .where(command_change_sets.c.actor_user_id == editor.user_id)
        )
    ).scalar_one() == 0
    assert (
        await owner_session.execute(
            select(func.count())
            .select_from(command_change_events)
            .where(command_change_events.c.actor_user_id == editor.user_id)
        )
    ).scalar_one() == 0
    await owner_session.rollback()
    await owner_session.close()
    await engine.dispose()


def test_same_command_uuid_is_independent_and_actor_rls_isolation_holds() -> None:
    asyncio.run(same_workspace_actor_independence_scenario())


async def workspace_independence_scenario() -> None:
    engine_one, context_one, journey_one = await seed()
    engine_two, context_two, journey_two = await seed()
    command_id = uuid4()
    one = await execute(engine_one, context_one, journey_one, command_id, 1, "One")
    two = await execute(engine_two, context_two, journey_two, command_id, 1, "Two")
    assert not one.replayed and not two.replayed
    assert one.change_set_id != two.change_set_id
    assert await row_counts(engine_one, context_one, command_id) == {
        "receipts": 1,
        "change_sets": 1,
        "events": 1,
    }
    assert await row_counts(engine_two, context_two, command_id) == {
        "receipts": 1,
        "change_sets": 1,
        "events": 1,
    }
    await engine_one.dispose()  # type: ignore[attr-defined]
    await engine_two.dispose()  # type: ignore[attr-defined]


def test_same_command_uuid_is_independent_across_workspaces_and_actors() -> None:
    asyncio.run(workspace_independence_scenario())
