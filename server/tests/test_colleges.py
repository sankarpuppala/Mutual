"""Official college applications at /colleges (SPEC.md §4.2).

A college opens only when an operator approves it (D24). An application proves that its
contact holds an address at the college's own domain, and is deleted on a schedule.
"""

from __future__ import annotations

import re

from conftest import Harness, signup
from sqlalchemy import select
from test_admin_web import add_operator, sign_in

from mutual_server.models import Campus, CollegeApplication
from mutual_server.services.retention import run_retention

FORM = {
    "college_name": "Christ University",
    "domain": "christuniversity.in",
    "contact_name": "Dr Rao",
    "contact_role": "Dean of Students",
    "contact_email": "dean@christuniversity.in",
    "note": "Our student council asked for this.",
}


def apply(h: Harness, **changes: str) -> str:
    """Submit the form; return the application id from the redirect."""
    r = h.client.post("/colleges/apply", data={**FORM, **changes}, follow_redirects=False)
    assert r.status_code == 303, r.text
    match = re.search(r"application=([0-9a-f-]{36})", r.headers["location"])
    assert match
    return match.group(1)


def test_page_renders_without_scripts(h: Harness) -> None:
    r = h.client.get("/colleges")
    assert r.status_code == 200 and "Bring Mutual to your college" in r.text
    assert "<script" not in r.text
    assert h.client.get("/", follow_redirects=False).headers["location"] == "/colleges"


def test_contact_must_be_at_the_college_domain(h: Harness) -> None:
    r = h.client.post("/colleges/apply", data={**FORM, "contact_email": "dean@gmail.com"})
    assert r.status_code == 400 and "official address" in r.text
    with h.db() as db:
        assert db.scalar(select(CollegeApplication)) is None
    assert h.email.sent == []


def test_already_open_college_is_refused(h: Harness) -> None:
    r = h.client.post(
        "/colleges/apply",
        data={**FORM, "domain": "example.ac.in", "contact_email": "dean@example.ac.in"},
    )
    assert r.status_code == 400 and "already open" in r.text


def test_form_values_are_escaped_on_error(h: Harness) -> None:
    r = h.client.post(
        "/colleges/apply", data={**FORM, "college_name": '"><script>x</script>', "domain": "bad"}
    )
    assert r.status_code == 400
    assert "<script>x" not in r.text and "&lt;script&gt;" in r.text


def test_full_flow_opens_a_partner_campus(h: Harness) -> None:
    # Before: not a college email at all (no academic suffix, not configured).
    r = h.client.post("/v1/auth/request-otp", json={"email": "s@christuniversity.in"})
    assert r.status_code == 400

    app_id = apply(h)
    to, code = h.email.sent[-1]
    assert to == "dean@christuniversity.in"

    wrong = h.client.post("/colleges/verify", data={"application": app_id, "code": "000000"})
    assert wrong.status_code == 400 or code == "000000"
    ok = h.client.post("/colleges/verify", data={"application": app_id, "code": code})
    assert ok.status_code == 200 and "verified" in ok.text
    with h.db() as db:
        row = db.get(CollegeApplication, app_id)
        assert row.status == "verified" and row.code_hash is None

    # Still closed until an operator approves.
    assert (
        h.client.post("/v1/auth/request-otp", json={"email": "s@christuniversity.in"}).status_code
        == 400
    )

    add_operator(h)
    csrf = sign_in(h)
    assert "Christ University" in h.client.get("/admin/applications").text
    h.client.post(
        "/admin/applications/approve",
        data={"id": app_id, "name": "Christ University", "csrf": csrf},
    )
    with h.db() as db:
        campus = db.scalar(select(Campus).where(Campus.key == "christuniversity.in"))
        assert campus.status == "open" and campus.partner_verified_at is not None
        assert db.get(CollegeApplication, app_id).decided_by == "owner"

    assert (
        h.client.post("/v1/auth/request-otp", json={"email": "s@christuniversity.in"}).status_code
        == 204
    )
    signup(h, email="s2@christuniversity.in")


def test_academic_subdomain_maps_to_its_campus_key(h: Harness) -> None:
    app_id = apply(
        h,
        college_name="IIT Bombay",
        domain="iitb.ac.in",
        contact_email="dean@admin.iitb.ac.in",
    )
    code = h.email.sent[-1][1]
    h.client.post("/colleges/verify", data={"application": app_id, "code": code})
    add_operator(h)
    csrf = sign_in(h)
    h.client.post("/admin/applications/approve", data={"id": app_id, "csrf": csrf})
    assert (
        h.client.post("/v1/auth/request-otp", json={"email": "s@cse.iitb.ac.in"}).status_code == 204
    )


def test_verification_attempts_are_capped(make_harness) -> None:
    h = make_harness(colleges={"code_max_attempts": 2})
    app_id = apply(h)
    code = h.email.sent[-1][1]
    bad = "111111" if code != "111111" else "222222"
    for _ in range(2):
        h.client.post("/colleges/verify", data={"application": app_id, "code": bad})
    r = h.client.post("/colleges/verify", data={"application": app_id, "code": code})
    assert r.status_code == 400 and "Too many tries" in r.text


def test_expired_code_is_refused(h: Harness) -> None:
    app_id = apply(h)
    code = h.email.sent[-1][1]
    h.clock.advance(seconds=h.settings.colleges.code_ttl_seconds + 1)
    r = h.client.post("/colleges/verify", data={"application": app_id, "code": code})
    assert r.status_code == 400 and "expired" in r.text


def test_apply_is_rate_limited(make_harness) -> None:
    h = make_harness(colleges={"apply_ip_limit_per_hour": 1})
    apply(h)
    r = h.client.post("/colleges/apply", data=FORM)
    assert r.status_code == 429


def test_unverified_applications_and_their_contacts_expire(h: Harness) -> None:
    apply(h)
    h.clock.advance(hours=h.settings.colleges.unverified_retention_hours + 1)
    with h.db() as db:
        run_retention(db, h.clock, h.settings)
        assert db.scalar(select(CollegeApplication)) is None
    assert "dean@christuniversity.in" not in h.dump()


def _decided(h: Harness) -> str:
    app_id = apply(h)
    h.client.post("/colleges/verify", data={"application": app_id, "code": h.email.sent[-1][1]})
    add_operator(h)
    csrf = sign_in(h)
    h.client.post("/admin/applications/reject", data={"id": app_id, "csrf": csrf})
    return app_id


def test_decided_applications_are_kept_by_default(h: Harness) -> None:
    """DECISIONS_LOG 35: the human chose to keep decided applications (records of who
    asked for which college) for the deployment's lifetime."""
    app_id = _decided(h)
    h.clock.advance(days=3650)
    with h.db() as db:
        run_retention(db, h.clock, h.settings)
        assert db.get(CollegeApplication, app_id) is not None


def test_decided_applications_expire_when_configured(make_harness) -> None:
    h = make_harness(colleges={"decided_retention_days": 30})
    _decided(h)
    h.clock.advance(days=31)
    with h.db() as db:
        run_retention(db, h.clock, h.settings)
        assert db.scalar(select(CollegeApplication)) is None


def test_a_failed_send_leaves_nothing_behind(h: Harness) -> None:
    def broken(to: str, code: str) -> None:
        raise ConnectionRefusedError("smtp down")

    h.email.send_college_code = broken  # type: ignore[method-assign]
    r = h.client.post("/colleges/apply", data=FORM)
    assert r.status_code == 503 and "couldn" in r.text
    with h.db() as db:
        assert db.scalar(select(CollegeApplication)) is None
