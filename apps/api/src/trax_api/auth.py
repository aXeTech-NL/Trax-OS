"""Password and opaque-cookie session services."""

import hmac
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from uuid import UUID, uuid4

from anyio import to_thread
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Request, Response
from sqlalchemy import insert, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from trax_api.application_errors import ApplicationError
from trax_api.schema import memberships, password_credentials, sessions, users, workspaces
from trax_api.server_models import LoginRequest, RegisterRequest, UserResponse
from trax_api.settings import Settings

SESSION_COOKIE = "trax_session"
CSRF_COOKIE = "trax_csrf"
CSRF_HEADER = "X-CSRF-Token"
_hasher = PasswordHasher()
_dummy_password_hash = _hasher.hash("trax-invalid-credential-timing-value")


@dataclass(frozen=True)
class AuthContext:
    user_id: UUID
    workspace_id: UUID
    session_id: UUID
    email: str
    display_name: str
    role: str

    def response(self) -> UserResponse:
        return UserResponse(
            id=self.user_id,
            email=self.email,
            display_name=self.display_name,
            workspace_id=self.workspace_id,
        )


def _digest(value: str) -> str:
    return sha256(value.encode()).hexdigest()


async def register(
    session: AsyncSession,
    request: RegisterRequest,
    settings: Settings,
    response: Response,
) -> AuthContext:
    now = datetime.now(UTC)
    user_id = uuid4()
    workspace_id = uuid4()
    email = str(request.email).strip().lower()
    password_hash = await to_thread.run_sync(_hasher.hash, request.password)
    try:
        async with session.begin():
            await session.execute(
                insert(users).values(
                    id=user_id,
                    email=email,
                    display_name=request.display_name.strip(),
                    created_at=now,
                )
            )
            await session.execute(
                insert(password_credentials).values(
                    user_id=user_id,
                    password_hash=password_hash,
                    updated_at=now,
                )
            )
            await session.execute(
                insert(workspaces).values(
                    id=workspace_id,
                    type="PERSONAL",
                    name=f"{request.display_name.strip()}'s workspace",
                    created_at=now,
                )
            )
            await session.execute(
                insert(memberships).values(
                    workspace_id=workspace_id,
                    user_id=user_id,
                    role="OWNER",
                    created_at=now,
                )
            )
            session_id = await _issue_session(session, user_id, now, settings, response)
    except IntegrityError as error:
        raise ApplicationError(
            409, "email_already_registered", "An account already exists."
        ) from error
    return AuthContext(
        user_id=user_id,
        workspace_id=workspace_id,
        session_id=session_id,
        email=email,
        display_name=request.display_name.strip(),
        role="OWNER",
    )


async def login(
    session: AsyncSession,
    request: LoginRequest,
    settings: Settings,
    response: Response,
) -> AuthContext:
    email = str(request.email).strip().lower()
    result = await session.execute(
        select(
            users.c.id,
            users.c.email,
            users.c.display_name,
            password_credentials.c.password_hash,
            memberships.c.workspace_id,
            memberships.c.role,
        )
        .join(password_credentials, password_credentials.c.user_id == users.c.id)
        .join(memberships, memberships.c.user_id == users.c.id)
        .join(workspaces, workspaces.c.id == memberships.c.workspace_id)
        .where(users.c.email == email, workspaces.c.type == "PERSONAL")
        .order_by(workspaces.c.created_at)
        .limit(1)
    )
    row = result.mappings().one_or_none()
    encoded = row["password_hash"] if row is not None else _dummy_password_hash
    password_valid = await _password_valid(encoded, request.password)
    if row is None or not password_valid:
        raise ApplicationError(401, "invalid_credentials", "Email or password is incorrect.")
    now = datetime.now(UTC)
    session_id = await _issue_session(session, row["id"], now, settings, response)
    await session.commit()
    return AuthContext(
        user_id=row["id"],
        workspace_id=row["workspace_id"],
        session_id=session_id,
        email=row["email"],
        display_name=row["display_name"],
        role=row["role"],
    )


async def _password_valid(encoded: str, password: str) -> bool:
    def verify() -> bool:
        try:
            return _hasher.verify(encoded, password)
        except (VerifyMismatchError, InvalidHashError):
            return False

    return await to_thread.run_sync(verify)


async def _issue_session(
    session: AsyncSession,
    user_id: UUID,
    now: datetime,
    settings: Settings,
    response: Response,
) -> UUID:
    token = secrets.token_urlsafe(48)
    csrf = secrets.token_urlsafe(32)
    session_id = uuid4()
    expires = now + timedelta(seconds=settings.session_ttl_seconds)
    await session.execute(
        insert(sessions).values(
            id=session_id,
            user_id=user_id,
            token_hash=_digest(token),
            csrf_hash=_digest(csrf),
            created_at=now,
            expires_at=expires,
        )
    )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
        max_age=settings.session_ttl_seconds,
    )
    response.set_cookie(
        CSRF_COOKIE,
        csrf,
        httponly=False,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
        max_age=settings.session_ttl_seconds,
    )
    return session_id


async def authenticate(request: Request, session: AsyncSession) -> AuthContext:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise ApplicationError(401, "authentication_required", "Authentication is required.")
    now = datetime.now(UTC)
    result = await session.execute(
        select(
            sessions.c.id.label("session_id"),
            sessions.c.csrf_hash,
            users.c.id.label("user_id"),
            users.c.email,
            users.c.display_name,
            memberships.c.workspace_id,
            memberships.c.role,
        )
        .join(users, users.c.id == sessions.c.user_id)
        .join(memberships, memberships.c.user_id == users.c.id)
        .join(workspaces, workspaces.c.id == memberships.c.workspace_id)
        .where(
            sessions.c.token_hash == _digest(token),
            sessions.c.revoked_at.is_(None),
            sessions.c.expires_at > now,
            workspaces.c.type == "PERSONAL",
        )
        .order_by(workspaces.c.created_at)
        .limit(1)
    )
    row = result.mappings().one_or_none()
    if row is None:
        raise ApplicationError(401, "authentication_required", "Authentication is required.")
    await session.execute(
        text(
            "SELECT set_config('trax.user_id', :user_id, true), "
            "set_config('trax.workspace_id', :workspace_id, true)"
        ),
        {"user_id": str(row["user_id"]), "workspace_id": str(row["workspace_id"])},
    )
    request.state.csrf_hash = row["csrf_hash"]
    return AuthContext(
        user_id=row["user_id"],
        workspace_id=row["workspace_id"],
        session_id=row["session_id"],
        email=row["email"],
        display_name=row["display_name"],
        role=row["role"],
    )


def require_csrf(request: Request) -> None:
    cookie = request.cookies.get(CSRF_COOKIE, "")
    header = request.headers.get(CSRF_HEADER, "")
    expected = getattr(request.state, "csrf_hash", "")
    if (
        not cookie
        or not header
        or not hmac.compare_digest(cookie, header)
        or not hmac.compare_digest(_digest(header), expected)
    ):
        raise ApplicationError(403, "csrf_failed", "The request could not be verified.")


async def logout(request: Request, session: AsyncSession, response: Response) -> None:
    context = await authenticate(request, session)
    require_csrf(request)
    await session.execute(
        update(sessions)
        .where(sessions.c.id == context.session_id)
        .values(revoked_at=datetime.now(UTC))
    )
    await session.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
