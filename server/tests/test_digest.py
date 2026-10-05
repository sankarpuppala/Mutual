import json
import secrets

from conftest import Harness, auth, signup

from mutual_server.clock import add_days, at_local
from mutual_server.models import Block, Crossing, Match, Media, User


def _cross(h: Harness, a_id: str, b_id: str, day: str, token: bytes | None = None) -> None:
    lo, hi = sorted((a_id, b_id))
    with h.db() as db:
        row = db.get(Crossing, (day, lo, hi))
        tok = token or secrets.token_bytes(32)
        if row is None:
            db.add(Crossing(day=day, user_lo=lo, user_hi=hi, token=tok, created_at=h.clock.now()))
        else:
            row.token = tok
        db.commit()


def _goto_release(h: Harness, day: str) -> None:
    h.clock.set(at_local(day, h.settings.digest.release_time, h.settings.tz))


def _epoch(h: Harness) -> str:
    return h.client.get("/v1/config").json()["epoch"]


def _peer_ids(r: dict) -> set[str]:
    return {p["card"]["peer_id"] for p in r["peers"]}


def test_digest_requires_auth(h: Harness) -> None:
    assert h.client.get("/v1/digest").status_code == 401


def test_digest_is_empty_before_any_release(h: Harness) -> None:
    a = signup(h)
    r = h.client.get("/v1/digest", headers=auth(a.token)).json()
    assert r["peers"] == [] and r["media"] == []


