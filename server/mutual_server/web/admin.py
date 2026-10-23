"""/admin — the operator console (SPEC.md §11.3).

Operators are not participants (SPEC.md §19 Q8): they sign in with a username and
password created by ``python -m mutual_server.admin operators add``, never with a
student account. Two roles:

* **owner** (``campus_id`` NULL) — every campus: opening colleges, applications,
  operators, reports, suspensions, the audit log;
* **campus moderator** — one campus's reports and users only (a partner college's
  safety officer, SPEC.md §4.2). Campus isolation (invariant 13) holds for them too.

What the console deliberately cannot show: anyone's signals, crossings, digest or
messages outside a report's own excerpt — the server holds no plaintext signals at all
(SPEC.md §7.3), and the rest is not an operator's business. No route takes a user id in
its path (invariant 10 / ``test_route_audit.py``); ids travel in query strings and forms.

Security: the session cookie is HttpOnly, SameSite=Strict, Secure outside dev/test and
scoped to /admin; every POST carries a per-session CSRF token; sign-in is rate-limited
per IP (the IP is never stored, invariant 5); every change is written to the audit log.
"""

from __future__ import annotations

import secrets
import textwrap
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import quote
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, FastAPI, Form, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from mutual_server import security
from mutual_server.deps import AppContext, get_ctx, get_db, within_ip_rate_limit
from mutual_server.models import (
    AdminAudit,
    Campus,
    CollegeApplication,
    Match,
    Operator,
    OperatorSession,
    Report,
    User,
)
from mutual_server.services import campus as campus_service
from mutual_server.services import colleges as colleges_service
from mutual_server.services import operators as operators_service
from mutual_server.web.html import SECURITY_HEADERS, e, flash, page, when

router = APIRouter(prefix="/admin", tags=["admin"])

COOKIE = "mutual_operator"


class _Redirect(Exception):
    def __init__(self, location: str) -> None:
        self.location = location


@dataclass
class Auth:
    operator: Operator
    session: OperatorSession

    @property
    def owner(self) -> bool:
        return self.operator.campus_id is None


def install(app: FastAPI) -> None:
    """Mount the console and its sign-in redirect."""

    @app.exception_handler(_Redirect)
    async def _redirect(_: Request, exc: _Redirect) -> Response:
        return RedirectResponse(exc.location, status_code=303, headers=SECURITY_HEADERS)

    app.include_router(router)


def require(
    request: Request, db: Session = Depends(get_db), ctx: AppContext = Depends(get_ctx)
) -> Auth:
    token = request.cookies.get(COOKIE)
    if token:
        row = db.get(OperatorSession, security.session_hash(token))
        if row is not None and row.expires_at > ctx.clock.now():
            op = db.get(Operator, row.operator_id)
            if op is not None and op.disabled_at is None:
                return Auth(op, row)
    raise _Redirect("/admin/login")


def _csrf(auth: Auth, token: str) -> None:
    if not secrets.compare_digest(auth.session.csrf, token or ""):
        raise _Redirect("/admin?error=Your+session+changed.+Try+again.")


def _owner_only(auth: Auth) -> None:
    if not auth.owner:
        raise _Redirect("/admin?error=Only+an+owner+can+do+that.")


def _nav(auth: Auth, here: str) -> list[tuple[str, str, bool]]:
    items = [("Overview", "/admin"), ("Reports", "/admin/reports"), ("Users", "/admin/users")]
    if auth.owner:
        items += [
            ("Colleges", "/admin/campuses"),
            ("Applications", "/admin/applications"),
            ("Operators", "/admin/operators"),
            ("Audit log", "/admin/audit"),
        ]
    items.append(("Account", "/admin/account"))
    return [(label, href, href == here) for label, href in items]


def _hidden(auth: Auth) -> str:
    return f'<input type="hidden" name="csrf" value="{e(auth.session.csrf)}">'


def _button_form(
    auth: Auth, action: str, fields: dict[str, str], label: str, kind: str = ""
) -> str:
    inputs = "".join(
        f'<input type="hidden" name="{e(k)}" value="{e(v)}">' for k, v in fields.items()
    )
    return (
        f'<form class="inline" method="post" action="{e(action)}">{_hidden(auth)}{inputs}'
        f'<button type="submit" class="{e(kind)}">{e(label)}</button></form>'
    )


def _done(path: str, message: str) -> RedirectResponse:
    sep = "&" if "?" in path else "?"
    return RedirectResponse(
        f"{path}{sep}ok={quote(message)}", status_code=303, headers=SECURITY_HEADERS
    )


def _flashes(ok: str | None, error: str | None) -> str:
    return flash(ok) + flash(error, error=True)


def _log(db: Session, ctx: AppContext, auth: Auth, action: str, target: str) -> None:
    operators_service.audit(db, ctx.ids, ctx.clock, auth.operator.username, action, target)


