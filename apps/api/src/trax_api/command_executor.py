"""Canonical command execution and single database Unit of Work."""

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal, Protocol
from uuid import UUID, uuid4

from sqlalchemy import insert, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from trax_api.application_errors import ApplicationError
from trax_api.auth import AuthContext
from trax_api.command_registry import command_digest_v1, resolve_command, role_allows
from trax_api.journey_repository import JourneyRepository, JourneyUpdateMutation
from trax_api.schema import (
    command_change_events,
    command_change_sets,
    command_receipts,
)
from trax_api.server_models import JourneyResponse, JourneyUpdate, JourneyUpdateCommandPayload

Origin = Literal["web", "agent", "sync", "system"]


async def authorize_permission(
    session: AsyncSession, context: AuthContext, permission: str
) -> None:
    """Lock current membership authority and apply the immutable role policy."""

    # The runtime role deliberately has no UPDATE privilege on membership
    # rows, while PostgreSQL row-locking SELECTs require it. A narrowly scoped
    # SECURITY DEFINER function verifies transaction-local authority GUCs and
    # acquires FOR SHARE without widening runtime table privileges.
    result = await session.execute(
        text("SELECT trax_lock_membership(:workspace_id, :user_id) AS role"),
        {"workspace_id": context.workspace_id, "user_id": context.user_id},
    )
    role = result.scalar_one_or_none()
    if role is None or not role_allows(role, permission):
        raise ApplicationError(
            403,
            "journey_write_forbidden",
            "You do not have permission to change this journey.",
        )


@dataclass(frozen=True)
class CommandExecution:
    command_id: UUID
    command_type: str
    command_version: int
    outcome: Literal["applied", "version_conflict", "resource_not_found"]
    entity_id: UUID
    record_version: int | None
    change_set_id: UUID | None
    replayed: bool
    journey: JourneyResponse | None = None


class AppliedAuditWriter(Protocol):
    async def __call__(
        self,
        session: AsyncSession,
        context: AuthContext,
        execution: CommandExecution,
        mutation: JourneyUpdateMutation,
        request_digest: str,
        origin: Origin,
        reversibility: str,
    ) -> None: ...


