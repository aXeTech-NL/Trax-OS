"""Authenticated server-backed web routes."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response, Security, status
from fastapi.security import APIKeyCookie
from sqlalchemy.ext.asyncio import AsyncSession

from trax_api.auth import (
    CSRF_HEADER,
    SESSION_COOKIE,
    authenticate,
    login,
    logout,
    register,
    require_csrf,
)
from trax_api.database import request_session
from trax_api.journey_repository import JourneyRepository
from trax_api.routes import (
    CREATED_RESPONSE,
    ERROR_RESPONSES,
    NO_CONTENT_RESPONSE,
    SUCCESS_RESPONSE,
)
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
_session_cookie = APIKeyCookie(
    name=SESSION_COOKIE,
    scheme_name="SessionCookie",
    description="Opaque authenticated Trax OS session cookie.",
    auto_error=False,
)
authenticated_router = APIRouter(dependencies=[Security(_session_cookie)])
mutation_router = APIRouter(dependencies=[Security(_session_cookie)])
MUTATION_OPENAPI_EXTRA: dict[str, Any] = {
    "parameters": [
        {
            "name": CSRF_HEADER,
            "in": "header",
            "required": True,
            "description": "Double-submit token matching the trax_csrf cookie.",
            "schema": {"type": "string"},
        }
    ]
}


def settings(request: Request) -> Settings:
    return request.app.state.settings


async def repository(request: Request, session: AsyncSession, *, csrf: bool) -> JourneyRepository:
    context = await authenticate(request, session)
    if csrf:
        require_csrf(request)
    return JourneyRepository(session, context)


@router.post(
    "/auth/register",
    response_model=SessionResponse,
    status_code=201,
    responses=CREATED_RESPONSE,
)
async def register_route(
    command: RegisterRequest, request: Request, response: Response, session: Session
) -> SessionResponse:
    context = await register(session, command, settings(request), response)
    return SessionResponse(authenticated=True, user=context.response())


@router.post("/auth/login", response_model=SessionResponse, responses=SUCCESS_RESPONSE)
async def login_route(
    command: LoginRequest, request: Request, response: Response, session: Session
) -> SessionResponse:
    context = await login(session, command, settings(request), response)
    return SessionResponse(authenticated=True, user=context.response())


@authenticated_router.get(
    "/auth/session", response_model=SessionResponse, responses=SUCCESS_RESPONSE
)
async def session_route(request: Request, session: Session) -> SessionResponse:
    context = await authenticate(request, session)
    return SessionResponse(authenticated=True, user=context.response())


@mutation_router.post(
    "/auth/logout",
    response_model=LogoutResponse,
    responses=SUCCESS_RESPONSE,
    openapi_extra=MUTATION_OPENAPI_EXTRA,
)
async def logout_route(request: Request, response: Response, session: Session) -> LogoutResponse:
    await logout(request, session, response)
    return LogoutResponse(authenticated=False)


@authenticated_router.get(
    "/journeys", response_model=JourneyListResponse, responses=SUCCESS_RESPONSE
)
async def list_journeys(request: Request, session: Session) -> JourneyListResponse:
    items = await (await repository(request, session, csrf=False)).list_journeys()
    return JourneyListResponse(items=items)


@mutation_router.post(
    "/journeys",
    response_model=JourneyResponse,
    status_code=201,
    responses=CREATED_RESPONSE,
    openapi_extra=MUTATION_OPENAPI_EXTRA,
)
async def create_journey(
    command: JourneyCreate, request: Request, session: Session
) -> JourneyResponse:
    return await (await repository(request, session, csrf=True)).create_journey(command)


@authenticated_router.get(
    "/journeys/{journey_id}",
    response_model=JourneyResponse,
    responses=SUCCESS_RESPONSE,
)
async def get_journey(journey_id: UUID, request: Request, session: Session) -> JourneyResponse:
    return await (await repository(request, session, csrf=False)).get_journey(journey_id)


@mutation_router.put(
    "/journeys/{journey_id}",
    response_model=JourneyResponse,
    responses=SUCCESS_RESPONSE,
    openapi_extra=MUTATION_OPENAPI_EXTRA,
)
async def update_journey(
    journey_id: UUID, command: JourneyUpdate, request: Request, session: Session
) -> JourneyResponse:
    return await (await repository(request, session, csrf=True)).update_journey(journey_id, command)


@mutation_router.delete(
    "/journeys/{journey_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    responses=NO_CONTENT_RESPONSE,
    openapi_extra=MUTATION_OPENAPI_EXTRA,
)
async def delete_journey(journey_id: UUID, request: Request, session: Session) -> Response:
    await (await repository(request, session, csrf=True)).delete_journey(journey_id)
    return Response(status_code=204)


@authenticated_router.get(
    "/journeys/{journey_id}/segments",
    response_model=SegmentListResponse,
    responses=SUCCESS_RESPONSE,
)
async def list_segments(
    journey_id: UUID, request: Request, session: Session
) -> SegmentListResponse:
    items = await (await repository(request, session, csrf=False)).list_segments(journey_id)
    return SegmentListResponse(items=items)


@mutation_router.post(
    "/journeys/{journey_id}/segments",
    response_model=SegmentResponse,
    status_code=201,
    responses=CREATED_RESPONSE,
    openapi_extra=MUTATION_OPENAPI_EXTRA,
)
async def create_segment(
    journey_id: UUID, command: SegmentCreate, request: Request, session: Session
) -> SegmentResponse:
    return await (await repository(request, session, csrf=True)).create_segment(journey_id, command)


@mutation_router.put(
    "/journeys/{journey_id}/segments/{segment_id}",
    response_model=SegmentResponse,
    responses=SUCCESS_RESPONSE,
    openapi_extra=MUTATION_OPENAPI_EXTRA,
)
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


@mutation_router.post(
    "/journeys/{journey_id}/segments/{segment_id}/reorder",
    response_model=SegmentResponse,
    responses=SUCCESS_RESPONSE,
    openapi_extra=MUTATION_OPENAPI_EXTRA,
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


@mutation_router.delete(
    "/journeys/{journey_id}/segments/{segment_id}",
    status_code=204,
    response_class=Response,
    responses=NO_CONTENT_RESPONSE,
    openapi_extra=MUTATION_OPENAPI_EXTRA,
)
async def delete_segment(
    journey_id: UUID, segment_id: UUID, request: Request, session: Session
) -> Response:
    await (await repository(request, session, csrf=True)).delete_segment(journey_id, segment_id)
    return Response(status_code=204)


@authenticated_router.get(
    "/journeys/{journey_id}/packing",
    response_model=PackingListResponse,
    responses=SUCCESS_RESPONSE,
)
async def list_packing(journey_id: UUID, request: Request, session: Session) -> PackingListResponse:
    items = await (await repository(request, session, csrf=False)).list_packing(journey_id)
    return PackingListResponse(items=items)


@mutation_router.post(
    "/journeys/{journey_id}/packing",
    response_model=PackingResponse,
    status_code=201,
    responses=CREATED_RESPONSE,
    openapi_extra=MUTATION_OPENAPI_EXTRA,
)
async def create_packing(
    journey_id: UUID, command: PackingCreate, request: Request, session: Session
) -> PackingResponse:
    return await (await repository(request, session, csrf=True)).create_packing(journey_id, command)


@mutation_router.put(
    "/journeys/{journey_id}/packing/{item_id}",
    response_model=PackingResponse,
    responses=SUCCESS_RESPONSE,
    openapi_extra=MUTATION_OPENAPI_EXTRA,
)
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


@mutation_router.put(
    "/journeys/{journey_id}/packing/{item_id}/progress",
    response_model=PackingResponse,
    responses=SUCCESS_RESPONSE,
    openapi_extra=MUTATION_OPENAPI_EXTRA,
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


@mutation_router.delete(
    "/journeys/{journey_id}/packing/{item_id}",
    status_code=204,
    response_class=Response,
    responses=NO_CONTENT_RESPONSE,
    openapi_extra=MUTATION_OPENAPI_EXTRA,
)
async def delete_packing(
    journey_id: UUID, item_id: UUID, request: Request, session: Session
) -> Response:
    await (await repository(request, session, csrf=True)).delete_packing(journey_id, item_id)
    return Response(status_code=204)


router.include_router(authenticated_router)
router.include_router(mutation_router)
