"""Environment-backed API settings."""

from dataclasses import dataclass
from os import getenv


@dataclass(frozen=True)
class Settings:
    database_url: str
    session_cookie_secure: bool
    session_ttl_seconds: int


def load_settings() -> Settings:
    return Settings(
        database_url=getenv(
            "TRAX_DATABASE_URL",
            "postgresql+asyncpg://trax:trax-development-only@127.0.0.1:5432/trax",
        ),
        session_cookie_secure=getenv("TRAX_SESSION_COOKIE_SECURE", "false").lower()
        in {"1", "true", "yes"},
        session_ttl_seconds=int(getenv("TRAX_SESSION_TTL_SECONDS", str(60 * 60 * 24 * 30))),
    )
