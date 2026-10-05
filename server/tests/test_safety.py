"""POST /blocks, /reports, /discovery/pause, /discovery/resume (SPEC.md §11, S4-S6)."""

from conftest import Harness, auth, make_match, make_shared_token, padded, signup

from mutual_server.clock import add_days, at_local
from mutual_server.models import Block, Crossing, Report

DAY = "2026-10-05"
YDAY = "2026-10-04"  # a past day, valid for POST /presence at the harness's default clock


def test_requires_auth(h: Harness) -> None:
    assert h.client.post("/v1/blocks", json={"peer_id": "x"}).status_code == 401


def test_block_unknown_id_is_a_silent_no_op(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    r = h.client.post(
        "/v1/blocks",
        json={"peer_id": "00000000-0000-4000-8000-000000000999"},
        headers=auth(a.token),
    )
    assert r.status_code == 204
    with h.db() as db:
        assert db.query(Block).count() == 0


def test_block_a_digest_peer_deletes_shared_crossings(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    shared = make_shared_token(YDAY)
    for acct in (a, b):
        r = h.client.post(
            f"/v1/presence/{YDAY}", json={"encounters": padded([shared])}, headers=auth(acct.token)
        )
        assert r.status_code == 201
    with h.db() as db:
        assert db.query(Crossing).count() == 1

    r = h.client.post("/v1/blocks", json={"peer_id": b.user_id}, headers=auth(a.token))
    assert r.status_code == 204
    with h.db() as db:
        assert db.query(Crossing).count() == 0
        row = db.get(Block, (a.user_id, b.user_id))
        assert row is not None


def test_blocking_is_idempotent(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    make_match(h, a, b, DAY, ["date"])
    for _ in range(3):
        assert (
            h.client.post(
                "/v1/blocks", json={"peer_id": b.user_id}, headers=auth(a.token)
            ).status_code
            == 204
        )
    with h.db() as db:
        assert db.query(Block).count() == 1


def test_block_after_a_match_ends_it_for_the_other_side_silently(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    match_id = make_match(h, a, b, DAY, ["date"])

    assert (
        h.client.post("/v1/blocks", json={"peer_id": b.user_id}, headers=auth(a.token)).status_code
        == 204
    )
    assert h.client.get("/v1/matches", headers=auth(a.token)).json() == []

    rb = h.client.get("/v1/matches", headers=auth(b.token)).json()
    assert len(rb) == 1 and rb[0]["match_id"] == match_id and rb[0]["state"] == "ended"
    # S4: the blocked person is never told it was a block (nothing distinguishes it from unmatch).


def test_block_before_notify_after_drops_the_pending_match_blindly(h: Harness) -> None:
    """A match row that only has pending (not yet notified) tokens is invisible via
    GET /matches, and (by the same Phase 4 "matched the viewer" exclusion rule) it also
    makes the peer disappear from any digest snapshot baked *after* the match forms.
    So this block has to reach the peer through a digest snapshot cached *before* the
    match existed — exactly how a real client would still know them, from the morning
    they first crossed, days before signalling."""
    from mutual_protocol.encoding import b64url_encode
    from mutual_protocol.keys import pair_key
    from mutual_protocol.tokens import interest_token, padded_set

    from mutual_server.services.matching import run_match_batch

    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")

    shared = make_shared_token(YDAY)
    for acct in (a, b):
        r = h.client.post(
            f"/v1/presence/{YDAY}", json={"encounters": padded([shared])}, headers=auth(acct.token)
        )
        assert r.status_code == 201

    # Release morning: bake and cache A's digest (includes B) before any match exists.
    h.clock.set(at_local(DAY, h.settings.digest.release_time, h.settings.tz))
    digest = h.client.get("/v1/digest", headers=auth(a.token)).json()
    assert {p["card"]["peer_id"] for p in digest["peers"]} == {b.user_id}

    k_ab = pair_key(a.sk, a.pk, a.user_id, b.pk, b.user_id)
    k_ba = pair_key(b.sk, b.pk, b.user_id, a.pk, a.user_id)
    h.clock.set(at_local(DAY, h.settings.signals.upload_window_start, h.settings.tz))
    for acct, k in ((a, k_ab), (b, k_ba)):
        tokens = [b64url_encode(t) for t in padded_set([interest_token(k, DAY, "date")])]
        assert (
            h.client.put(
                f"/v1/signals/{DAY}", json={"tokens": tokens}, headers=auth(acct.token)
            ).status_code
            == 201
        )
    h.clock.set(at_local(DAY, h.settings.signals.match_batch_time, h.settings.tz))
    with h.db() as db:
        run_match_batch(db, h.clock, h.settings, h.client.app.state.ctx.ids)

    from datetime import timedelta

    notify_after = at_local(add_days(DAY, 1), h.settings.digest.release_time, h.settings.tz)
    h.clock.set(notify_after - timedelta(seconds=1))  # strictly before notify_after
    assert (
        h.client.get("/v1/matches", headers=auth(a.token)).json() == []
    )  # still pending, invisible
    assert (
        h.client.post("/v1/blocks", json={"peer_id": b.user_id}, headers=auth(a.token)).status_code
        == 204
    )
    with h.db() as db:
        assert db.query(Block).filter_by(blocker_id=a.user_id, blocked_id=b.user_id).count() == 1

    from mutual_server.models import Match
    from mutual_server.services.matching import release_due_tokens

    h.clock.set(notify_after)
    with h.db() as db:
        release_due_tokens(db, h.clock)
        assert db.query(Match).count() == 0  # dropped blind — never existed for either side
    assert h.client.get("/v1/matches", headers=auth(a.token)).json() == []
    assert h.client.get("/v1/matches", headers=auth(b.token)).json() == []


def test_report_unknown_id_is_a_silent_no_op(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    r = h.client.post(
        "/v1/reports",
        json={"peer_id": "00000000-0000-4000-8000-000000000999", "reason": "harassment"},
        headers=auth(a.token),
    )
    assert r.status_code == 204
    with h.db() as db:
        assert db.query(Report).count() == 0


def test_report_copies_selected_messages_as_an_excerpt(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    match_id = make_match(h, a, b, DAY, ["date"])
    m1 = h.client.post(
        f"/v1/matches/{match_id}/messages", json={"body": "unkind thing"}, headers=auth(b.token)
    ).json()
    h.client.post(
        f"/v1/matches/{match_id}/messages", json={"body": "not selected"}, headers=auth(b.token)
    )

    r = h.client.post(
        "/v1/reports",
        json={"peer_id": b.user_id, "reason": "harassment", "message_ids": [m1["message_id"]]},
        headers=auth(a.token),
    )
    assert r.status_code == 204
    with h.db() as db:
        report = db.query(Report).one()
        assert report.reporter_id == a.user_id and report.reported_id == b.user_id
        assert report.reason == "harassment"
        assert len(report.excerpt) == 1 and report.excerpt[0]["body"] == "unkind thing"

    # The excerpt survives even after the match is unmatched and its messages deleted.
    h.client.delete(f"/v1/matches/{match_id}", headers=auth(a.token))
    with h.db() as db:
        report = db.query(Report).one()
        assert len(report.excerpt) == 1


def test_invalid_report_reason_rejected(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    make_match(h, a, b, DAY, ["date"])
    r = h.client.post(
        "/v1/reports",
        json={"peer_id": b.user_id, "reason": "not_a_real_reason"},
        headers=auth(a.token),
    )
    assert r.status_code == 422


def test_pause_and_resume_discovery(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    me = h.client.get("/v1/account/me", headers=auth(a.token)).json()
    assert me["discovery_paused"] is False
    assert h.client.post("/v1/discovery/pause", headers=auth(a.token)).status_code == 204
    assert h.client.get("/v1/account/me", headers=auth(a.token)).json()["discovery_paused"] is True
    assert h.client.post("/v1/discovery/resume", headers=auth(a.token)).status_code == 204
    assert h.client.get("/v1/account/me", headers=auth(a.token)).json()["discovery_paused"] is False
