"""FastAPI dependencies: database session, app context, authentication."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from mutual_server.clock import Clock
from mutual_server.config import Settings
from mutual_server.errors import ApiError
from mutual_server.ids import IdFactory
from mutual_server.models import SessionRow, User
from mutual_server.security import session_hash
from mutual_server.services.email import EmailSender


@dataclass
class AppContext:
    settings: Settings
    clock: Clock
    ids: IdFactory
    email: EmailSender

    @property
    def media_dir(self) -> Path:
        return self.settings.resolve_path(self.settings.media.storage_dir)

    @property
    def pepper(self) -> bytes:
        return self.settings.email_pepper()


def get_ctx(request: Request) -> AppContext:
    return request.app.state.ctx


def get_db(request: Request) -> Iterator[Session]:
    with request.app.state.session_factory() as db:
        yield db


def _bearer(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    return token.strip() if scheme.lower() == "bearer" and token.strip() else None


def optional_session(
    request: Request, db: Session = Depends(get_db), ctx: AppContext = Depends(get_ctx)
) -> SessionRow | None:
    token = _bearer(request)
    if token is None:
        return None
    row = db.get(SessionRow, session_hash(token))
    if row is None or row.expires_at <= ctx.clock.now():
        return None
    return row


def current_session(row: SessionRow | None = Depends(optional_session)) -> SessionRow:
    if row is None:
        raise ApiError(401, "unauthorized", "Sign in again.")
    return row


def current_user(
    session: SessionRow = Depends(current_session), db: Session = Depends(get_db)
) -> User:
    if session.user_id is None:
        raise ApiError(403, "no_account", "Create your account first.")
    user = db.get(User, session.user_id)
    if user is None or user.deleted_at is not None:
        raise ApiError(401, "unauthorized", "Sign in again.")
    if user.suspended_at is not None:
        raise ApiError(403, "account_suspended", "This account is suspended.")
    return user
