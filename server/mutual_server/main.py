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
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from mutual_server.clock import Clock, SystemClock
from mutual_server.config import ConfigError, Settings, load_settings
from mutual_server.db import make_engine, make_session_factory
from mutual_server.deps import AppContext
from mutual_server.errors import install_error_handlers
from mutual_server.ids import IdFactory, UuidIds
from mutual_server.models import Campus
from mutual_server.routers import (
    account,
    auth,
    config_route,
    dev,
    digest,
    feedback,
    matches,
    messages,
    presence,
    profile,
    safety,
    signals,
)
from mutual_server.services.campus import seed_config_campuses
from mutual_server.services.email import EmailSender, make_sender
from mutual_server.services.matching import sync_matches
from mutual_server.services.media import MediaStore, make_store
from mutual_server.services.operators import ensure_bootstrap_owner
from mutual_server.services.rate_limit import RateLimiter
from mutual_server.services.retention import run_retention
from mutual_server.web import admin as admin_web
from mutual_server.web import app_client as app_client_web
from mutual_server.web import colleges as colleges_web

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
                sync_matches(db, ctx.clock, ctx.settings, ctx.ids)
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
    media_store: MediaStore | None = None,
) -> FastAPI:
    settings = settings or load_settings()
    resolved_clock = clock or SystemClock()
    ctx = AppContext(
        settings=settings,
        clock=resolved_clock,
        ids=ids or UuidIds(),
        email=email or make_sender(settings),
        rate_limiter=RateLimiter(clock=resolved_clock),
        media_store=media_store or make_store(settings),
    )
    engine = engine or make_engine(settings.database_url)
    session_factory: sessionmaker[Session] = make_session_factory(engine)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        with session_factory() as db:
            seed_config_campuses(db, settings, ctx.ids, ctx.clock)
            ensure_bootstrap_owner(db, settings, ctx.ids, ctx.clock)
            _check_study_campuses(db, settings)
            sync_matches(db, ctx.clock, settings, ctx.ids)
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
    for module in (
        auth,
        account,
        profile,
        config_route,
        presence,
        digest,
        signals,
        matches,
        messages,
        safety,
        feedback,
    ):
        v1.include_router(module.router)
    if settings.env == "dev":
        v1.include_router(dev.router)  # never mounted outside dev (invariant 11)
    app.include_router(v1)

    # Server-rendered pages, outside /v1: the public college application form (SPEC §4.2),
    # the operator console (SPEC §11.3), and the interactive web client at /app.
    app.include_router(colleges_web.router)
    app.include_router(app_client_web.router)
    admin_web.install(app)

    @app.get("/", include_in_schema=False)
    def _root() -> RedirectResponse:
        return RedirectResponse("/colleges", status_code=307)

    @app.get("/healthz", include_in_schema=False)
    def _health() -> dict[str, str]:
        return {
            "status": "ok",
            "version": "0.1.3",
            "media_backend": type(ctx.media_store).__name__,
        }

    @app.get("/otp", include_in_schema=False, response_class=HTMLResponse)
    def _otp_page() -> HTMLResponse:
        html = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mutual · Verification Code</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#F7F3EE;--card:#FFFFFF;--ink:#1D1A22;--muted:#5F5868;--signal:#B5523F;--hair:#E3DCD2;--shadow:0 1px 3px rgba(29,26,34,.05), 0 8px 24px rgba(29,26,34,.07);--font-display:'Fraunces',serif;--font-ui:'Inter',sans-serif}
