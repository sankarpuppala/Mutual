"""POST /v1/feedback and its page in the operator console (SPEC.md §11.4)."""

from __future__ import annotations

import pytest
from conftest import Harness, auth, signup
from sqlalchemy import select
from test_admin_web import PASSWORD, add_operator, sign_in

from mutual_server.models import Feedback, Operator
from mutual_server.services.operators import ensure_bootstrap_owner


def send(
    h: Harness, token: str, body: str = "The morning letter is lovely.", category: str = "idea"
):
    return h.client.post(
        "/v1/feedback", json={"category": category, "body": body}, headers=auth(token)
    )


def test_needs_an_account(h: Harness) -> None:
    assert h.client.post("/v1/feedback", json={"category": "idea", "body": "x"}).status_code == 401


def test_feedback_is_stored_with_campus(h: Harness) -> None:
    a = signup(h)
    assert send(h, a.token).status_code == 204
    with h.db() as db:
        row = db.scalar(select(Feedback))
        assert row.user_id == a.user_id and row.status == "new" and row.category == "idea"


def test_validation(h: Harness) -> None:
    a = signup(h)
    assert send(h, a.token, category="intent").status_code == 422
    assert send(h, a.token, body="   ").status_code == 422
    assert send(h, a.token, body="x" * (h.settings.feedback.max_length + 1)).status_code == 413


def test_daily_limit(make_harness) -> None:
    h = make_harness(feedback={"per_user_per_day": 2})
    a = signup(h)
    assert [send(h, a.token).status_code for _ in range(3)] == [204, 204, 429]
    h.clock.advance(days=1, seconds=1)
    assert send(h, a.token).status_code == 204


def test_kept_after_account_deletion_without_the_author(h: Harness) -> None:
    a = signup(h)
    send(h, a.token)
    assert h.client.delete("/v1/account", headers=auth(a.token)).status_code == 202
    with h.db() as db:
        row = db.scalar(select(Feedback))
        assert row is not None and row.user_id is None


def test_console_lists_and_marks_read(h: Harness) -> None:
    a = signup(h)
    send(h, a.token, body="<i>bug</i> on the signals tab", category="problem")
    add_operator(h)
    csrf = sign_in(h)
    page = h.client.get("/admin/feedback").text
    assert "&lt;i&gt;bug&lt;/i&gt;" in page and "<i>bug</i>" not in page
    with h.db() as db:
        fid = db.scalar(select(Feedback.id))
    h.client.post("/admin/feedback/read", data={"id": fid, "csrf": csrf})
    with h.db() as db:
        row = db.get(Feedback, fid)
        assert row.status == "read" and row.read_by == "owner"


def test_moderator_sees_only_their_campus(h: Harness) -> None:
    mine = signup(h, email="a@example.ac.in")
    theirs = signup(h, email="b@other.edu.in")
    send(h, mine.token, body="from example")
    send(h, theirs.token, body="from other")
    add_operator(h, "safety", campus_key="example.ac.in")
    sign_in(h, "safety")
    page = h.client.get("/admin/feedback").text
    assert "from example" in page and "from other" not in page


def test_bootstrap_owner_from_environment(h: Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    ctx = h.client.app.state.ctx
    monkeypatch.setenv("MUTUAL_ADMIN_USERNAME", "Central")
    monkeypatch.setenv("MUTUAL_ADMIN_PASSWORD", PASSWORD)
    with h.db() as db:
        ensure_bootstrap_owner(db, h.settings, ctx.ids, h.clock)
        op = db.scalar(select(Operator).where(Operator.username == "central"))
        assert op is not None and op.campus_id is None
        stored = op.password_hash
    sign_in(h, "central")

    # A later start never overwrites a password changed in the console.
    monkeypatch.setenv("MUTUAL_ADMIN_PASSWORD", "a different long password")
    with h.db() as db:
        ensure_bootstrap_owner(db, h.settings, ctx.ids, h.clock)
        assert db.scalar(select(Operator.password_hash)) == stored


def test_bootstrap_does_nothing_without_both_variables(
    h: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MUTUAL_ADMIN_USERNAME", "central")
    monkeypatch.delenv("MUTUAL_ADMIN_PASSWORD", raising=False)
    with h.db() as db:
        ensure_bootstrap_owner(db, h.settings, h.client.app.state.ctx.ids, h.clock)
        assert db.scalar(select(Operator)) is None
