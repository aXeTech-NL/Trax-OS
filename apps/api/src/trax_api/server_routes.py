"""Authenticated server-backed web routes."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from trax_api.auth import authenticate, login, logout, register, require_csrf
from trax_api.database import request_session
from trax_api.journey_repository import JourneyRepository
from trax_api.routes import ERROR_RESPONSES, RESPONSE_HEADERS
from trax_api.server_models import (
    JourneyCreate,
    JourneyListResponse,
    JourneyResponse,
    JourneyUpdate,
    LoginRequest,
    LogoutResponse,
    PackingCreate,
    PackingListResponse,
    PackingProgressUpdate,
    PackingResponse,
    PackingUpdate,
    RegisterRequest,
    SegmentCreate,
    SegmentListResponse,
    SegmentReorder,
    SegmentResponse,
    SegmentUpdate,
    SessionResponse,
)
from trax_api.settings import Settings

Session = Annotated[AsyncSession, Depends(request_session)]
router = APIRouter(prefix="/api/v1", responses=ERROR_RESPONSES)


def settings(request: Request) -> Settings:
    return request.app.state.settings


async def repository(request: Request, session: AsyncSession, *, csrf: bool) -> JourneyRepository:
    context = await authenticate(request, session)
    if csrf:
        require_csrf(request)
    return JourneyRepository(session, context)


@router.post("/auth/register", response_model=SessionResponse, status_code=201)
async def register_route(
    command: RegisterRequest, request: Request, response: Response, session: Session
) -> SessionResponse:
    context = await register(session, command, settings(request), response)
    return SessionResponse(authenticated=True, user=context.response())


@router.post("/auth/login", response_model=SessionResponse)
async def login_route(
    command: LoginRequest, request: Request, response: Response, session: Session
) -> SessionResponse:
    context = await login(session, command, settings(request), response)
    return SessionResponse(authenticated=True, user=context.response())


@router.get("/auth/session", response_model=SessionResponse)
async def session_route(request: Request, session: Session) -> SessionResponse:
    context = await authenticate(request, session)
    return SessionResponse(authenticated=True, user=context.response())


@router.post("/auth/logout", response_model=LogoutResponse)
async def logout_route(request: Request, response: Response, session: Session) -> LogoutResponse:
    await logout(request, session, response)
    return LogoutResponse(authenticated=False)


@router.get("/journeys", response_model=JourneyListResponse)
async def list_journeys(request: Request, session: Session) -> JourneyListResponse:
    items = await (await repository(request, session, csrf=False)).list_journeys()
    return JourneyListResponse(items=items)


@router.post("/journeys", response_model=JourneyResponse, status_code=201)
async def create_journey(
    command: JourneyCreate, request: Request, session: Session
) -> JourneyResponse:
    return await (await repository(request, session, csrf=True)).create_journey(command)


@router.get("/journeys/{journey_id}", response_model=JourneyResponse)
async def get_journey(journey_id: UUID, request: Request, session: Session) -> JourneyResponse:
    return await (await repository(request, session, csrf=False)).get_journey(journey_id)


@router.put("/journeys/{journey_id}", response_model=JourneyResponse)
async def update_journey(
    journey_id: UUID, command: JourneyUpdate, request: Request, session: Session
) -> JourneyResponse:
    return await (await repository(request, session, csrf=True)).update_journey(journey_id, command)


@router.delete(
    "/journeys/{journey_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    responses={204: {"headers": RESPONSE_HEADERS}},
)
async def delete_journey(journey_id: UUID, request: Request, session: Session) -> Response:
    await (await repository(request, session, csrf=True)).delete_journey(journey_id)
    return Response(status_code=204)


@router.get("/journeys/{journey_id}/segments", response_model=SegmentListResponse)
async def list_segments(
    journey_id: UUID, request: Request, session: Session
) -> SegmentListResponse:
    items = await (await repository(request, session, csrf=False)).list_segments(journey_id)
    return SegmentListResponse(items=items)


@router.post("/journeys/{journey_id}/segments", response_model=SegmentResponse, status_code=201)
async def create_segment(
    journey_id: UUID, command: SegmentCreate, request: Request, session: Session
) -> SegmentResponse:
    return await (await repository(request, session, csrf=True)).create_segment(journey_id, command)


@router.put("/journeys/{journey_id}/segments/{segment_id}", response_model=SegmentResponse)
async def update_segment(
    journey_id: UUID,
    segment_id: UUID,
    command: SegmentUpdate,
    request: Request,
    session: Session,
) -> SegmentResponse:
    return await (await repository(request, session, csrf=True)).update_segment(
        journey_id, segment_id, command
    )


@router.post(
    "/journeys/{journey_id}/segments/{segment_id}/reorder",
    response_model=SegmentResponse,
)
async def reorder_segment(
    journey_id: UUID,
    segment_id: UUID,
    command: SegmentReorder,
    request: Request,
    session: Session,
) -> SegmentResponse:
    return await (await repository(request, session, csrf=True)).reorder_segment(
        journey_id,
        segment_id,
        command.expected_record_version,
        command.new_position,
    )


@router.delete(
    "/journeys/{journey_id}/segments/{segment_id}",
    status_code=204,
    response_class=Response,
)
async def delete_segment(
    journey_id: UUID, segment_id: UUID, request: Request, session: Session
) -> Response:
    await (await repository(request, session, csrf=True)).delete_segment(journey_id, segment_id)
    return Response(status_code=204)


@router.get("/journeys/{journey_id}/packing", response_model=PackingListResponse)
async def list_packing(journey_id: UUID, request: Request, session: Session) -> PackingListResponse:
    items = await (await repository(request, session, csrf=False)).list_packing(journey_id)
    return PackingListResponse(items=items)


@router.post("/journeys/{journey_id}/packing", response_model=PackingResponse, status_code=201)
async def create_packing(
    journey_id: UUID, command: PackingCreate, request: Request, session: Session
) -> PackingResponse:
    return await (await repository(request, session, csrf=True)).create_packing(journey_id, command)


@router.put("/journeys/{journey_id}/packing/{item_id}", response_model=PackingResponse)
async def update_packing(
    journey_id: UUID,
    item_id: UUID,
    command: PackingUpdate,
    request: Request,
    session: Session,
) -> PackingResponse:
    return await (await repository(request, session, csrf=True)).update_packing(
        journey_id, item_id, command
    )


@router.put(
    "/journeys/{journey_id}/packing/{item_id}/progress",
    response_model=PackingResponse,
)
async def update_packing_progress(
    journey_id: UUID,
    item_id: UUID,
    command: PackingProgressUpdate,
    request: Request,
    session: Session,
) -> PackingResponse:
    return await (await repository(request, session, csrf=True)).update_packing_progress(
        journey_id, item_id, command
    )


@router.delete(
    "/journeys/{journey_id}/packing/{item_id}",
    status_code=204,
    response_class=Response,
)
async def delete_packing(
    journey_id: UUID, item_id: UUID, request: Request, session: Session
) -> Response:
    await (await repository(request, session, csrf=True)).delete_packing(journey_id, item_id)
    return Response(status_code=204)
