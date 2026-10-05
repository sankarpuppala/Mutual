"""The FastAPI application factory.

Run (dev):  $env:MUTUAL_ENV="dev"; uvicorn mutual_server.main:create_app --factory --reload
            --no-access-log --app-dir server
The access log stays off in every environment: it would record client IP addresses (D22).
"""

from __future__ import annotations

import asyncio
import contextlib
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from mutual_server.clock import Clock, SystemClock
from mutual_server.config import ConfigError, Settings, load_settings
from mutual_server.db import make_engine, make_session_factory
from mutual_server.deps import AppContext
from mutual_server.errors import install_error_handlers
from mutual_server.ids import IdFactory, UuidIds
from mutual_server.models import Campus
from mutual_server.routers import account, auth, config_route, dev, digest, presence, profile
from mutual_server.services.campus import seed_config_campuses
from mutual_server.services.email import EmailSender, make_sender
from mutual_server.services.retention import run_retention

_RETENTION_INTERVAL_SECONDS = 3600  # CLAUDE.md §6 / SPEC.md §9: "runs at startup and every hour"


def _check_study_campuses(db: Session, settings: Settings) -> None:
    """CLAUDE.md invariant 9: study mode needs approval and open campuses, or no start."""
    if not settings.study.enabled:
        return
    open_keys = set(db.scalars(select(Campus.key).where(Campus.status == "open")))
    missing = [k for k in settings.study.campuses if k not in open_keys]
    if missing:
        raise ConfigError(f"study.campuses not open: {', '.join(missing)}")


async def _retention_loop(session_factory: sessionmaker[Session], ctx: AppContext) -> None:
    while True:
        await asyncio.sleep(_RETENTION_INTERVAL_SECONDS)
        try:
            with session_factory() as db:
                run_retention(db, ctx.clock, ctx.settings)
        except Exception as exc:  # noqa: BLE001 - a failed sweep must never crash the server
            # No request data (no IP, no user id) in this line — it is the only
            # place the server ever prints outside the dev OTP console message.
            print(f"[retention] hourly sweep failed: {exc!r}", file=sys.stderr)


def create_app(
    settings: Settings | None = None,
    *,
    clock: Clock | None = None,
    ids: IdFactory | None = None,
    email: EmailSender | None = None,
    engine: Engine | None = None,
) -> FastAPI:
    settings = settings or load_settings()
    ctx = AppContext(
        settings=settings,
        clock=clock or SystemClock(),
        ids=ids or UuidIds(),
        email=email or make_sender(settings.email),
    )
    engine = engine or make_engine(settings.database_url)
    session_factory: sessionmaker[Session] = make_session_factory(engine)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        with session_factory() as db:
            seed_config_campuses(db, settings, ctx.ids, ctx.clock)
            _check_study_campuses(db, settings)
            run_retention(db, ctx.clock, settings)
        task = asyncio.create_task(_retention_loop(session_factory, ctx))
        try:
            yield
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title="Mutual", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.ctx = ctx
    app.state.session_factory = session_factory
    app.state.engine = engine
    install_error_handlers(app)

    v1 = APIRouter(prefix="/v1")
    for module in (auth, account, profile, config_route, presence, digest):
        v1.include_router(module.router)
    if settings.env == "dev":
        v1.include_router(dev.router)  # never mounted outside dev (invariant 11)
    app.include_router(v1)
    return app
