"""FastAPI application factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException

from trax_api import __version__
from trax_api.errors import (
    http_exception_handler,
    unexpected_exception_handler,
    validation_exception_handler,
)
from trax_api.request_id import request_id_middleware
from trax_api.routes import api_router, health_router


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Own shared resources when foundation integrations are added."""
    yield


def create_app() -> FastAPI:
    application = FastAPI(
        title="Trax OS API",
        summary="Public Trax OS API foundation",
        description=(
            "Versioned foundation contract. OpenAPI/Pydantic is the provisional canonical "
            "contract source for v0.1."
        ),
        version=__version__,
        lifespan=lifespan,
    )
    application.middleware("http")(request_id_middleware)
    application.add_exception_handler(HTTPException, http_exception_handler)
    application.add_exception_handler(RequestValidationError, validation_exception_handler)
    application.add_exception_handler(Exception, unexpected_exception_handler)
    application.include_router(health_router)
    application.include_router(api_router)
    return application


app = create_app()
