"""/colleges — how a college asks for Mutual to be opened (SPEC.md §4.2).

Public, plain HTML forms. An official proves they hold an address at the college's own
domain with an emailed code; an operator then reviews the application in /admin. Nothing
here opens a campus.
"""

from __future__ import annotations

import sys

from fastapi import APIRouter, Depends, Form, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from sqlalchemy.orm import Session

from mutual_server.deps import AppContext, get_ctx, get_db, within_ip_rate_limit
from mutual_server.services import colleges as colleges_service
from mutual_server.web.html import SECURITY_HEADERS, e, flash, page

router = APIRouter(prefix="/colleges", tags=["colleges"])

_NAV = [("Open Web App", "/app", False), ("For colleges", "/colleges", True)]

_ABOUT = """
<div class="hero">
  <div class="eyebrow">Bring Mutual to your college</div>
  <h1>Meet the people you <em class="italic-accent">almost</em> meet.</h1>
  <p class="lede">Mutual helps students meet the people they already share a campus with —
for study, a project, fitness, friendship or a date — without feeds, swiping or location
tracking. It opens one college at a time, and only after someone at the college asks.</p>
  <div style="margin-top:18px;display:flex;gap:12px;flex-wrap:wrap">
    <a href="/app" style="display:inline-flex;align-items:center;gap:8px;padding:12px 24px;border-radius:999px;background:var(--ink);color:var(--bg);font-weight:600;">Launch Mutual Web App &rarr;</a>
    <a href="#apply" style="display:inline-flex;align-items:center;gap:8px;padding:12px 24px;border-radius:999px;background:var(--sunk);color:var(--ink);font-weight:600;border:1px solid var(--line);">Apply for Campus Opening</a>
  </div>
</div>

<div class="grid">
  <div class="card-grid-item">
    <h3>What students get</h3>
    <p>Each morning, a short list of fellow students they spent time near yesterday — noticed by Bluetooth between phones, never GPS, never a place, never live. Signals stay secret unless both students signal each other.</p>
  </div>
  <div class="card-grid-item">
    <h3>What opening involves</h3>
    <p>1. <b>Apply below</b> with your official college email to receive a verification code.<br>
    2. <b>We talk:</b> agree safety basics, moderation, and schedule.<br>
    3. <b>Campus opens:</b> only @college domain accounts can join.</p>
  </div>
  <div class="card-grid-item">
    <h3>Privacy by design</h3>
    <p>No location. No contact lists. No third-party analytics or ad SDKs. Student emails, dates of birth, login codes and IP addresses are never stored. Mutual is an unaudited research prototype built for genuine student privacy.</p>
  </div>
</div>
"""


def _form(values: dict[str, str], error: str | None = None) -> str:
    v = {
        k: e(values.get(k, ""))
        for k in ("college_name", "domain", "contact_name", "contact_role", "contact_email", "note")
    }
    return f"""
<div class="card">
<h2 id="apply" style="margin-top:0">Apply to open your college</h2>
<p class="lede" style="margin-bottom:18px">Provide your official address to start the verification process.</p>
{flash(error, error=True)}
<form method="post" action="/colleges/apply">
<label for="college_name">College name</label>
<input type="text" id="college_name" name="college_name" required maxlength="120"
 placeholder="e.g. Indian Institute of Science" value="{v["college_name"]}">
<label for="domain">The college's email domain</label>
<input type="text" id="domain" name="domain" required maxlength="253"
 placeholder="e.g. iisc.ac.in" value="{v["domain"]}">
<p class="hint">The part after the @ in student addresses. Subdomains are included.</p>
<label for="contact_name">Your name</label>
<input type="text" id="contact_name" name="contact_name" required maxlength="80"
 placeholder="Your full name" value="{v["contact_name"]}">
<label for="contact_role">Your role at the college</label>
<input type="text" id="contact_role" name="contact_role" required maxlength="80"
 placeholder="Dean of Students, Student Council President, Student, …" value="{v["contact_role"]}">
<label for="contact_email">Your official email</label>
<input type="email" id="contact_email" name="contact_email" required maxlength="254"
 placeholder="you@college.ac.in" value="{v["contact_email"]}">
<p class="hint">Must be at the domain above. We use it only to reply about this
application, and delete it once the application is closed.</p>
<label for="note">Anything we should know (optional)</label>
<textarea id="note" name="note" maxlength="2000" placeholder="Campus size, student initiatives, or special requests...">{v["note"]}</textarea>
<p style="margin-top:20px"><button type="submit">Send verification code</button></p>
</form>
</div>
"""


