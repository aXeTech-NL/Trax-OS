"""Stable API error mapping."""

from collections.abc import Mapping
from http import HTTPStatus

from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException
from starlette.requests import Request

from trax_api.models import ErrorBody, ErrorResponse
from trax_api.request_id import current_request_id


def error_response(
    *,
    status_code: int,
    code: str,
    message: str,
    details: dict[str, object] | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    payload = ErrorResponse(
        error=ErrorBody(
            code=code,
            message=message,
            details=details or {},
            request_id=current_request_id(),
        )
    )
    return JSONResponse(
        status_code=status_code,
        content=payload.model_dump(mode="json"),
        headers=headers,
    )


async def http_exception_handler(_request: Request, exception: Exception) -> JSONResponse:
    if not isinstance(exception, HTTPException):
        return await unexpected_exception_handler(_request, exception)
    codes = {404: "resource_not_found", 405: "method_not_allowed"}
    code = codes.get(exception.status_code, "http_error")
    if isinstance(exception.detail, str):
        message = exception.detail
    else:
        try:
            message = HTTPStatus(exception.status_code).phrase
        except ValueError:
            message = "HTTP error"
    return error_response(
        status_code=exception.status_code,
        code=code,
        message=message,
        headers=exception.headers,
    )


async def validation_exception_handler(_request: Request, exception: Exception) -> JSONResponse:
    if not isinstance(exception, RequestValidationError):
        return await unexpected_exception_handler(_request, exception)
    return error_response(
        status_code=422,
        code="validation_failed",
        message="The request could not be validated.",
        details={"errors": jsonable_encoder(exception.errors())},
    )


async def unexpected_exception_handler(_request: Request, _exception: Exception) -> JSONResponse:
    return error_response(
        status_code=500,
        code="internal_error",
        message="An unexpected error occurred.",
    )