body{background:var(--bg);color:var(--ink);font-family:var(--font-ui);margin:0;padding:40px 20px;display:flex;justify-content:center}
.wrap{max-width:440px;width:100%}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:24px}
.brand span{font-family:var(--font-display);font-size:24px;font-weight:600}
.card{background:var(--card);border:1px solid var(--hair);border-radius:20px;padding:28px;box-shadow:var(--shadow)}
h1{font-family:var(--font-display);font-size:26px;font-weight:600;margin:0 0 8px}
p{color:var(--muted);font-size:14px;line-height:1.5;margin:0 0 20px}
label{display:block;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
input{width:100%;box-sizing:border-box;border:1px solid var(--hair);border-radius:10px;padding:12px 14px;font-size:15px;background:#FAF8F5;color:var(--ink);font-family:inherit;outline:none}
input:focus{border-color:var(--ink)}
button{width:100%;background:var(--ink);color:#fff;border:none;border-radius:12px;padding:13px;font-size:15px;font-weight:500;cursor:pointer;margin-top:14px;font-family:inherit}
button:hover{opacity:.9}
.btn-sec{background:transparent;color:var(--ink);border:1px solid var(--hair);margin-top:8px}
.result{margin-top:20px;padding:18px;border-radius:14px;background:#FAF8F5;border:1px solid var(--hair);text-align:center;display:none}
.result.show{display:block}
.code-num{font-family:monospace;font-size:36px;font-weight:700;letter-spacing:6px;color:var(--signal);margin:8px 0}
.notice{font-size:12px;color:var(--muted);margin-top:8px}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" stroke="#1D1A22" stroke-width="2"/><circle cx="12" cy="16" r="4" fill="#B5523F"/><circle cx="20" cy="16" r="4" fill="#4F4FC4"/></svg>
    <span>Mutual</span>
  </div>
  <div class="card">
    <h1>Login Code Lookup</h1>
    <p>Because free cloud tiers block outbound SMTP ports, retrieve your active 6-digit confirmation code directly here.</p>
    <label for="emailInp">College Email</label>
    <input type="email" id="emailInp" placeholder="you@college.ac.in" value="nagapuppala@iisc.ac.in">
    <button type="button" id="btnGet">Get Confirmation Code</button>
    <button type="button" class="btn-sec" id="btnRequest">Request New Code</button>
    <div id="resultBox" class="result">
      <div style="font-size:13px;color:var(--muted)" id="resultLabel">Active confirmation code:</div>
      <div class="code-num" id="codeVal">------</div>
      <button type="button" class="btn-sec" style="margin:0" id="btnCopy">Copy Code</button>
      <div class="notice" id="expiresVal">Valid for login on phone app and web client.</div>
    </div>
  </div>
</div>
<script>
const inp = document.getElementById('emailInp');
const btn = document.getElementById('btnGet');
const btnReq = document.getElementById('btnRequest');
const box = document.getElementById('resultBox');
const codeVal = document.getElementById('codeVal');
const copyBtn = document.getElementById('btnCopy');
const expVal = document.getElementById('expiresVal');

async function checkCode(){
  const email = inp.value.trim();
  if (!email){ alert('Please enter your email'); return; }
  btn.textContent = 'Checking...';
  try {
    const res = await fetch('/v1/auth/dev-code?email=' + encodeURIComponent(email));
    if (res.ok){
      const data = await res.json();
      codeVal.textContent = data.code;
      box.classList.add('show');
      expVal.textContent = 'Expires: ' + new Date(data.expires_at).toLocaleTimeString();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.message || 'No active code found. Click "Request New Code" first.');
    }
  } catch (e){
    alert('Could not reach server.');
  } finally {
    btn.textContent = 'Get Confirmation Code';
  }
}

btn.addEventListener('click', checkCode);
btnReq.addEventListener('click', async () => {
  const email = inp.value.trim();
  if (!email){ alert('Please enter your email'); return; }
  btnReq.textContent = 'Requesting...';
  try {
    const res = await fetch('/v1/auth/request-otp', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email})
    });
    if (res.status === 204){
      const headerCode = res.headers.get('X-Mutual-Debug-OTP');
      if (headerCode){
        codeVal.textContent = headerCode;
        box.classList.add('show');
        expVal.textContent = 'Code generated just now!';
      } else {
        await checkCode();
      }
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.message || 'Could not request code. Check email address.');
    }
  } catch (e){
    alert('Failed to send request.');
  } finally {
    btnReq.textContent = 'Request New Code';
  }
});
copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(codeVal.textContent);
  copyBtn.textContent = 'Copied!';
  setTimeout(() => copyBtn.textContent = 'Copy Code', 1500);
});
</script>
</body>
</html>
"""
        return HTMLResponse(html, status_code=200)

    return app
