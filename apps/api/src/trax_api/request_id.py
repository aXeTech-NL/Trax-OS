"""Request correlation support."""

import logging
import re
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from uuid import uuid4

from starlette.requests import Request
from starlette.responses import Response

REQUEST_ID_HEADER = "X-Request-ID"
_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
_logger = logging.getLogger(__name__)
_request_id: ContextVar[str] = ContextVar("request_id", default="unavailable")


def current_request_id() -> str:
    return _request_id.get()


async def request_id_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    supplied = request.headers.get(REQUEST_ID_HEADER, "")
    request_id = supplied if _REQUEST_ID_PATTERN.fullmatch(supplied) else f"req_{uuid4().hex}"
    token = _request_id.set(request_id)
    try:
        try:
            response = await call_next(request)
        except Exception as exception:
            # Keep correlation active while logging and constructing the stable envelope.
            _logger.exception(
                "Unhandled exception while serving request", extra={"request_id": request_id}
            )
            from trax_api.errors import unexpected_exception_handler

            response = await unexpected_exception_handler(request, exception)
        response.headers[REQUEST_ID_HEADER] = request_id
        return response
    finally:
        _request_id.reset(token)
