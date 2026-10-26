"""The operator console at /admin (SPEC.md §11.3).

Synthetic operators and accounts only. Checks the security properties the console relies
on -- sign-in, the CSRF token, cookie flags, campus-scoped moderators, the audit log -- and
that it stores no client address (invariant 5).
"""

from __future__ import annotations

import re

import pytest
from conftest import Harness, auth, make_match, signup
from sqlalchemy import select

from mutual_server import security
from mutual_server.models import AdminAudit, Campus, Operator, Report, User
from mutual_server.services import operators as operators_service

DAY = "2026-10-05"
PASSWORD = "correct horse battery"


def add_operator(h: Harness, username: str = "owner", campus_key: str | None = None) -> None:
    ctx = h.client.app.state.ctx
    with h.db() as db:
        operators_service.create(
            db,
            h.settings,
            ctx.ids,
            h.clock,
            username=username,
            password=PASSWORD,
            campus_key=campus_key,
        )


def sign_in(h: Harness, username: str = "owner", password: str = PASSWORD) -> str:
    """Sign in and return the CSRF token from the account page."""
    h.client.cookies.clear()
    r = h.client.post(
        "/admin/login", data={"username": username, "password": password}, follow_redirects=False
    )
    assert r.status_code == 303, r.text
    page = h.client.get("/admin/account").text
    match = re.search(r'name="csrf" value="([0-9a-f]{64})"', page)
    assert match
    return match.group(1)


def test_password_hash_round_trip() -> None:
    stored = security.hash_password("a long passphrase")
    assert stored.startswith("scrypt$") and "a long passphrase" not in stored
    assert security.check_password("a long passphrase", stored)
    assert not security.check_password("a long passphrasE", stored)
    assert not security.check_password("x", "not-a-hash")


def test_console_requires_sign_in(h: Harness) -> None:
    for path in ("/admin", "/admin/reports", "/admin/campuses", "/admin/users?id=x"):
        r = h.client.get(path, follow_redirects=False)
        assert r.status_code == 303 and r.headers["location"] == "/admin/login"
    # A participant's bearer token is not an operator credential.
    a = signup(h)
    r = h.client.get("/admin", headers=auth(a.token), follow_redirects=False)
    assert r.status_code == 303


def test_wrong_password_and_unknown_user_look_the_same(h: Harness) -> None:
    add_operator(h)
    bad = h.client.post("/admin/login", data={"username": "owner", "password": "nope"})
    unknown = h.client.post("/admin/login", data={"username": "ghost", "password": "nope"})
    assert bad.status_code == unknown.status_code == 401
    assert "don&#x27;t match" in bad.text and "don&#x27;t match" in unknown.text


def test_session_cookie_flags(h: Harness) -> None:
    add_operator(h)
    r = h.client.post(
        "/admin/login", data={"username": "owner", "password": PASSWORD}, follow_redirects=False
    )
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie and "path=/admin" in cookie
    assert r.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]