@router.get("", response_class=HTMLResponse)
def colleges_home() -> HTMLResponse:
    return page("For colleges", _ABOUT + _form({}), nav=_NAV)


@router.post("/apply", response_class=HTMLResponse)
def apply(
    request: Request,
    college_name: str = Form(""),
    domain: str = Form(""),
    contact_name: str = Form(""),
    contact_role: str = Form(""),
    contact_email: str = Form(""),
    note: str = Form(""),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    values = {
        "college_name": college_name,
        "domain": domain,
        "contact_name": contact_name,
        "contact_role": contact_role,
        "contact_email": contact_email,
        "note": note,
    }
    if not within_ip_rate_limit(
        request, ctx, "college_apply", ctx.settings.colleges.apply_ip_limit_per_hour
    ):
        return page(
            "For colleges",
            _ABOUT + _form(values, "Too many applications from here. Try again later."),
            nav=_NAV,
            status_code=429,
        )
    try:
        row, code = colleges_service.submit(
            db, ctx.settings, ctx.ids, ctx.clock, ctx.pepper, **values
        )
    except colleges_service.ApplicationError as exc:
        return page("For colleges", _ABOUT + _form(values, str(exc)), nav=_NAV, status_code=400)
    try:
        ctx.email.send_college_code(row.contact_email, code)
    except OSError as exc:  # smtplib errors are OSErrors; user data is not logged
        db.delete(row)
        db.commit()
        print(f"[colleges] ERROR sending verification email: {type(exc).__name__}: {exc}", file=sys.stderr)
        return page(
            "For colleges",
            _ABOUT + _form(values, "We couldn't send the code just now. Try again in a while."),
            nav=_NAV,
            status_code=503,
        )
    return RedirectResponse(
        f"/colleges/verify?application={row.id}", status_code=303, headers=SECURITY_HEADERS
    )


def _verify_page(app_id: str, error: str | None = None, status_code: int = 200) -> HTMLResponse:
    body = f"""
<h1>Check your inbox</h1>
<p class="lede">We sent a six-digit code to the address you gave. It proves the
application really comes from the college.</p>
{flash(error, error=True)}
<form class="card" method="post" action="/colleges/verify">
<input type="hidden" name="application" value="{e(app_id)}">
<label for="code">Verification code</label>
<input type="text" id="code" name="code" inputmode="numeric" autocomplete="one-time-code"
 required maxlength="6">
<p style="margin-top:16px"><button type="submit">Verify</button></p>
</form>
"""
    return page("Verify", body, nav=_NAV, narrow=True, status_code=status_code)


@router.get("/verify", response_class=HTMLResponse)
def verify_form(application: str = Query("", max_length=36)) -> HTMLResponse:
    return _verify_page(application)


@router.post("/verify", response_class=HTMLResponse)
def verify(
    request: Request,
    application: str = Form("", max_length=36),
    code: str = Form("", max_length=12),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> HTMLResponse:
    if not within_ip_rate_limit(
        request, ctx, "college_verify", ctx.settings.colleges.verify_ip_limit_per_hour
    ):
        return _verify_page(application, "Too many tries. Try again later.", 429)
    try:
        row = colleges_service.verify(db, ctx.settings, ctx.clock, ctx.pepper, application, code)
    except colleges_service.ApplicationError as exc:
        return _verify_page(application, str(exc), 400)
    body = f"""
<h1>Thank you</h1>
<p class="lede">Your application for <b>{e(row.college_name)}</b> is verified. We review
every application by hand and will write to <b>{e(row.contact_email)}</b> to agree the
details before anything opens.</p>
<p><a href="/colleges">Back</a></p>
"""
    return page("Verified", body, nav=_NAV, narrow=True)
