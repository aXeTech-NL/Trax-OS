"""Strict authenticated web API contracts."""

from datetime import date, datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import EmailStr, Field, model_validator

from trax_api.models import WireModel


class RegisterRequest(WireModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=256)
    display_name: str = Field(min_length=1, max_length=120)


class LoginRequest(WireModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class UserResponse(WireModel):
    id: UUID
    email: EmailStr
    display_name: str
    workspace_id: UUID


class SessionResponse(WireModel):
    authenticated: Literal[True]
    user: UserResponse


class LogoutResponse(WireModel):
    authenticated: Literal[False]


class JourneyInput(WireModel):
    name: str = Field(min_length=1, max_length=200)
    start_date: date | None = None
    end_date: date | None = None

    @model_validator(mode="after")
    def dates_are_ordered(self) -> Self:
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must not be before start_date")
        return self


class JourneyCreate(JourneyInput):
    id: UUID | None = None


class JourneyUpdate(JourneyInput):
    expected_record_version: int = Field(ge=1)
    status: Literal["planning", "active", "completed", "archived"]


class JourneyUpdateCommandPayload(JourneyUpdate):
    journey_id: UUID


class JourneyUpdateCommand(WireModel):
    command_id: UUID
    command_type: Literal["journey.update"]
    command_version: int = Field(ge=1)
    payload: JourneyUpdateCommandPayload


class CommandEntityVersion(WireModel):
    entity_type: Literal["journey"]
    entity_id: UUID
    record_version: int = Field(ge=1)


class JourneyUpdateCommandResponse(WireModel):
    command_id: UUID
    command_type: Literal["journey.update"]
    command_version: int
    outcome: Literal["applied"]
    replayed: bool
    change_set_id: UUID
    result: CommandEntityVersion


class JourneyResponse(WireModel):
    id: UUID
    name: str
    start_date: date | None
    end_date: date | None
    status: Literal["planning", "active", "completed", "archived"]
    record_version: int
    created_at: datetime
    updated_at: datetime


class JourneyListResponse(WireModel):
    items: list[JourneyResponse]


class SegmentInput(WireModel):
    kind: Literal["stay", "move"]
    start_date: date | None = None
    end_date: date | None = None
    place_name: str | None = Field(default=None, max_length=200)
    origin_name: str | None = Field(default=None, max_length=200)
    destination_name: str | None = Field(default=None, max_length=200)
    transport_mode: str = Field(default="", max_length=100)
    notes: str = Field(default="", max_length=5000)

    @model_validator(mode="after")
    def valid_segment(self) -> Self:
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must not be before start_date")
        if self.kind == "stay" and not (self.place_name and self.place_name.strip()):
            raise ValueError("place_name is required for a stay")
        if self.kind == "move" and not (
            self.origin_name
            and self.origin_name.strip()
            and self.destination_name
            and self.destination_name.strip()
        ):
            raise ValueError("origin_name and destination_name are required for a move")
        return self


class SegmentCreate(SegmentInput):
    id: UUID | None = None


class SegmentUpdate(SegmentInput):
    expected_record_version: int = Field(ge=1)


class SegmentReorder(WireModel):
    expected_record_version: int = Field(ge=1)
    new_position: int = Field(ge=0)


class SegmentResponse(SegmentInput):
    id: UUID
    journey_id: UUID
    position: int
    record_version: int
    created_at: datetime
    updated_at: datetime


class SegmentListResponse(WireModel):
    items: list[SegmentResponse]


PackingCategory = Literal["documents", "clothing", "toiletries", "electronics", "other"]


class PackingInput(WireModel):
    label: str = Field(min_length=1, max_length=200)
    category: PackingCategory
    quantity: int = Field(ge=1, le=99)
    essential: bool = False


class PackingCreate(PackingInput):
    id: UUID | None = None


class PackingUpdate(PackingInput):
    expected_record_version: int = Field(ge=1)


class PackingProgressUpdate(WireModel):
    expected_record_version: int = Field(ge=1)
    packed_quantity: int = Field(ge=0, le=99)


class PackingResponse(PackingInput):
    id: UUID
    journey_id: UUID
    packed_quantity: int
    record_version: int
    created_at: datetime
    updated_at: datetime


class PackingListResponse(WireModel):
    items: list[PackingResponse]