def test_secure_cookie_in_prod(make_harness, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MUTUAL_EMAIL_PEPPER", "test-pepper")
    h = make_harness(env="prod", email={"mode": "smtp"})
    add_operator(h)
    r = h.client.post(
        "/admin/login", data={"username": "owner", "password": PASSWORD}, follow_redirects=False
    )
    assert "secure" in r.headers["set-cookie"].lower()


def test_disabled_operator_cannot_sign_in(h: Harness) -> None:
    add_operator(h)
    with h.db() as db:
        db.scalar(select(Operator)).disabled_at = h.clock.now()
        db.commit()
    r = h.client.post("/admin/login", data={"username": "owner", "password": PASSWORD})
    assert r.status_code == 401


def test_sign_in_is_rate_limited(make_harness) -> None:
    h = make_harness(admin={"login_ip_limit_per_hour": 2})
    for _ in range(2):
        assert (
            h.client.post("/admin/login", data={"username": "x", "password": "y"}).status_code
            == 401
        )
    assert h.client.post("/admin/login", data={"username": "x", "password": "y"}).status_code == 429


def test_overview_shows_counts_only(h: Harness) -> None:
    signup(h, email="a@example.ac.in")
    signup(h, email="b@other.edu.in")
    add_operator(h)
    sign_in(h)
    page = h.client.get("/admin").text
    assert "Example College" in page and "Other College" in page
    assert "a@example.ac.in" not in page


def test_suspend_needs_csrf_and_is_audited(h: Harness) -> None:
    a = signup(h)
    add_operator(h)
    csrf = sign_in(h)

    r = h.client.post("/admin/users/suspend", data={"id": a.user_id}, follow_redirects=False)
    assert r.status_code == 303 and "error=" in r.headers["location"]
    with h.db() as db:
        assert db.get(User, a.user_id).suspended_at is None

    r = h.client.post(
        "/admin/users/suspend", data={"id": a.user_id, "csrf": csrf}, follow_redirects=False
    )
    assert r.status_code == 303 and "ok=" in r.headers["location"]
    assert h.client.get("/v1/account/me", headers=auth(a.token)).status_code == 403
    with h.db() as db:
        assert db.get(User, a.user_id).suspended_at is not None
        actions = [x.action for x in db.scalars(select(AdminAudit))]
    assert "user_suspend" in actions

    h.client.post("/admin/users/unsuspend", data={"id": a.user_id, "csrf": csrf})
    with h.db() as db:
        assert db.get(User, a.user_id).suspended_at is None


def test_reports_view_and_resolve(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in", name="Bilal")
    match_id = make_match(h, a, b, DAY, ["date"])
    m = h.client.post(
        f"/v1/matches/{match_id}/messages", json={"body": "<b>unkind</b>"}, headers=auth(b.token)
    ).json()
    h.client.post(
        "/v1/reports",
        json={"peer_id": b.user_id, "reason": "harassment", "message_ids": [m["message_id"]]},
        headers=auth(a.token),
    )
    add_operator(h)
    csrf = sign_in(h)
    with h.db() as db:
        report_id = db.scalar(select(Report.id))
    assert "harassment" in h.client.get("/admin/reports").text
    page = h.client.get(f"/admin/reports/view?id={report_id}").text
    assert "&lt;b&gt;unkind&lt;/b&gt;" in page and "<b>unkind</b>" not in page
    h.client.post("/admin/reports/resolve", data={"id": report_id, "csrf": csrf})
    with h.db() as db:
        assert db.get(Report, report_id).status == "resolved"


def test_campus_moderator_is_confined_to_their_campus(h: Harness) -> None:
    mine = signup(h, email="a@example.ac.in")
    theirs = signup(h, email="b@other.edu.in")
    add_operator(h, "safety", campus_key="example.ac.in")
    csrf = sign_in(h, "safety")

    assert "Other College" not in h.client.get("/admin").text
    assert "a@example" not in h.client.get(f"/admin/users?id={mine.user_id}").text
    r = h.client.get(f"/admin/users?id={theirs.user_id}", follow_redirects=False)
    assert r.status_code == 303 and "error=" in r.headers["location"]
    h.client.post("/admin/users/suspend", data={"id": theirs.user_id, "csrf": csrf})
    with h.db() as db:
        assert db.get(User, theirs.user_id).suspended_at is None

    for path in ("/admin/campuses", "/admin/applications", "/admin/operators", "/admin/audit"):
        r = h.client.get(path, follow_redirects=False)
        assert r.status_code == 303 and "error=" in r.headers["location"]


def test_owner_opens_and_declines_colleges(h: Harness) -> None:
    assert (
        h.client.post("/v1/auth/request-otp", json={"email": "s@x.iitb.ac.in"}).status_code == 403
    )
    add_operator(h)
    csrf = sign_in(h)
    assert "iitb.ac.in" in h.client.get("/admin/campuses").text
    h.client.post(
        "/admin/campuses/approve", data={"key": "iitb.ac.in", "name": "IIT Bombay", "csrf": csrf}
    )
    assert (
        h.client.post("/v1/auth/request-otp", json={"email": "s@x.iitb.ac.in"}).status_code == 204
    )

    h.client.post("/v1/auth/request-otp", json={"email": "s@school.edu.in"})
    h.client.post("/admin/campuses/reject", data={"key": "school.edu.in", "csrf": csrf})
    with h.db() as db:
        assert db.scalar(select(Campus.status).where(Campus.key == "school.edu.in")) == "rejected"


def test_domains_cannot_be_claimed_by_two_campuses(h: Harness) -> None:
    add_operator(h)
    csrf = sign_in(h)
    r = h.client.post(
        "/admin/campuses/domains",
        data={"key": "example.ac.in", "domains": "example.ac.in, other.edu.in", "csrf": csrf},
        follow_redirects=False,
    )
    assert "error=" in r.headers["location"]
    with h.db() as db:
        assert db.scalar(select(Campus.domains).where(Campus.key == "example.ac.in")) == [
            "example.ac.in"
        ]


def test_owner_adds_and_disables_operators(h: Harness) -> None:
    add_operator(h)
    csrf = sign_in(h)
    h.client.post(
        "/admin/operators/add",
        data={
            "username": "mod",
            "password": "another long one",
            "scope": "example.ac.in",
            "csrf": csrf,
        },
    )
    with h.db() as db:
        mod = db.scalar(select(Operator).where(Operator.username == "mod"))
        assert mod is not None and mod.campus_id is not None
    h.client.post("/admin/operators/disable", data={"id": mod.id, "csrf": csrf})
    assert (
        h.client.post(
            "/admin/login", data={"username": "mod", "password": "another long one"}
        ).status_code
        == 401
    )


def test_short_passwords_rejected(h: Harness) -> None:
    ctx = h.client.app.state.ctx
    with h.db() as db, pytest.raises(operators_service.OperatorError):
        operators_service.create(
            db, h.settings, ctx.ids, h.clock, username="x1x", password="short", campus_key=None
        )


def test_console_stores_no_client_address(h: Harness) -> None:
    add_operator(h)
    sign_in(h)
    h.client.get("/admin")
    assert "testclient" not in h.dump()
