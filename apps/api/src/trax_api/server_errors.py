"""Stable application errors for authenticated APIs."""

from fastapi.responses import JSONResponse
from starlette.requests import Request

from trax_api.application_errors import ApplicationError
from trax_api.errors import error_response


async def application_error_handler(_request: Request, exception: Exception) -> JSONResponse:
    if not isinstance(exception, ApplicationError):
        raise exception
    return error_response(
        status_code=exception.status_code,
        code=exception.code,
        message=exception.message,
    )