def test_crossing_invisible_until_release_the_next_day(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    today = _epoch(h)
    _cross(h, a.user_id, b.user_id, today)
    assert h.client.get("/v1/digest", headers=auth(a.token)).json()["peers"] == []
    _goto_release(h, add_days(today, 1))
    r = h.client.get("/v1/digest", headers=auth(a.token)).json()
    assert _peer_ids(r) == {b.user_id}
    assert r["release_day"] == add_days(today, 1)


def test_digest_is_byte_identical_until_next_release_then_shows_late_crossings(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    today = _epoch(h)
    _cross(h, a.user_id, b.user_id, today)
    tomorrow = add_days(today, 1)
    _goto_release(h, tomorrow)
    first = h.client.get("/v1/digest", headers=auth(a.token)).json()

    c = signup(h, email="c@example.ac.in")
    _cross(h, a.user_id, c.user_id, today)  # a "late" crossing, resolved after today's release
    h.clock.advance(hours=6)
    second = h.client.get("/v1/digest", headers=auth(a.token)).json()
    assert second == first  # unchanged within the same release window

    _goto_release(h, add_days(tomorrow, 1))
    third = h.client.get("/v1/digest", headers=auth(a.token)).json()
    assert _peer_ids(third) == {b.user_id, c.user_id}


def test_paused_peer_excluded_at_bake_and_stays_excluded(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    today = _epoch(h)
    _cross(h, a.user_id, b.user_id, today)
    with h.db() as db:
        db.get(User, b.user_id).discovery_paused = True
        db.commit()
    _goto_release(h, add_days(today, 1))
    assert h.client.get("/v1/digest", headers=auth(a.token)).json()["peers"] == []
    with h.db() as db:
        db.get(User, b.user_id).discovery_paused = False
        db.commit()
    assert (
        h.client.get("/v1/digest", headers=auth(a.token)).json()["peers"] == []
    )  # still baked out


def test_suspended_peer_is_removed_live_even_after_bake(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    today = _epoch(h)
    _cross(h, a.user_id, b.user_id, today)
    _goto_release(h, add_days(today, 1))
    assert _peer_ids(h.client.get("/v1/digest", headers=auth(a.token)).json()) == {b.user_id}
    with h.db() as db:
        db.get(User, b.user_id).suspended_at = h.clock.now()
        db.commit()
    assert h.client.get("/v1/digest", headers=auth(a.token)).json()["peers"] == []


def test_viewer_own_block_removes_peer_immediately(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    today = _epoch(h)
    _cross(h, a.user_id, b.user_id, today)
    _goto_release(h, add_days(today, 1))
    assert _peer_ids(h.client.get("/v1/digest", headers=auth(a.token)).json()) == {b.user_id}
    with h.db() as db:
        db.add(Block(blocker_id=a.user_id, blocked_id=b.user_id, created_at=h.clock.now()))
        db.commit()
    assert h.client.get("/v1/digest", headers=auth(a.token)).json()["peers"] == []


def test_peer_who_blocked_viewer_and_matched_peer_are_excluded_at_bake(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    c = signup(h, email="c@example.ac.in")
    today = _epoch(h)
    _cross(h, a.user_id, b.user_id, today)
    _cross(h, a.user_id, c.user_id, today)
    with h.db() as db:
        db.add(Block(blocker_id=b.user_id, blocked_id=a.user_id, created_at=h.clock.now()))
        lo, hi = sorted((a.user_id, c.user_id))
        db.add(Match(id="m1", user_lo=lo, user_hi=hi, created_epoch=today, policy="M"))
        db.commit()
    _goto_release(h, add_days(today, 1))
    assert h.client.get("/v1/digest", headers=auth(a.token)).json()["peers"] == []


def test_display_cap(make_harness) -> None:
    h: Harness = make_harness(digest={"display_cap": 2})
    a = signup(h, email="a@example.ac.in")
    peers = [signup(h, email=f"p{i}@example.ac.in") for i in range(5)]
    today = _epoch(h)
    for p in peers:
        _cross(h, a.user_id, p.user_id, today)
    _goto_release(h, add_days(today, 1))
    assert len(h.client.get("/v1/digest", headers=auth(a.token)).json()["peers"]) == 2


def test_peer_card_shape_has_no_photos_counts_or_times(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    h.client.put(
        "/v1/profile",
        json={
            "first_name": "Bee",
            "year_of_study": 2,
            "prompts": [
                {"prompt_id": "looking_for", "text": "Study buddies"},
                {"prompt_id": "simple_pleasures", "text": "Coffee"},
                {"prompt_id": "ask_me_about", "text": "Robots"},
            ],
        },
        headers=auth(b.token),
    )
    today = _epoch(h)
    _cross(h, a.user_id, b.user_id, today)
    _goto_release(h, add_days(today, 1))
    r = h.client.get("/v1/digest", headers=auth(a.token)).json()
    peer = r["peers"][0]
    assert set(peer) == {"card", "last_day", "encounter"}
    card = peer["card"]
    assert set(card) == {"peer_id", "first_name", "year_of_study", "identity_pk", "prompts"}
    assert card["first_name"] == "Bee"
    assert all(
        set(p) <= {"prompt_id", "text", "voice_media_id", "waveform"} for p in card["prompts"]
    )


def test_media_served_only_for_peers_in_digest_window_and_only_voice(h: Harness) -> None:
    from test_profile import m4a

    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    c = signup(h, email="c@example.ac.in")
    h.client.put(
        "/v1/profile",
        json={
            "first_name": "Bee",
            "prompts": [
                {"prompt_id": "looking_for", "text": "x"},
                {"prompt_id": "simple_pleasures", "text": "y"},
                {"prompt_id": "ask_me_about", "text": "z"},
            ],
        },
        headers=auth(b.token),
    )
    voice_id = h.client.post(
        "/v1/profile/voice/ask_me_about",
        files={"audio": ("n.m4a", m4a(10), "audio/mp4")},
        data={"waveform": json.dumps([1] * 48)},
        headers=auth(b.token),
    ).json()["media_id"]
    today = _epoch(h)
    _cross(h, a.user_id, b.user_id, today)
    _goto_release(h, add_days(today, 1))

    assert h.client.get(f"/v1/media/{voice_id}", headers=auth(a.token)).status_code == 200
    assert (
        h.client.get(f"/v1/media/{voice_id}", headers=auth(c.token)).status_code == 404
    )  # not in c's digest
    assert h.client.get("/v1/media/does-not-exist", headers=auth(a.token)).status_code == 404

    with h.db() as db:
        db.add(
            Media(
                id="photo1",
                user_id=b.user_id,
                kind="photo",
                photo_index=0,
                path="x.jpg",
                bytes=10,
                sha256="abc",
                created_at=h.clock.now(),
            )
        )
        db.commit()
    assert (
        h.client.get("/v1/media/photo1", headers=auth(a.token)).status_code == 404
    )  # photos never served here


def test_digest_media_list_includes_voice_notes_sorted_by_id(h: Harness) -> None:
    from test_profile import m4a

    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    h.client.put(
        "/v1/profile",
        json={
            "first_name": "Bee",
            "prompts": [
                {"prompt_id": "looking_for", "text": "x"},
                {"prompt_id": "simple_pleasures", "text": "y"},
                {"prompt_id": "ask_me_about", "text": "z"},
            ],
        },
        headers=auth(b.token),
    )
    voice_id = h.client.post(
        "/v1/profile/voice/ask_me_about",
        files={"audio": ("n.m4a", m4a(10), "audio/mp4")},
        data={"waveform": json.dumps([1] * 48)},
        headers=auth(b.token),
    ).json()["media_id"]
    today = _epoch(h)
    _cross(h, a.user_id, b.user_id, today)
    _goto_release(h, add_days(today, 1))
    r = h.client.get("/v1/digest", headers=auth(a.token)).json()
    assert r["media"] == [m for m in sorted(r["media"], key=lambda m: m["media_id"])]
    assert {m["media_id"] for m in r["media"]} == {voice_id}
