"""FastAPI dependencies: database session, app context, authentication."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from mutual_server.clock import Clock
from mutual_server.config import Settings
from mutual_server.errors import ApiError
from mutual_server.ids import IdFactory
from mutual_server.models import SessionRow, User
from mutual_server.security import session_hash
from mutual_server.services.email import EmailSender
from mutual_server.services.matching import sync_matches
from mutual_server.services.media import MediaStore
from mutual_server.services.rate_limit import RateLimiter


@dataclass
class AppContext:
    settings: Settings
    clock: Clock
    ids: IdFactory
    email: EmailSender
    rate_limiter: RateLimiter
    media_store: MediaStore

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
    if user is None:  # a deleted account's row no longer exists at all (S11, hard delete)
        raise ApiError(401, "unauthorized", "Sign in again.")
    if user.suspended_at is not None:
        raise ApiError(403, "account_suspended", "This account is suspended.")
    return user


def synced_matches(db: Session = Depends(get_db), ctx: AppContext = Depends(get_ctx)) -> None:
    """Finish any due nightly batch and release step before a /matches or /blocks route
    reads or acts on state (SPEC §6.9). Never triggered by the request's own action."""
    sync_matches(db, ctx.clock, ctx.settings, ctx.ids)


def check_ip_rate_limit(request: Request, ctx: AppContext, bucket: str, limit: int) -> None:
    """Raises 429 once this IP has made more than `limit` requests to `bucket` within the
    current hourly window (CLAUDE.md §9, invariant 5 -- see `services/rate_limit.py` for why
    this exists and what it deliberately never stores). Called from a route body, the same
    way `messages.py` checks `ctx.settings.messages.rate_limit_per_minute`, so the limit is
    read from settings at request time rather than captured into a dependency at import time."""
    if not within_ip_rate_limit(request, ctx, bucket, limit):
        raise ApiError(429, "rate_limited", "Too many requests. Try again in a while.")


def within_ip_rate_limit(request: Request, ctx: AppContext, bucket: str, limit: int) -> bool:
    """The same hourly per-IP counter, returning False instead of raising -- for the HTML
    pages (/admin, /colleges), which answer with a page rather than a JSON error. The one
    place outside clock.py that reads the client address (test_no_client_address_is_read)."""
    ip = request.client.host if request.client is not None else "unknown"
    return ctx.rate_limiter.hit(bucket, ip, limit)