def _scoped_campus_ids(db: Session, auth: Auth) -> list[str]:
    if auth.owner:
        return list(db.scalars(select(Campus.id).where(Campus.status == "open")))
    return [auth.operator.campus_id] if auth.operator.campus_id else []


def _excerpt_time(value: object, tz: ZoneInfo) -> str:
    """A report excerpt's ISO timestamp, shown in the deployment timezone like the rest."""
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return e(value)
    return when(parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC), tz)


def _report_campus(db: Session, report: Report) -> str | None:
    for uid in (report.reported_id, report.reporter_id):
        user = db.get(User, uid)
        if user is not None:
            return user.campus_id
    return None


def _visible_report(db: Session, auth: Auth, report: Report | None) -> Report:
    if report is None:
        raise _Redirect("/admin/reports?error=No+such+report.")
    if not auth.owner and _report_campus(db, report) != auth.operator.campus_id:
        raise _Redirect("/admin/reports?error=No+such+report.")
    return report


def _visible_user(db: Session, auth: Auth, user_id: str) -> User:
    user = db.get(User, user_id.strip())
    if user is None or (not auth.owner and user.campus_id != auth.operator.campus_id):
        raise _Redirect("/admin/users?error=No+such+user+on+your+campus.")
    return user


# --- sign in / out -------------------------------------------------------------------


def _login_page(error: str | None = None, status_code: int = 200) -> HTMLResponse:
    body = f"""
<h1>Operator sign-in</h1>
<p class="lede">For the people who run this deployment. Students sign in in the app.</p>
{flash(error, error=True)}
<form class="card" method="post" action="/admin/login">
<label for="username">Username</label>
<input type="text" id="username" name="username" autocomplete="username" required>
<label for="password">Password</label>
<input type="password" id="password" name="password" autocomplete="current-password" required>
<p style="margin-top:16px"><button type="submit">Sign in</button></p>
</form>
<p class="hint">No operator yet? On the server run
<code>python -m mutual_server.admin operators add &lt;username&gt;</code>.</p>
"""
    return page("Sign in", body, brand_href="/admin", narrow=True, status_code=status_code)


@router.get("/login", response_class=HTMLResponse)
def login_form() -> HTMLResponse:
    return _login_page()


