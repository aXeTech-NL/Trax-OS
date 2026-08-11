"""Server-authoritative Journey persistence scoped by authenticated workspace."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from trax_api.application_errors import ApplicationError
from trax_api.auth import AuthContext
from trax_api.schema import journeys, packing_items, segments
from trax_api.server_models import (
    JourneyCreate,
    JourneyResponse,
    JourneyUpdate,
    PackingCreate,
    PackingProgressUpdate,
    PackingResponse,
    PackingUpdate,
    SegmentCreate,
    SegmentResponse,
    SegmentUpdate,
)


@dataclass(frozen=True)
class JourneyUpdateMutation:
    before: JourneyResponse
    after: JourneyResponse


class JourneyRepository:
    def __init__(self, session: AsyncSession, context: AuthContext) -> None:
        self.session = session
        self.context = context

    async def list_journeys(self) -> list[JourneyResponse]:
        result = await self.session.execute(
            select(journeys)
            .where(journeys.c.workspace_id == self.context.workspace_id)
            .order_by(journeys.c.updated_at.desc(), journeys.c.id)
        )
        return [journey_response(row) for row in result.mappings()]

    async def get_journey(self, journey_id: UUID) -> JourneyResponse:
        return journey_response(await self._journey_row(journey_id))

    async def create_journey(self, command: JourneyCreate) -> JourneyResponse:
        now = datetime.now(UTC)
        journey_id = command.id or uuid4()
        result = await self.session.execute(
            insert(journeys)
            .values(
                id=journey_id,
                workspace_id=self.context.workspace_id,
                name=command.name.strip(),
                start_date=command.start_date,
                end_date=command.end_date,
                status="planning",
                record_version=1,
                created_at=now,
                updated_at=now,
            )
            .returning(journeys)
        )
        await self.session.commit()
        return journey_response(result.mappings().one())

    async def apply_journey_update(
        self, journey_id: UUID, command: JourneyUpdate
    ) -> JourneyUpdateMutation:
        """Apply one CAS without committing; only the command Unit of Work owns commit."""

        # Lock first so the audit preimage is the exact row version this
        # transaction can mutate after any concurrent writer commits. Under
        # READ COMMITTED, a waiting SELECT FOR UPDATE returns that committed
        # version rather than the snapshot observed before waiting.
        before = journey_response(await self._journey_row(journey_id, for_update=True))
        if before.record_version != command.expected_record_version:
            raise ApplicationError(409, "version_conflict", "The Journey changed; reload it.")
        result = await self.session.execute(
            update(journeys)
            .where(
                journeys.c.id == journey_id,
                journeys.c.workspace_id == self.context.workspace_id,
                journeys.c.record_version == command.expected_record_version,
            )
            .values(
                name=command.name.strip(),
                start_date=command.start_date,
                end_date=command.end_date,
                status=command.status,
                record_version=journeys.c.record_version + 1,
                updated_at=datetime.now(UTC),
            )
            .returning(journeys)
        )
        row = result.mappings().one_or_none()
        if row is None:
            raise ApplicationError(409, "version_conflict", "The Journey changed; reload it.")
        return JourneyUpdateMutation(before=before, after=journey_response(row))

    async def delete_journey(self, journey_id: UUID) -> None:
        result = await self.session.execute(
            delete(journeys).where(
                journeys.c.id == journey_id,
                journeys.c.workspace_id == self.context.workspace_id,
            )
        )
        if result.rowcount != 1:  # type: ignore[attr-defined]
            await self.session.rollback()
            not_found()
        await self.session.commit()

    async def list_segments(self, journey_id: UUID) -> list[SegmentResponse]:
        await self._journey_row(journey_id)
        result = await self.session.execute(
            select(segments)
            .where(segments.c.journey_id == journey_id)
            .order_by(segments.c.position)
        )
        return [SegmentResponse.model_validate(row) for row in result.mappings()]

    async def create_segment(self, journey_id: UUID, command: SegmentCreate) -> SegmentResponse:
        await self._journey_row(journey_id)
        position_result = await self.session.execute(
            select(func.coalesce(func.max(segments.c.position), -1) + 1).where(
                segments.c.journey_id == journey_id
            )
        )
        position = position_result.scalar_one()
        now = datetime.now(UTC)
        result = await self.session.execute(
            insert(segments)
            .values(
                **segment_values(command),
                id=command.id or uuid4(),
                journey_id=journey_id,
                position=position,
                record_version=1,
                created_at=now,
                updated_at=now,
            )
            .returning(segments)
        )
        await self._touch_journey(journey_id)
        await self.session.commit()
        return SegmentResponse.model_validate(result.mappings().one())

    async def update_segment(
        self, journey_id: UUID, segment_id: UUID, command: SegmentUpdate
    ) -> SegmentResponse:
        await self._owned_segment(journey_id, segment_id)
        result = await self.session.execute(
            update(segments)
            .where(
                segments.c.id == segment_id,
                segments.c.journey_id == journey_id,
                segments.c.record_version == command.expected_record_version,
            )
            .values(
                **segment_values(command),
                record_version=segments.c.record_version + 1,
                updated_at=datetime.now(UTC),
            )
            .returning(segments)
        )
        row = result.mappings().one_or_none()
        if row is None:
            await self.session.rollback()
            raise ApplicationError(409, "version_conflict", "The route item changed; reload it.")
        await self._touch_journey(journey_id)
        await self.session.commit()
        return SegmentResponse.model_validate(row)

    async def reorder_segment(
        self,
        journey_id: UUID,
        segment_id: UUID,
        expected_version: int,
        new_position: int,
    ) -> SegmentResponse:
        owned = await self._owned_segment(journey_id, segment_id)
        if owned["record_version"] != expected_version:
            raise ApplicationError(409, "version_conflict", "The route item changed; reload it.")
        result = await self.session.execute(
            select(segments.c.id)
            .where(segments.c.journey_id == journey_id)
            .order_by(segments.c.position)
        )
        ids = list(result.scalars())
        if new_position >= len(ids):
            raise ApplicationError(422, "position_invalid", "The requested position is invalid.")
        ids.remove(segment_id)
        ids.insert(new_position, segment_id)
        await self.session.execute(
            update(segments)
            .where(segments.c.journey_id == journey_id)
            .values(position=segments.c.position + 100000)
        )
        now = datetime.now(UTC)
        for position, current_id in enumerate(ids):
            values: dict[str, object] = {"position": position, "updated_at": now}
            if current_id == segment_id:
                values["record_version"] = segments.c.record_version + 1
            await self.session.execute(
                update(segments).where(segments.c.id == current_id).values(**values)
            )
        await self._touch_journey(journey_id)
        # Read the updated row while the transaction-local RLS authority GUCs
        # are still active; commit clears them by design.
        moved = SegmentResponse.model_validate(await self._owned_segment(journey_id, segment_id))
        await self.session.commit()
        return moved

    async def delete_segment(self, journey_id: UUID, segment_id: UUID) -> None:
        await self._owned_segment(journey_id, segment_id)
        await self.session.execute(delete(segments).where(segments.c.id == segment_id))
        await self._compact_segments(journey_id)
        await self._touch_journey(journey_id)
        await self.session.commit()

    async def list_packing(self, journey_id: UUID) -> list[PackingResponse]:
        await self._journey_row(journey_id)
        result = await self.session.execute(
            select(packing_items)
            .where(packing_items.c.journey_id == journey_id)
            .order_by(packing_items.c.category, packing_items.c.label, packing_items.c.id)
        )
        return [PackingResponse.model_validate(row) for row in result.mappings()]

    async def create_packing(self, journey_id: UUID, command: PackingCreate) -> PackingResponse:
        await self._journey_row(journey_id)
        now = datetime.now(UTC)
        result = await self.session.execute(
            insert(packing_items)
            .values(
                id=command.id or uuid4(),
                journey_id=journey_id,
                label=command.label.strip(),
                category=command.category,
                quantity=command.quantity,
                packed_quantity=0,
                essential=command.essential,
                record_version=1,
                created_at=now,
                updated_at=now,
            )
            .returning(packing_items)
        )
        await self._touch_journey(journey_id)
        await self.session.commit()
        return PackingResponse.model_validate(result.mappings().one())

    async def update_packing(
        self, journey_id: UUID, item_id: UUID, command: PackingUpdate
    ) -> PackingResponse:
        await self._owned_packing(journey_id, item_id)
        result = await self.session.execute(
            update(packing_items)
            .where(
                packing_items.c.id == item_id,
                packing_items.c.journey_id == journey_id,
                packing_items.c.record_version == command.expected_record_version,
            )
            .values(
                label=command.label.strip(),
                category=command.category,
                quantity=command.quantity,
                packed_quantity=func.least(packing_items.c.packed_quantity, command.quantity),
                essential=command.essential,
                record_version=packing_items.c.record_version + 1,
                updated_at=datetime.now(UTC),
            )
            .returning(packing_items)
        )
        return await self._finish_packing(result, journey_id)

    async def update_packing_progress(
        self, journey_id: UUID, item_id: UUID, command: PackingProgressUpdate
    ) -> PackingResponse:
        owned = await self._owned_packing(journey_id, item_id)
        if command.packed_quantity > owned["quantity"]:
            raise ApplicationError(422, "quantity_invalid", "Packed quantity exceeds quantity.")
        result = await self.session.execute(
            update(packing_items)
            .where(
                packing_items.c.id == item_id,
                packing_items.c.journey_id == journey_id,
                packing_items.c.record_version == command.expected_record_version,
            )
            .values(
                packed_quantity=command.packed_quantity,
                record_version=packing_items.c.record_version + 1,
                updated_at=datetime.now(UTC),
            )
            .returning(packing_items)
        )
        return await self._finish_packing(result, journey_id)

    async def delete_packing(self, journey_id: UUID, item_id: UUID) -> None:
        await self._owned_packing(journey_id, item_id)
        await self.session.execute(delete(packing_items).where(packing_items.c.id == item_id))
        await self._touch_journey(journey_id)
        await self.session.commit()

    async def _finish_packing(self, result: object, journey_id: UUID) -> PackingResponse:
        row = result.mappings().one_or_none()  # type: ignore[attr-defined]
        if row is None:
            await self.session.rollback()
            raise ApplicationError(409, "version_conflict", "The packing item changed; reload it.")
        await self._touch_journey(journey_id)
        await self.session.commit()
        return PackingResponse.model_validate(row)

    async def _journey_row(self, journey_id: UUID, *, for_update: bool = False):
        statement = select(journeys).where(
            journeys.c.id == journey_id,
            journeys.c.workspace_id == self.context.workspace_id,
        )
        if for_update:
            statement = statement.with_for_update()
        result = await self.session.execute(statement)
        row = result.mappings().one_or_none()
        if row is None:
            not_found()
        return row

    async def _owned_segment(self, journey_id: UUID, segment_id: UUID):
        await self._journey_row(journey_id)
        result = await self.session.execute(
            select(segments).where(segments.c.id == segment_id, segments.c.journey_id == journey_id)
        )
        row = result.mappings().one_or_none()
        if row is None:
            not_found()
        return row

    async def _owned_packing(self, journey_id: UUID, item_id: UUID):
        await self._journey_row(journey_id)
        result = await self.session.execute(
            select(packing_items).where(
                packing_items.c.id == item_id,
                packing_items.c.journey_id == journey_id,
            )
        )
        row = result.mappings().one_or_none()
        if row is None:
            not_found()
        return row

    async def _touch_journey(self, journey_id: UUID) -> None:
        await self.session.execute(
            update(journeys)
            .where(journeys.c.id == journey_id)
            .values(
                updated_at=datetime.now(UTC),
                record_version=journeys.c.record_version + 1,
            )
        )

    async def _compact_segments(self, journey_id: UUID) -> None:
        result = await self.session.execute(
            select(segments.c.id)
            .where(segments.c.journey_id == journey_id)
            .order_by(segments.c.position)
        )
        for position, segment_id in enumerate(result.scalars()):
            await self.session.execute(
                update(segments).where(segments.c.id == segment_id).values(position=position)
            )


def journey_response(row: Mapping[Any, Any]) -> JourneyResponse:
    values = dict(row)
    values.pop("workspace_id", None)
    return JourneyResponse.model_validate(values)


def segment_values(command: SegmentCreate | SegmentUpdate) -> dict[str, object]:
    return {
        "kind": command.kind,
        "start_date": command.start_date,
        "end_date": command.end_date,
        "place_name": command.place_name.strip() if command.place_name else None,
        "origin_name": command.origin_name.strip() if command.origin_name else None,
        "destination_name": command.destination_name.strip() if command.destination_name else None,
        "transport_mode": command.transport_mode.strip(),
        "notes": command.notes.strip(),
    }


def not_found() -> None:
    raise ApplicationError(404, "resource_not_found", "Resource not found.")
