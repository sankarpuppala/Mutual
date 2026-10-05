"""GET/POST /matches/{id}/messages (SPEC.md §11, S3)."""

from urllib.parse import quote

from conftest import Harness, auth, make_match, signup

DAY = "2026-10-05"


def _match(h: Harness):
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    return a, b, make_match(h, a, b, DAY, ["date"])


def test_send_and_read_messages(h: Harness) -> None:
    a, b, match_id = _match(h)
    r = h.client.post(
        f"/v1/matches/{match_id}/messages", json={"body": "hello there"}, headers=auth(a.token)
    )
    assert r.status_code == 201
    body = r.json()
    assert set(body) == {"message_id", "sender_id", "body", "created_at"}
    assert body["sender_id"] == a.user_id and body["body"] == "hello there"

    got = h.client.get(f"/v1/matches/{match_id}/messages", headers=auth(b.token)).json()
    assert len(got) == 1 and got[0]["body"] == "hello there"


def test_empty_or_too_long_message_rejected(h: Harness) -> None:
    a, _b, match_id = _match(h)
    assert (
        h.client.post(
            f"/v1/matches/{match_id}/messages", json={"body": "   "}, headers=auth(a.token)
        ).status_code
        == 422
    )
    too_long = "x" * 1001
    assert (
        h.client.post(
            f"/v1/matches/{match_id}/messages", json={"body": too_long}, headers=auth(a.token)
        ).status_code
        == 422
    )
    assert (
        h.client.post(
            f"/v1/matches/{match_id}/messages", json={"body": "x" * 1000}, headers=auth(a.token)
        ).status_code
        == 201
    )


def test_rate_limit(make_harness) -> None:
    h: Harness = make_harness(messages={"rate_limit_per_minute": 3})
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    match_id = make_match(h, a, b, DAY, ["date"])
    for _ in range(3):
        assert (
            h.client.post(
                f"/v1/matches/{match_id}/messages", json={"body": "hi"}, headers=auth(a.token)
            ).status_code
            == 201
        )
    r = h.client.post(
        f"/v1/matches/{match_id}/messages", json={"body": "hi"}, headers=auth(a.token)
    )
    assert r.status_code == 429
    h.clock.advance(minutes=1, seconds=1)
    assert (
        h.client.post(
            f"/v1/matches/{match_id}/messages", json={"body": "hi"}, headers=auth(a.token)
        ).status_code
        == 201
    )


def test_after_cursor_filters_messages(h: Harness) -> None:
    a, b, match_id = _match(h)
    h.client.post(f"/v1/matches/{match_id}/messages", json={"body": "first"}, headers=auth(a.token))
    mid_time = h.clock.now().isoformat()
    h.clock.advance(seconds=1)
    h.client.post(
        f"/v1/matches/{match_id}/messages", json={"body": "second"}, headers=auth(b.token)
    )

    all_msgs = h.client.get(f"/v1/matches/{match_id}/messages", headers=auth(a.token)).json()
    assert [m["body"] for m in all_msgs] == ["first", "second"]
    later = h.client.get(
        f"/v1/matches/{match_id}/messages?after={quote(mid_time)}", headers=auth(a.token)
    ).json()
    assert [m["body"] for m in later] == ["second"]


def test_unread_flag(h: Harness) -> None:
    a, b, match_id = _match(h)
    assert h.client.get("/v1/matches", headers=auth(a.token)).json()[0]["unread"] is False

    h.client.post(f"/v1/matches/{match_id}/messages", json={"body": "hi"}, headers=auth(b.token))
    assert h.client.get("/v1/matches", headers=auth(a.token)).json()[0]["unread"] is True
    assert (
        h.client.get("/v1/matches", headers=auth(b.token)).json()[0]["unread"] is False
    )  # own message

    h.client.get(f"/v1/matches/{match_id}/messages", headers=auth(a.token))  # marks read
    assert h.client.get("/v1/matches", headers=auth(a.token)).json()[0]["unread"] is False


def test_messages_unreachable_without_a_qualifying_match(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    stranger = signup(h, email="s@example.ac.in")
    r = h.client.get("/v1/matches/not-a-real-id/messages", headers=auth(a.token))
    assert r.status_code == 404
    r2 = h.client.post(
        "/v1/matches/not-a-real-id/messages", json={"body": "hi"}, headers=auth(stranger.token)
    )
    assert r2.status_code == 404
