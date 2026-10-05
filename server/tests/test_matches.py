from conftest import Harness, auth, make_match, signup

from mutual_server.clock import add_days, at_local

DAY = "2026-10-05"


def test_requires_auth(h: Harness) -> None:
    assert h.client.get("/v1/matches").status_code == 401


def test_a_mutual_match_is_shown_to_both_sides_after_notify_after(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    match_id = make_match(h, a, b, DAY, ["date"])

    ra = h.client.get("/v1/matches", headers=auth(a.token)).json()
    rb = h.client.get("/v1/matches", headers=auth(b.token)).json()
    assert len(ra) == 1 and ra[0]["match_id"] == match_id
    assert ra[0]["peer"]["peer_id"] == b.user_id
    assert rb[0]["peer"]["peer_id"] == a.user_id
    assert ra[0]["state"] == "active"
    assert ra[0]["created_epoch"] == DAY
    assert [t["epoch"] for t in ra[0]["matched"]] == [DAY]


def test_response_shape_has_no_intent_field(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    make_match(h, a, b, DAY, ["date"])
    r = h.client.get("/v1/matches", headers=auth(a.token)).json()[0]
    assert set(r) == {"match_id", "state", "peer", "matched", "created_epoch", "reveal", "unread"}
    assert set(r["reveal"]) == {"state", "policy", "messages_needed_each"}
    for token_entry in r["matched"]:
        assert set(token_entry) == {"epoch", "token"}


def test_policy_m_is_revealed_immediately(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    make_match(h, a, b, DAY, ["date"])
    r = h.client.get("/v1/matches", headers=auth(a.token)).json()[0]
    assert r["reveal"] == {"state": "revealed", "policy": "M", "messages_needed_each": None}


def test_policy_c_needs_messages_or_consent(make_harness) -> None:
    h: Harness = make_harness(
        reveal={"policy_schedule": [{"start": DAY, "end": DAY, "policy": "C"}]}
    )
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    match_id = make_match(h, a, b, DAY, ["date"])
    r = h.client.get("/v1/matches", headers=auth(a.token)).json()[0]
    assert r["reveal"] == {"state": "pending", "policy": "C", "messages_needed_each": 8}

    assert (
        h.client.get(f"/v1/matches/{match_id}/photos/0", headers=auth(a.token)).status_code == 404
    )
    assert (
        h.client.post(f"/v1/matches/{match_id}/reveal-consent", headers=auth(a.token)).status_code
        == 204
    )
    assert (
        h.client.get("/v1/matches", headers=auth(a.token)).json()[0]["reveal"]["state"] == "pending"
    )
    assert (
        h.client.post(f"/v1/matches/{match_id}/reveal-consent", headers=auth(b.token)).status_code
        == 204
    )
    assert (
        h.client.get("/v1/matches", headers=auth(a.token)).json()[0]["reveal"]["state"]
        == "revealed"
    )


def test_reveal_consent_only_applies_to_policy_c(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    match_id = make_match(h, a, b, DAY, ["date"])  # default policy M
    r = h.client.post(f"/v1/matches/{match_id}/reveal-consent", headers=auth(a.token))
    assert r.status_code == 400 and r.json()["error"] == "wrong_policy"


def test_second_shared_intent_is_appended_with_its_own_release(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    match_id = make_match(h, a, b, DAY, ["date"])
    next_day = add_days(DAY, 1)
    make_match(h, a, b, next_day, ["study"])  # same pair, a new epoch, a new shared intent
    r = h.client.get("/v1/matches", headers=auth(a.token)).json()
    assert len(r) == 1 and r[0]["match_id"] == match_id  # same match, not a second one
    epochs = sorted(t["epoch"] for t in r[0]["matched"])
    assert epochs == [DAY, next_day]


def test_appended_token_is_invisible_until_its_own_release(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    match_id = make_match(h, a, b, DAY, ["date"])
    next_day = add_days(DAY, 1)

    from mutual_protocol.encoding import b64url_encode
    from mutual_protocol.keys import pair_key
    from mutual_protocol.tokens import interest_token, padded_set

    k_ab = pair_key(a.sk, a.pk, a.user_id, b.pk, b.user_id)
    k_ba = pair_key(b.sk, b.pk, b.user_id, a.pk, a.user_id)
    h.clock.set(at_local(next_day, h.settings.signals.upload_window_start, h.settings.tz))
    for acct, k in ((a, k_ab), (b, k_ba)):
        tokens = [b64url_encode(t) for t in padded_set([interest_token(k, next_day, "study")])]
        assert (
            h.client.put(
                f"/v1/signals/{next_day}", json={"tokens": tokens}, headers=auth(acct.token)
            ).status_code
            == 201
        )

    from mutual_server.services.matching import run_match_batch

    h.clock.set(at_local(next_day, h.settings.signals.match_batch_time, h.settings.tz))
    with h.db() as db:
        run_match_batch(db, h.clock, h.settings, h.client.app.state.ctx.ids)

    # Batched, but not yet released: the match still shows only the first epoch.
    r = h.client.get("/v1/matches", headers=auth(a.token)).json()
    assert [t["epoch"] for t in r[0]["matched"]] == [DAY]
    assert r[0]["match_id"] == match_id


def test_unmatch_deletes_messages_and_shows_ended_to_the_other_side(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    match_id = make_match(h, a, b, DAY, ["date"])
    h.client.post(f"/v1/matches/{match_id}/messages", json={"body": "hi"}, headers=auth(a.token))

    assert h.client.delete(f"/v1/matches/{match_id}", headers=auth(a.token)).status_code == 204
    assert (
        h.client.get("/v1/matches", headers=auth(a.token)).json() == []
    )  # gone for the one who unmatched

    rb = h.client.get("/v1/matches", headers=auth(b.token)).json()
    assert len(rb) == 1 and rb[0]["state"] == "ended"
    assert rb[0]["peer"]["peer_id"] == a.user_id
    assert rb[0]["peer"]["prompts"] == []  # frozen minimal card: no prompts

    assert (
        h.client.get(f"/v1/matches/{match_id}/messages", headers=auth(b.token)).status_code == 404
    )
    assert (
        h.client.get(f"/v1/matches/{match_id}/messages", headers=auth(a.token)).status_code == 404
    )


def test_ended_match_is_delivered_once_then_gone(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    match_id = make_match(h, a, b, DAY, ["date"])
    h.client.delete(f"/v1/matches/{match_id}", headers=auth(a.token))
    first = h.client.get("/v1/matches", headers=auth(b.token)).json()
    assert len(first) == 1
    second = h.client.get("/v1/matches", headers=auth(b.token)).json()
    assert second == []


def test_unrelated_match_id_gives_uniform_404_on_every_sub_route(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    c = signup(h, email="c@example.ac.in")
    match_id = make_match(h, a, b, DAY, ["date"])

    for method, path in (
        ("get", f"/v1/matches/{match_id}/photos/0"),
        ("post", f"/v1/matches/{match_id}/reveal-consent"),
        ("get", f"/v1/matches/{match_id}/messages"),
        ("delete", f"/v1/matches/{match_id}"),
    ):
        r = getattr(h.client, method)(path, headers=auth(c.token))
        assert r.status_code == 404
    assert (
        h.client.get("/v1/matches/does-not-exist/messages", headers=auth(a.token)).status_code
        == 404
    )