class UnitOfWork:
    """Adopt the request transaction opened by authentication and commit once."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def run(self, operation: Callable[[], Awaitable[CommandExecution]]) -> CommandExecution:
        try:
            result = await operation()
            await self.session.commit()
            return result
        except BaseException:
            await self.session.rollback()
            raise


class CommandExecutor:
    """Resolve, authorize, serialize, execute and audit canonical commands."""

    _ADVISORY_NAMESPACE = 1414

    def __init__(
        self,
        session: AsyncSession,
        context: AuthContext,
        *,
        audit_writer: AppliedAuditWriter | None = None,
        after_authorization: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        self.session = session
        self.context = context
        self.audit_writer = audit_writer or write_applied_audit
        self.after_authorization = after_authorization

    async def execute_journey_update(
        self,
        *,
        command_id: UUID,
        command_type: str,
        command_version: int,
        payload: JourneyUpdateCommandPayload,
        origin: Origin,
    ) -> CommandExecution:
        # Registry resolution and strict payload validation happen before any
        # database access; the definition's permission is the sole policy key.
        definition = resolve_command(command_type, command_version)
        registry_payload = definition.payload_model.model_validate(
            payload.model_dump(mode="python")
        )
        if not isinstance(registry_payload, JourneyUpdateCommandPayload):
            raise RuntimeError("Journey update registry payload mismatch")
        validated = registry_payload
        request_digest = command_digest_v1(
            command_id=str(command_id),
            command_type=command_type,
            command_version=command_version,
            payload=validated,
        )

        async def operation() -> CommandExecution:
            await self._recheck_permission(definition.permission)
            if self.after_authorization is not None:
                await self.after_authorization()
            await self._lock_command(command_id)
            prior = await self._receipt(command_id)
            if prior is not None:
                return self._replay_or_conflict(
                    prior,
                    command_id=command_id,
                    command_type=command_type,
                    command_version=command_version,
                    request_digest=request_digest,
                    entity_id=validated.journey_id,
                )

            repository = JourneyRepository(self.session, self.context)
            command = JourneyUpdate.model_validate(
                validated.model_dump(mode="python", exclude={"journey_id"})
            )
            try:
                mutation = await repository.apply_journey_update(validated.journey_id, command)
            except ApplicationError as error:
                if error.code not in {"version_conflict", "resource_not_found"}:
                    raise
                outcome: Literal["version_conflict", "resource_not_found"] = error.code  # type: ignore[assignment]
                terminal = CommandExecution(
                    command_id=command_id,
                    command_type=definition.command_type,
                    command_version=definition.version,
                    outcome=outcome,
                    entity_id=validated.journey_id,
                    record_version=None,
                    change_set_id=None,
                    replayed=False,
                )
                await self._write_terminal_receipt(terminal, request_digest)
                return terminal

            execution = CommandExecution(
                command_id=command_id,
                command_type=definition.command_type,
                command_version=definition.version,
                outcome="applied",
                entity_id=validated.journey_id,
                record_version=mutation.after.record_version,
                change_set_id=uuid4(),
                replayed=False,
                journey=mutation.after,
            )
            await self.audit_writer(
                self.session,
                self.context,
                execution,
                mutation,
                request_digest,
                origin,
                definition.reversibility,
            )
            return execution

        result = await UnitOfWork(self.session).run(operation)
        if result.outcome == "version_conflict":
            raise ApplicationError(409, "version_conflict", "The Journey changed; reload it.")
        if result.outcome == "resource_not_found":
            raise ApplicationError(404, "resource_not_found", "Resource not found.")
        return result

    async def _recheck_permission(self, permission: str) -> None:
        await authorize_permission(self.session, self.context, permission)

    async def _lock_command(self, command_id: UUID) -> None:
        binding = f"{self.context.workspace_id}:{self.context.user_id}:{command_id}"
        await self.session.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:binding, :namespace))"),
            {"binding": binding, "namespace": self._ADVISORY_NAMESPACE},
        )

    async def _receipt(self, command_id: UUID) -> Mapping[str, object] | None:
        result = await self.session.execute(
            select(command_receipts).where(
                command_receipts.c.workspace_id == self.context.workspace_id,
                command_receipts.c.actor_user_id == self.context.user_id,
                command_receipts.c.command_id == command_id,
            )
        )
        row = result.mappings().one_or_none()
        return dict(row) if row is not None else None

    def _replay_or_conflict(
        self,
        prior: Mapping[str, object],
        *,
        command_id: UUID,
        command_type: str,
        command_version: int,
        request_digest: str,
        entity_id: UUID,
    ) -> CommandExecution:
        exact = (
            prior["command_type"] == command_type
            and prior["command_version"] == command_version
            and prior["digest_version"] == 1
            and prior["request_digest"] == request_digest
            and prior["entity_type"] == "journey"
            and prior["entity_id"] == entity_id
        )
        if not exact:
            raise ApplicationError(
                409,
                "idempotency_conflict",
                "The command identifier was already used for different content.",
            )
        return CommandExecution(
            command_id=command_id,
            command_type=command_type,
            command_version=command_version,
            outcome=prior["outcome"],  # type: ignore[arg-type]
            entity_id=entity_id,
            record_version=prior["result_record_version"],  # type: ignore[arg-type]
            change_set_id=prior["change_set_id"],  # type: ignore[arg-type]
            replayed=True,
        )

    async def _write_terminal_receipt(
        self, execution: CommandExecution, request_digest: str
    ) -> None:
        await self.session.execute(
            insert(command_receipts).values(
                workspace_id=self.context.workspace_id,
                actor_user_id=self.context.user_id,
                command_id=execution.command_id,
                command_type=execution.command_type,
                command_version=execution.command_version,
                digest_version=1,
                request_digest=request_digest,
                outcome=execution.outcome,
                entity_type="journey",
                entity_id=execution.entity_id,
                result_record_version=None,
                change_set_id=None,
                created_at=datetime.now(UTC),
            )
        )


async def write_applied_audit(
    session: AsyncSession,
    context: AuthContext,
    execution: CommandExecution,
    mutation: JourneyUpdateMutation,
    request_digest: str,
    origin: Origin,
    reversibility: str,
) -> None:
    """Atomically persist one minimal receipt and one ordered change event."""

    if execution.change_set_id is None or execution.record_version is None:
        raise RuntimeError("Applied command requires change-set and version metadata")
    now = datetime.now(UTC)
    await session.execute(
        insert(command_change_sets).values(
            id=execution.change_set_id,
            workspace_id=context.workspace_id,
            actor_user_id=context.user_id,
            command_id=execution.command_id,
            command_type=execution.command_type,
            command_version=execution.command_version,
            origin=origin,
            reversibility=reversibility,
            entity_type="journey",
            entity_id=execution.entity_id,
            created_at=now,
        )
    )
    await session.execute(
        insert(command_change_events).values(
            id=uuid4(),
            change_set_id=execution.change_set_id,
            workspace_id=context.workspace_id,
            actor_user_id=context.user_id,
            sequence=1,
            entity_type="journey",
            entity_id=execution.entity_id,
            action="updated",
            before_state=mutation.before.model_dump(mode="json"),
            after_state=mutation.after.model_dump(mode="json"),
            created_at=now,
        )
    )
    await session.execute(
        insert(command_receipts).values(
            workspace_id=context.workspace_id,
            actor_user_id=context.user_id,
            command_id=execution.command_id,
            command_type=execution.command_type,
            command_version=execution.command_version,
            digest_version=1,
            request_digest=request_digest,
            outcome="applied",
            entity_type="journey",
            entity_id=execution.entity_id,
            result_record_version=execution.record_version,
            change_set_id=execution.change_set_id,
            created_at=now,
        )
    )
