"""/colleges — how a college asks for Mutual to be opened (SPEC.md §4.2).

Public, plain HTML forms. An official proves they hold an address at the college's own
domain with an emailed code; an operator then reviews the application in /admin. Nothing
here opens a campus.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Form, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from sqlalchemy.orm import Session

from mutual_server.deps import AppContext, get_ctx, get_db, within_ip_rate_limit
from mutual_server.services import colleges as colleges_service
from mutual_server.web.html import SECURITY_HEADERS, e, flash, page

router = APIRouter(prefix="/colleges", tags=["colleges"])

_NAV = [("For colleges", "/colleges", True)]

_ABOUT = """
<h1>Bring Mutual to your college</h1>
<p class="lede">Mutual helps students meet the people they already share a campus with —
for study, a project, fitness, friendship or a date — without feeds, swiping or location
tracking. It opens one college at a time, and only after someone at the college asks.</p>

<div class="card">
<h2 style="margin-top:0">What students get</h2>
<p>Each morning, a short list of fellow students they actually spent time near the day
before — noticed by Bluetooth between phones, never GPS, never a place, never live. They
can send a private signal to anyone on it. If two people signal each other for the same
reason, both find out the next morning. If not, <b>nobody ever learns the signal existed</b>
— not the other student, and not us. Photos appear only after a mutual match.</p>
</div>

<div class="card">
<h2 style="margin-top:0">What opening a college involves</h2>
<p><b>1. Apply below</b> with your official college email. We send a code to that address
— it proves the request comes from someone at the college.<br>
<b>2. We talk.</b> We review every application by hand and agree the basics with you: who
the student-safety contact is, how reports are handled, and when to launch.<br>
<b>3. We open the campus.</b> Students sign in with their college email; anyone outside
the college's domain cannot join, and nobody at one college ever sees another.<br>
<b>4. Optional: a campus moderator.</b> Your safety officer can get a moderator login
that shows only your college's reports, never anything else.</p>
</div>

<div class="card">
<h2 style="margin-top:0">What we never collect</h2>
<p>No location. No contact lists. No advertising or analytics SDKs. Student emails,
dates of birth, login codes and IP addresses are never stored. Mutual is a research
prototype and has <b>not</b> been independently security-audited; we will say so to your
students too.</p>
</div>
"""


def _form(values: dict[str, str], error: str | None = None) -> str:
    v = {
        k: e(values.get(k, ""))
        for k in ("college_name", "domain", "contact_name", "contact_role", "contact_email", "note")
    }
    return f"""
<h2 id="apply">Apply</h2>
{flash(error, error=True)}
<form class="card" method="post" action="/colleges/apply">
<label for="college_name">College name</label>
<input type="text" id="college_name" name="college_name" required maxlength="120"
 value="{v["college_name"]}">
<label for="domain">The college's email domain</label>
<input type="text" id="domain" name="domain" required maxlength="253"
 placeholder="college.ac.in" value="{v["domain"]}">
<p class="hint">The part after the @ in student addresses. Subdomains are included.</p>
<label for="contact_name">Your name</label>
<input type="text" id="contact_name" name="contact_name" required maxlength="80"
 value="{v["contact_name"]}">
<label for="contact_role">Your role at the college</label>
<input type="text" id="contact_role" name="contact_role" required maxlength="80"
 placeholder="Dean of Students, Student Council President, …" value="{v["contact_role"]}">
<label for="contact_email">Your official email</label>
<input type="email" id="contact_email" name="contact_email" required maxlength="254"
 value="{v["contact_email"]}">
<p class="hint">Must be at the domain above. We use it only to reply about this
application, and delete it once the application is closed.</p>
<label for="note">Anything we should know (optional)</label>
<textarea id="note" name="note" maxlength="2000">{v["note"]}</textarea>
<p style="margin-top:16px"><button type="submit">Send verification code</button></p>
</form>
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
    except OSError:  # smtplib errors are OSErrors; nothing about the request is printed
        db.delete(row)
        db.commit()
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
