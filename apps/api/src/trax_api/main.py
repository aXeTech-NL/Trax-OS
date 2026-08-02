"""FastAPI application factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException

from trax_api import __version__
from trax_api.database import Database
from trax_api.errors import (
    http_exception_handler,
    unexpected_exception_handler,
    validation_exception_handler,
)
from trax_api.request_id import request_id_middleware
from trax_api.routes import api_router, health_router
from trax_api.server_errors import ApplicationError, application_error_handler
from trax_api.server_routes import router as server_router
from trax_api.settings import load_settings


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    """Own the authoritative PostgreSQL connection pool."""
    try:
        yield
    finally:
        await application.state.database.close()


def create_app() -> FastAPI:
    settings = load_settings()
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
    application.state.settings = settings
    application.state.database = Database(settings)
    application.middleware("http")(request_id_middleware)
    application.add_exception_handler(HTTPException, http_exception_handler)
    application.add_exception_handler(RequestValidationError, validation_exception_handler)
    application.add_exception_handler(ApplicationError, application_error_handler)
    application.add_exception_handler(Exception, unexpected_exception_handler)
    application.include_router(health_router)
    application.include_router(api_router)
    application.include_router(server_router)
    return application


app = create_app()
