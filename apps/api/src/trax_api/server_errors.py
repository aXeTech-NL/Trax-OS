"""Stable application errors for authenticated APIs."""

from fastapi.responses import JSONResponse
from starlette.requests import Request

from trax_api.errors import error_response


class ApplicationError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(code)


async def application_error_handler(_request: Request, exception: Exception) -> JSONResponse:
    if not isinstance(exception, ApplicationError):
        raise exception
    return error_response(
        status_code=exception.status_code,
        code=exception.code,
        message=exception.message,
    )