@router.post("/login", response_class=HTMLResponse)
def login(
    request: Request,
    username: str = Form("", max_length=40),
    password: str = Form("", max_length=200),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    if not within_ip_rate_limit(
        request, ctx, "admin_login", ctx.settings.admin.login_ip_limit_per_hour
    ):
        return _login_page("Too many attempts. Try again later.", 429)
    op = db.scalar(select(Operator).where(Operator.username == username.strip().lower()))
    stored = op.password_hash if op is not None else security.DUMMY_PASSWORD_HASH
    valid = security.check_password(password, stored)
    if op is None or not valid or op.disabled_at is not None:
        return _login_page("That username and password don't match.", 401)
    token, token_hash = security.new_session_token()
    now = ctx.clock.now()
    ttl = timedelta(hours=ctx.settings.admin.session_ttl_hours)
    db.add(
        OperatorSession(
            token_hash=token_hash,
            operator_id=op.id,
            csrf=secrets.token_hex(32),
            expires_at=now + ttl,
            created_at=now,
        )
    )
    db.commit()
    operators_service.audit(db, ctx.ids, ctx.clock, op.username, "sign_in", op.username)
    response = RedirectResponse("/admin", status_code=303, headers=SECURITY_HEADERS)
    response.set_cookie(
        COOKIE,
        token,
        max_age=int(ttl.total_seconds()),
        path="/admin",
        httponly=True,
        samesite="strict",
        secure=ctx.settings.env == "prod",
    )
    return response


@router.post("/logout")
def logout(
    csrf: str = Form(""),
    auth: Auth = Depends(require),
    db: Session = Depends(get_db),
) -> Response:
    _csrf(auth, csrf)
    row = db.get(OperatorSession, auth.session.token_hash)
    if row is not None:
        db.delete(row)
        db.commit()
    response = RedirectResponse("/admin/login", status_code=303, headers=SECURITY_HEADERS)
    response.delete_cookie(COOKIE, path="/admin")
    return response


# --- overview ------------------------------------------------------------------------


@router.get("", response_class=HTMLResponse)
def overview(
    ok: str | None = None,
    error: str | None = None,
    auth: Auth = Depends(require),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> HTMLResponse:
    campus_ids = _scoped_campus_ids(db, auth)
    week_ago = ctx.clock.now() - timedelta(days=7)
    rows = []
    totals = {"students": 0, "new": 0, "matches": 0, "reports": 0}
    for campus in db.scalars(select(Campus).where(Campus.id.in_(campus_ids)).order_by(Campus.key)):
        students = db.scalar(select(func.count()).where(User.campus_id == campus.id)) or 0
        new = (
            db.scalar(
                select(func.count()).where(User.campus_id == campus.id, User.created_at >= week_ago)
            )
            or 0
        )
        campus_users = select(User.id).where(User.campus_id == campus.id)
        matches = (
            db.scalar(
                select(func.count())
                .select_from(Match)
                .where(Match.ended_at.is_(None), Match.user_lo.in_(campus_users))
            )
            or 0
        )
        reports = (
            db.scalar(
                select(func.count())
                .select_from(Report)
                .where(Report.status == "open", Report.reported_id.in_(campus_users))
            )
            or 0
        )
        for k, v in (
            ("students", students),
            ("new", new),
            ("matches", matches),
            ("reports", reports),
        ):
            totals[k] += v
        partner = '<span class="chip ok">partner</span>' if campus.partner_verified_at else ""
        rows.append(
            f"<tr><td><b>{e(campus.name)}</b> {partner}<br><span class=muted>{e(campus.key)}</span></td>"
            f"<td>{students}</td><td>{new}</td><td>{matches}</td>"
            f"<td>{f'<a href=/admin/reports>{reports}</a>' if reports else '0'}</td></tr>"
        )
    extra = ""
    if auth.owner:
        waiting = (
            db.scalar(select(func.count()).where(CollegeApplication.status == "verified")) or 0
        )
        pending = list(
            db.scalars(
                select(Campus)
                .where(Campus.status == "pending")
                .order_by(Campus.attempts.desc())
                .limit(5)
            )
        )
        pending_rows = (
            "".join(f"<tr><td>{e(c.key)}</td><td>{c.attempts}</td></tr>" for c in pending)
            or "<tr><td colspan=2 class=muted>None yet.</td></tr>"
        )
        extra = f"""
<h2>Waiting on you</h2>
<div class="grid">
<a class="stat" href="/admin/applications" style="text-decoration:none;color:inherit">
<b>{waiting}</b><span>verified college applications</span></a>
<a class="stat" href="/admin/campuses" style="text-decoration:none;color:inherit">
<b>{len(pending)}</b><span>colleges students tried to join</span></a>
</div>
<h2>Most-requested colleges not yet open</h2>
<div class="card scroll"><table><tr><th>Campus key</th><th>Sign-in attempts</th></tr>
{pending_rows}</table></div>"""
    scope = "every campus" if auth.owner else "your campus"
    body = f"""
{_flashes(ok, error)}
<h1>Overview</h1>
<p class="lede">Signed in as <b>{e(auth.operator.username)}</b> · {scope}.
Counts only — the server never holds anyone's signals.</p>
<div class="grid">
<div class="stat"><b>{totals["students"]}</b><span>students</span></div>
<div class="stat"><b>{totals["new"]}</b><span>joined in the last 7 days</span></div>
<div class="stat"><b>{totals["matches"]}</b><span>active mutuals</span></div>
<div class="stat"><b>{totals["reports"]}</b><span>open reports</span></div>
</div>
{extra}
<h2>Open campuses</h2>
<div class="card scroll"><table>
<tr><th>College</th><th>Students</th><th>New (7 d)</th><th>Active mutuals</th><th>Open reports</th></tr>
{"".join(rows) or "<tr><td colspan=5 class=muted>No campus is open yet.</td></tr>"}
</table></div>
"""
    return page("Overview", body, nav=_nav(auth, "/admin"), brand_href="/admin")


# --- reports -------------------------------------------------------------------------


@router.get("/reports", response_class=HTMLResponse)
def reports(
    status: str = Query("open", pattern="^(open|resolved)$"),
    ok: str | None = None,
    error: str | None = None,
    auth: Auth = Depends(require),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> HTMLResponse:
    query = select(Report).where(Report.status == status).order_by(Report.created_at.desc())
    if not auth.owner:
        campus_users = select(User.id).where(User.campus_id == auth.operator.campus_id)
        query = query.where(
            or_(Report.reported_id.in_(campus_users), Report.reporter_id.in_(campus_users))
        )
    rows = (
        "".join(
            f'<tr><td><a href="/admin/reports/view?id={e(r.id)}">{e(r.reason)}</a></td>'
            f"<td>{when(r.created_at, ctx.settings.tz)}</td><td>{len(r.excerpt)}</td></tr>"
            for r in db.scalars(query.limit(200))
        )
        or f"<tr><td colspan=3 class=muted>No {e(status)} reports.</td></tr>"
    )
    tabs = " · ".join(
        f"<b>{s}</b>" if s == status else f'<a href="/admin/reports?status={s}">{s}</a>'
        for s in ("open", "resolved")
    )
    body = f"""
{_flashes(ok, error)}
<h1>Reports</h1>
<p class="lede">{tabs}. A report carries the last messages of the conversation, which the
reporter agreed to share (SPEC §8).</p>
<div class="card scroll"><table><tr><th>Reason</th><th>Filed</th><th>Messages attached</th></tr>
{rows}</table></div>"""
    return page("Reports", body, nav=_nav(auth, "/admin/reports"), brand_href="/admin")


@router.get("/reports/view", response_class=HTMLResponse)
def report_view(
    id: str = Query(..., max_length=36),
    ok: str | None = None,
    auth: Auth = Depends(require),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> HTMLResponse:
    r = _visible_report(db, auth, db.get(Report, id))
    tz = ctx.settings.tz
    names = {}
    for uid in (r.reporter_id, r.reported_id):
        u = db.get(User, uid)
        names[uid] = f"{u.first_name}" if u else "deleted account"
    excerpt = (
        "".join(
            f"<div><span class=muted>{_excerpt_time(m.get('created_at'), tz)}</span> "
            f"<b>{e('reported' if m.get('sender_id') == r.reported_id else 'reporter')}:</b> "
            f"{e(textwrap.shorten(str(m.get('body', '')), width=600))}</div>"
            for m in r.excerpt
        )
        or "<div class=muted>No messages were exchanged.</div>"
    )
    reported = db.get(User, r.reported_id)
    actions = ""
    if r.status == "open":
        actions += _button_form(auth, "/admin/reports/resolve", {"id": r.id}, "Mark resolved")
    if reported is not None and reported.suspended_at is None:
        actions += " " + _button_form(
            auth,
            "/admin/users/suspend",
            {"id": reported.id, "back": f"/admin/reports/view?id={r.id}"},
            "Suspend reported user",
            "danger",
        )
    elif reported is not None:
        actions += ' <span class="chip danger">reported user suspended</span>'
    body = f"""
{flash(ok)}
<p><a href="/admin/reports">← Reports</a></p>
<h1>Report: {e(r.reason)}</h1>
<div class="card">
<p><b>Status:</b> {e(r.status)} · <b>Filed:</b> {when(r.created_at, tz)}
{f" · <b>Resolved:</b> {when(r.resolved_at, tz)}" if r.resolved_at else ""}</p>
<p><b>Reporter:</b> {e(names[r.reporter_id])} <code>{e(r.reporter_id)}</code><br>
<b>Reported:</b> {e(names[r.reported_id])} <code>{e(r.reported_id)}</code>
{f' · <a href="/admin/users?id={e(r.reported_id)}">user record</a>' if reported else ""}</p>
<h2>Conversation excerpt</h2><div class="excerpt">{excerpt}</div>
<div class="row" style="margin-top:16px">{actions}</div>
</div>"""
    return page("Report", body, nav=_nav(auth, "/admin/reports"), brand_href="/admin")


@router.post("/reports/resolve")
def report_resolve(
    id: str = Form(..., max_length=36),
    csrf: str = Form(""),
    auth: Auth = Depends(require),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    _csrf(auth, csrf)
    r = _visible_report(db, auth, db.get(Report, id))
    r.status, r.resolved_at = "resolved", ctx.clock.now()
    db.commit()
    _log(db, ctx, auth, "report_resolve", r.id)
    return _done(f"/admin/reports/view?id={r.id}", "Report resolved.")


# --- users ---------------------------------------------------------------------------


@router.get("/users", response_class=HTMLResponse)
def users(
    id: str = Query("", max_length=36),
    ok: str | None = None,
    error: str | None = None,
    auth: Auth = Depends(require),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> HTMLResponse:
    detail = ""
    if id.strip():
        user = _visible_user(db, auth, id)
        campus = db.get(Campus, user.campus_id)
        tz = ctx.settings.tz
        reports_against = db.scalar(select(func.count()).where(Report.reported_id == user.id)) or 0
        if user.suspended_at is None:
            act = _button_form(auth, "/admin/users/suspend", {"id": user.id}, "Suspend", "danger")
            state = '<span class="chip ok">active</span>'
        else:
            act = _button_form(
                auth, "/admin/users/unsuspend", {"id": user.id}, "Lift suspension", "ghost"
            )
            state = f'<span class="chip danger">suspended {when(user.suspended_at, tz)}</span>'
        detail = f"""
<div class="card">
<h2 style="margin-top:0">{e(user.first_name)} {state}</h2>
<p><code>{e(user.id)}</code></p>
<p><b>College:</b> {e(campus.name if campus else "—")} · <b>Year:</b> {e(user.year_of_study or "—")}
· <b>Joined:</b> {when(user.created_at, tz)} · <b>Reports against:</b> {reports_against}</p>
<p class="hint">Suspension signs them out of every request at once and stops them signing in
again. It does not erase mutuals the other person already has (SPEC §6.9).</p>
<div class="row">{act}</div>
</div>"""
    body = f"""
{_flashes(ok, error)}
<h1>Users</h1>
<p class="lede">Look up an account by its id — from a report, or from a student who wrote to
you about their own account. There is deliberately no list of everyone.</p>
<form class="card row" method="get" action="/admin/users">
<input type="text" name="id" placeholder="user id" value="{e(id)}" style="flex:1;min-width:220px">
<button type="submit">Look up</button></form>
{detail}"""
    return page("Users", body, nav=_nav(auth, "/admin/users"), brand_href="/admin")


def _safe_back(back: str, fallback: str) -> str:
    ok = back.startswith("/admin") and "//" not in back and "\\" not in back
    return back if ok else fallback


@router.post("/users/suspend")
def user_suspend(
    id: str = Form(..., max_length=36),
    back: str = Form("", max_length=200),
    csrf: str = Form(""),
    auth: Auth = Depends(require),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    _csrf(auth, csrf)
    user = _visible_user(db, auth, id)
    if user.suspended_at is None:
        user.suspended_at = ctx.clock.now()
        db.commit()
        _log(db, ctx, auth, "user_suspend", user.id)
    return _done(_safe_back(back, f"/admin/users?id={user.id}"), f"{user.first_name} is suspended.")


@router.post("/users/unsuspend")
def user_unsuspend(
    id: str = Form(..., max_length=36),
    csrf: str = Form(""),
    auth: Auth = Depends(require),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    _csrf(auth, csrf)
    user = _visible_user(db, auth, id)
    if user.suspended_at is not None:
        user.suspended_at = None
        db.commit()
        _log(db, ctx, auth, "user_unsuspend", user.id)
    return _done(f"/admin/users?id={user.id}", "Suspension lifted.")


# --- campuses (owners) ---------------------------------------------------------------


@router.get("/campuses", response_class=HTMLResponse)
def campuses(
    ok: str | None = None,
    error: str | None = None,
    auth: Auth = Depends(require),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> HTMLResponse:
    _owner_only(auth)
    tz = ctx.settings.tz
    sections = []
    for status, title in (
        ("open", "Open"),
        ("pending", "Students tried to join"),
        ("rejected", "Declined"),
    ):
        rows = []
        order = Campus.attempts.desc() if status == "pending" else Campus.key
        for c in db.scalars(select(Campus).where(Campus.status == status).order_by(order)):
            if status == "open":
                partner = (
                    f'<span class="chip ok">partner since {when(c.partner_verified_at, tz)}</span>'
                    if c.partner_verified_at
                    else '<span class="chip">student demand</span>'
                )
                controls = f"""
<form method="post" action="/admin/campuses/domains" class="row" style="margin-top:6px">
{_hidden(auth)}<input type="hidden" name="key" value="{e(c.key)}">
<input type="text" name="domains" value="{e(", ".join(c.domains))}" style="flex:1;min-width:200px"
 aria-label="Domains for {e(c.key)}">
<button type="submit" class="ghost">Save domains</button></form>"""
                rows.append(
                    f"<tr><td><b>{e(c.name)}</b> {partner}<br><span class=muted>{e(c.key)}</span>"
                    f"{controls}</td></tr>"
                )
            else:
                approve = f"""
<form method="post" action="/admin/campuses/approve" class="row">
{_hidden(auth)}<input type="hidden" name="key" value="{e(c.key)}">
<input type="text" name="name" placeholder="College name" required maxlength="120"
 value="{e(c.name or "")}" style="flex:1;min-width:180px" aria-label="Name for {e(c.key)}">
<button type="submit">Open</button></form>"""
                reject = (
                    _button_form(auth, "/admin/campuses/reject", {"key": c.key}, "Decline", "ghost")
                    if status == "pending"
                    else ""
                )
                rows.append(
                    f"<tr><td><b>{e(c.key)}</b> <span class=muted>· {c.attempts} sign-in attempts</span>"
                    f'<div class="row" style="margin-top:6px">{approve}{reject}</div></td></tr>'
                )
        body_rows = "".join(rows) or "<tr><td class=muted>None.</td></tr>"
        sections.append(
            f'<h2>{title}</h2><div class="card scroll"><table>{body_rows}</table></div>'
        )
    body = f"""
{_flashes(ok, error)}
<h1>Colleges</h1>
<p class="lede">A college opens only when an owner opens it here (SPEC §4.1). Check that the
domain really belongs to a college for adults before opening it — some schools use
academic suffixes too. Prefer opening through a verified
<a href="/admin/applications">application</a>.</p>
<form class="card" method="post" action="/admin/campuses/approve">
{_hidden(auth)}
<b>Open a college directly</b>
<div class="row" style="margin-top:8px">
<input type="text" name="key" placeholder="college.ac.in" required style="flex:1;min-width:160px"
 aria-label="Campus domain">
<input type="text" name="name" placeholder="College name" required style="flex:2;min-width:180px"
 aria-label="College name">
<button type="submit">Open</button></div></form>
{"".join(sections)}"""
    return page("Colleges", body, nav=_nav(auth, "/admin/campuses"), brand_href="/admin")


@router.post("/campuses/approve")
def campus_approve(
    key: str = Form(..., max_length=253),
    name: str = Form(..., max_length=120),
    csrf: str = Form(""),
    auth: Auth = Depends(require),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    _csrf(auth, csrf)
    _owner_only(auth)
    key, name = key.strip().lower(), name.strip()
    if not campus_service.DOMAIN_RE.match(key) or not name:
        raise _Redirect("/admin/campuses?error=Give+a+domain+like+college.ac.in+and+a+name.")
    for other in db.scalars(select(Campus).where(Campus.status == "open", Campus.key != key)):
        if key in other.domains:
            raise _Redirect(f"/admin/campuses?error={key}+is+already+part+of+{other.key}.")
    campus_service.approve(db, key, name, ctx.ids, ctx.clock)
    _log(db, ctx, auth, "campus_open", key)
    return _done("/admin/campuses", f"{name} is open.")


@router.post("/campuses/reject")
def campus_reject(
    key: str = Form(..., max_length=253),
    csrf: str = Form(""),
    auth: Auth = Depends(require),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    _csrf(auth, csrf)
    _owner_only(auth)
    row = db.scalar(select(Campus).where(Campus.key == key))
    if row is None or row.status != "pending":
        raise _Redirect("/admin/campuses?error=Only+a+pending+college+can+be+declined.")
    campus_service.reject(db, key)
    _log(db, ctx, auth, "campus_decline", key)
    return _done("/admin/campuses", f"{key} declined.")


@router.post("/campuses/domains")
def campus_domains(
    key: str = Form(..., max_length=253),
    domains: str = Form(..., max_length=2000),
    csrf: str = Form(""),
    auth: Auth = Depends(require),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    _csrf(auth, csrf)
    _owner_only(auth)
    row = db.scalar(select(Campus).where(Campus.key == key, Campus.status == "open"))
    if row is None:
        raise _Redirect("/admin/campuses?error=No+such+open+college.")
    try:
        campus_service.set_domains(db, row, domains.replace("\n", ",").split(","))
    except ValueError as exc:
        raise _Redirect(f"/admin/campuses?error={quote(str(exc))}") from exc
    _log(db, ctx, auth, "campus_domains", f"{key}: {', '.join(row.domains)}")
    return _done("/admin/campuses", f"Domains for {key} saved.")


# --- applications (owners) -----------------------------------------------------------


@router.get("/applications", response_class=HTMLResponse)
def applications(
    ok: str | None = None,
    error: str | None = None,
    auth: Auth = Depends(require),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> HTMLResponse:
    _owner_only(auth)
    tz = ctx.settings.tz
    chips = {"verified": "warn", "approved": "ok", "rejected": "danger", "unverified": ""}
    rows = (
        "".join(
            f'<tr><td><a href="/admin/applications/view?id={e(a.id)}">{e(a.college_name)}</a><br>'
            f"<span class=muted>{e(a.domain)}</span></td>"
            f"<td>{e(a.contact_name)}<br><span class=muted>{e(a.contact_role)}</span></td>"
            f'<td><span class="chip {chips.get(a.status, "")}">{e(a.status)}</span></td>'
            f"<td>{when(a.created_at, tz)}</td></tr>"
            for a in db.scalars(
                select(CollegeApplication).order_by(
                    (CollegeApplication.status == "verified").desc(),
                    CollegeApplication.created_at.desc(),
                )
            )
        )
        or "<tr><td colspan=4 class=muted>No applications yet. Share <a href=/colleges>/colleges</a> with college officials.</td></tr>"
    )
    body = f"""
{_flashes(ok, error)}
<h1>College applications</h1>
<p class="lede">Officials apply at <a href="/colleges">/colleges</a> and prove they hold an
address at the college's domain. Talk to them before opening — agree a safety contact and a
launch date.</p>
<div class="card scroll"><table><tr><th>College</th><th>Contact</th><th>Status</th><th>Received</th></tr>
{rows}</table></div>"""
    return page("Applications", body, nav=_nav(auth, "/admin/applications"), brand_href="/admin")


def _application(db: Session, app_id: str) -> CollegeApplication:
    row = db.get(CollegeApplication, app_id)
    if row is None:
        raise _Redirect("/admin/applications?error=No+such+application.")
    return row


@router.get("/applications/view", response_class=HTMLResponse)
def application_view(
    id: str = Query(..., max_length=36),
    ok: str | None = None,
    error: str | None = None,
    auth: Auth = Depends(require),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> HTMLResponse:
    _owner_only(auth)
    a = _application(db, id)
    tz = ctx.settings.tz
    key = campus_service.key_for_domain(a.domain, ctx.settings.auth.academic_suffixes)
    attempts = db.scalar(select(Campus.attempts).where(Campus.key == key)) or 0
    actions = ""
    if a.status == "verified":
        actions = f"""
<form method="post" action="/admin/applications/approve" class="row">
{_hidden(auth)}<input type="hidden" name="id" value="{e(a.id)}">
<input type="text" name="name" value="{e(a.college_name)}" required maxlength="120"
 style="flex:1;min-width:200px" aria-label="College name as students will see it">
<button type="submit">Open {e(key)} as a partner</button></form>
<div style="margin-top:8px">{_button_form(auth, "/admin/applications/reject", {"id": a.id}, "Decline", "ghost")}</div>"""
    elif a.status == "unverified":
        actions = '<p class="muted">The contact has not entered their code yet.</p>' + _button_form(
            auth, "/admin/applications/reject", {"id": a.id}, "Discard", "ghost"
        )
    body = f"""
{_flashes(ok, error)}
<p><a href="/admin/applications">← Applications</a></p>
<h1>{e(a.college_name)}</h1>
<div class="card">
<p><b>Status:</b> {e(a.status)}{f" by {e(a.decided_by)} on {when(a.decided_at, tz)}" if a.decided_at else ""}</p>
<p><b>Domain:</b> {e(a.domain)} → campus key <code>{e(key)}</code> ·
<b>Students who already tried to sign in:</b> {attempts}</p>
<p><b>Contact:</b> {e(a.contact_name)}, {e(a.contact_role)}<br>
<a href="mailto:{e(a.contact_email)}">{e(a.contact_email)}</a>
{f"(verified {when(a.verified_at, tz)})" if a.verified_at else "(not verified)"}</p>
<p><b>Note:</b><br>{e(a.note) or '<span class="muted">—</span>'}</p>
{actions}
</div>"""
    return page("Application", body, nav=_nav(auth, "/admin/applications"), brand_href="/admin")


@router.post("/applications/approve")
def application_approve(
    id: str = Form(..., max_length=36),
    name: str = Form("", max_length=120),
    csrf: str = Form(""),
    auth: Auth = Depends(require),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    _csrf(auth, csrf)
    _owner_only(auth)
    a = _application(db, id)
    try:
        campus = colleges_service.approve(
            db, ctx.settings, ctx.ids, ctx.clock, a, auth.operator.username, name or None
        )
    except colleges_service.ApplicationError as exc:
        raise _Redirect(f"/admin/applications/view?id={a.id}&error={quote(str(exc))}") from exc
    _log(db, ctx, auth, "application_approve", f"{a.id} → {campus.key}")
    return _done(f"/admin/applications/view?id={a.id}", f"{campus.name} is open.")


@router.post("/applications/reject")
def application_reject(
    id: str = Form(..., max_length=36),
    csrf: str = Form(""),
    auth: Auth = Depends(require),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    _csrf(auth, csrf)
    _owner_only(auth)
    a = _application(db, id)
    try:
        colleges_service.reject(db, ctx.clock, a, auth.operator.username)
    except colleges_service.ApplicationError as exc:
        raise _Redirect(f"/admin/applications/view?id={a.id}&error={quote(str(exc))}") from exc
    _log(db, ctx, auth, "application_decline", a.id)
    return _done(f"/admin/applications/view?id={a.id}", "Application declined.")


# --- operators (owners) --------------------------------------------------------------


@router.get("/operators", response_class=HTMLResponse)
def operators(
    ok: str | None = None,
    error: str | None = None,
    auth: Auth = Depends(require),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> HTMLResponse:
    _owner_only(auth)
    tz = ctx.settings.tz
    campus_names = {c.id: c for c in db.scalars(select(Campus))}
    rows = []
    for op in db.scalars(select(Operator).order_by(Operator.username)):
        scope = "owner" if op.campus_id is None else f"moderator · {campus_names[op.campus_id].key}"
        if op.disabled_at:
            state = '<span class="chip danger">disabled</span>'
            act = ""
        elif op.id == auth.operator.id:
            state, act = '<span class="chip ok">you</span>', ""
        else:
            state = '<span class="chip ok">active</span>'
            act = _button_form(auth, "/admin/operators/disable", {"id": op.id}, "Disable", "ghost")
        rows.append(
            f"<tr><td><b>{e(op.username)}</b> {state}</td><td>{e(scope)}</td>"
            f"<td>{when(op.created_at, tz)}</td><td>{act}</td></tr>"
        )
    options = "".join(
        f'<option value="{e(c.key)}">Moderator — {e(c.name)} ({e(c.key)})</option>'
        for c in campus_names.values()
        if c.status == "open"
    )
    body = f"""
{_flashes(ok, error)}
<h1>Operators</h1>
<p class="lede">Owners see every campus. A campus moderator — for example a partner college's
safety officer — sees only that college's reports and users. Operators never hold a
participant account on the same deployment (SPEC §19).</p>
<div class="card scroll"><table><tr><th>Username</th><th>Scope</th><th>Added</th><th></th></tr>
{"".join(rows)}</table></div>
<h2>Add an operator</h2>
<form class="card" method="post" action="/admin/operators/add">
{_hidden(auth)}
<label for="username">Username</label>
<input type="text" id="username" name="username" required maxlength="40" autocomplete="off">
<label for="password">Temporary password</label>
<input type="password" id="password" name="password" required autocomplete="new-password">
<p class="hint">At least {ctx.settings.admin.password_min_length} characters. Give it to them in
person; they can change it under Account.</p>
<label for="scope">Scope</label>
<select id="scope" name="scope"><option value="">Owner — every campus</option>{options}</select>
<p style="margin-top:16px"><button type="submit">Add operator</button></p>
</form>"""
    return page("Operators", body, nav=_nav(auth, "/admin/operators"), brand_href="/admin")


@router.post("/operators/add")
def operator_add(
    username: str = Form(..., max_length=40),
    password: str = Form(..., max_length=200),
    scope: str = Form("", max_length=253),
    csrf: str = Form(""),
    auth: Auth = Depends(require),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    _csrf(auth, csrf)
    _owner_only(auth)
    try:
        op = operators_service.create(
            db,
            ctx.settings,
            ctx.ids,
            ctx.clock,
            username=username,
            password=password,
            campus_key=scope or None,
        )
    except operators_service.OperatorError as exc:
        raise _Redirect(f"/admin/operators?error={quote(str(exc))}") from exc
    _log(db, ctx, auth, "operator_add", f"{op.username} ({scope or 'owner'})")
    return _done("/admin/operators", f"{op.username} added.")


@router.post("/operators/disable")
def operator_disable(
    id: str = Form(..., max_length=36),
    csrf: str = Form(""),
    auth: Auth = Depends(require),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    _csrf(auth, csrf)
    _owner_only(auth)
    op = db.get(Operator, id)
    if op is None or op.id == auth.operator.id:
        raise _Redirect("/admin/operators?error=You+can't+disable+that+operator.")
    op.disabled_at = ctx.clock.now()
    for s in db.scalars(select(OperatorSession).where(OperatorSession.operator_id == op.id)):
        db.delete(s)
    db.commit()
    _log(db, ctx, auth, "operator_disable", op.username)
    return _done("/admin/operators", f"{op.username} disabled.")


# --- audit log (owners) and own account ----------------------------------------------


@router.get("/audit", response_class=HTMLResponse)
def audit_log(
    auth: Auth = Depends(require),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> HTMLResponse:
    _owner_only(auth)
    tz = ctx.settings.tz
    rows = (
        "".join(
            f"<tr><td>{when(a.created_at, tz)}</td><td>{e(a.operator)}</td><td>{e(a.action)}</td>"
            f"<td><code>{e(a.target)}</code></td></tr>"
            for a in db.scalars(
                select(AdminAudit).order_by(AdminAudit.created_at.desc()).limit(300)
            )
        )
        or "<tr><td colspan=4 class=muted>Nothing yet.</td></tr>"
    )
    body = f"""
<h1>Audit log</h1>
<p class="lede">Every operator action, newest first (last 300). No IP addresses are recorded.</p>
<div class="card scroll"><table><tr><th>When</th><th>Operator</th><th>Action</th><th>Target</th></tr>
{rows}</table></div>"""
    return page("Audit log", body, nav=_nav(auth, "/admin/audit"), brand_href="/admin")


@router.get("/account", response_class=HTMLResponse)
def account(
    ok: str | None = None,
    error: str | None = None,
    auth: Auth = Depends(require),
    ctx: AppContext = Depends(get_ctx),
) -> HTMLResponse:
    body = f"""
{_flashes(ok, error)}
<h1>Account</h1>
<p class="lede">Signed in as <b>{e(auth.operator.username)}</b>.</p>
<form class="card" method="post" action="/admin/account/password">
{_hidden(auth)}
<label for="current">Current password</label>
<input type="password" id="current" name="current" required autocomplete="current-password">
<label for="new">New password</label>
<input type="password" id="new" name="new" required autocomplete="new-password">
<p class="hint">At least {ctx.settings.admin.password_min_length} characters.</p>
<p style="margin-top:16px"><button type="submit">Change password</button></p>
</form>
<form method="post" action="/admin/logout">{_hidden(auth)}<button type="submit" class="ghost">Sign out</button></form>"""
    return page("Account", body, nav=_nav(auth, "/admin/account"), brand_href="/admin", narrow=True)


@router.post("/account/password")
def change_password(
    current: str = Form(..., max_length=200),
    new: str = Form(..., max_length=200),
    csrf: str = Form(""),
    auth: Auth = Depends(require),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    _csrf(auth, csrf)
    op = db.get(Operator, auth.operator.id)
    assert op is not None
    if not security.check_password(current, op.password_hash):
        raise _Redirect("/admin/account?error=Your+current+password+is+wrong.")
    if len(new) < ctx.settings.admin.password_min_length:
        raise _Redirect("/admin/account?error=The+new+password+is+too+short.")
    op.password_hash = security.hash_password(new)
    for s in db.scalars(
        select(OperatorSession).where(
            OperatorSession.operator_id == op.id,
            OperatorSession.token_hash != auth.session.token_hash,
        )
    ):
        db.delete(s)
    db.commit()
    _log(db, ctx, auth, "password_change", op.username)
    return _done("/admin/account", "Password changed. Other sessions were signed out.")
