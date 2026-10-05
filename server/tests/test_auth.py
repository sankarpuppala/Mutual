import inspect

from conftest import EMAIL, Harness, auth, campus_status, login, signup

from mutual_server import security
from mutual_server.ids import UuidIds
from mutual_server.services import campus as campus_service


def _request(h: Harness, email: str = EMAIL) -> int:
    return h.client.post("/v1/auth/request-otp", json={"email": email}).status_code


def _verify(h: Harness, code: str, email: str = EMAIL):
    return h.client.post("/v1/auth/verify-otp", json={"email": email, "code": code})


def test_open_campus_login_flow(h: Harness) -> None:
    assert _request(h) == 204
    to, code = h.email.sent[-1]
    assert to == EMAIL and len(code) == 6 and code.isdigit()
    r = _verify(h, code)
    assert r.status_code == 200
    assert r.json()["account_exists"] is False
    assert r.json()["session_token"]


def test_subdomain_maps_to_its_campus(h: Harness) -> None:
    acct = signup(h, email="ravi@cse.example.ac.in")
    me = h.client.get("/v1/account/me", headers=auth(acct.token)).json()
    assert me["campus"]["key"] == "example.ac.in" and me["campus"]["name"] == "Example College"


def test_unknown_academic_domain_is_pending_until_approved(h: Harness) -> None:
    r = h.client.post("/v1/auth/request-otp", json={"email": "a@cse.iitb.ac.in"})
    assert r.status_code == 403 and r.json()["error"] == "campus_not_open"
    assert _request(h, "b@iitb.ac.in") == 403
    assert campus_status(h, "iitb.ac.in") == ("pending", 2)
    assert h.email.sent == []
    assert "iitb.ac.in" in h.dump() and "a@cse.iitb.ac.in" not in h.dump()

    with h.db() as db:
        campus_service.approve(db, "iitb.ac.in", "IIT Bombay", UuidIds(), h.clock)
    assert _request(h, "a@cse.iitb.ac.in") == 204


def test_rejected_or_non_college_domains(h: Harness) -> None:
    r = h.client.post("/v1/auth/request-otp", json={"email": "someone@gmail.com"})
    assert r.status_code == 400 and r.json()["error"] == "not_a_college_email"
    assert _request(h, "not-an-email") == 400
    assert _request(h, "x@school.ac.in") == 403
    with h.db() as db:
        campus_service.reject(db, "school.ac.in")
    assert _request(h, "x@school.ac.in") == 400


def test_resend_cooldown_is_silent(h: Harness) -> None:
    assert _request(h) == 204
    first = h.email.last_code()
    assert _request(h) == 204
    assert len(h.email.sent) == 1  # no new code inside the cooldown
    h.clock.advance(seconds=61)
    assert _request(h) == 204
    assert len(h.email.sent) == 2
    assert _verify(h, first).status_code == 400 or first == h.email.last_code()


def test_code_expires(h: Harness) -> None:
    _request(h)
    code = h.email.last_code()
    h.clock.advance(seconds=601)
    r = _verify(h, code)
    assert r.status_code == 400 and r.json()["error"] == "invalid_code"


def test_attempt_limit(h: Harness) -> None:
    _request(h)
    code = h.email.last_code()
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        assert _verify(h, wrong).status_code == 400
    r = _verify(h, code)
    assert r.status_code == 429 and r.json()["error"] == "too_many_attempts"
    assert _verify(h, code).status_code == 400  # the code is gone


def test_constant_time_compare_is_used() -> None:
    assert "compare_digest" in inspect.getsource(security.otp_matches)


def test_logout_and_session_expiry(h: Harness) -> None:
    acct = signup(h)
    assert h.client.get("/v1/account/me", headers=auth(acct.token)).status_code == 200
    assert h.client.post("/v1/auth/logout", headers=auth(acct.token)).status_code == 204
    assert h.client.get("/v1/account/me", headers=auth(acct.token)).status_code == 401
    token = login(h)
    h.clock.advance(days=31)
    assert h.client.get("/v1/account/me", headers=auth(token)).status_code == 401


def test_returning_user_gets_account_exists(h: Harness) -> None:
    signup(h)
    _request(h)
    assert _verify(h, h.email.last_code()).json()["account_exists"] is True


def test_suspended_user_cannot_sign_in(h: Harness) -> None:
    from mutual_server.models import User

    acct = signup(h)
    with h.db() as db:
        db.get(User, acct.user_id).suspended_at = h.clock.now()
        db.commit()
    h.clock.advance(seconds=61)
    _request(h)
    r = _verify(h, h.email.last_code())
    assert r.status_code == 403 and r.json()["error"] == "account_suspended"


def test_no_plaintext_email_code_or_token_is_stored(h: Harness) -> None:
    acct = signup(h)
    _request(h, "second@example.ac.in")
    pending_code = h.email.last_code()
    dump = h.dump()
    assert EMAIL not in dump and "second@example.ac.in" not in dump
    assert acct.token not in dump
    assert f"'{pending_code}'" not in dump
