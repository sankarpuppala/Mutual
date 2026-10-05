"""GET /matches/{id}/photos/{index} gating (SPEC.md §11.2). Photos only after reveal,
only the match's own peer's photos, never before a match exists at all (S10/pre-match)."""

import io

from conftest import Harness, auth, make_match, signup
from PIL import Image

DAY = "2026-10-05"


def _photo(h: Harness, token: str):
    img = Image.new("RGB", (40, 30), (10, 20, 30))
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    return h.client.post(
        "/v1/profile/photos",
        files={"image": ("p.jpg", buf.getvalue(), "image/jpeg")},
        headers=auth(token),
    )


def test_policy_m_photos_available_immediately(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    assert _photo(h, b.token).status_code == 201
    match_id = make_match(h, a, b, DAY, ["date"])
    r = h.client.get(f"/v1/matches/{match_id}/photos/0", headers=auth(a.token))
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"


def test_policy_c_photos_blocked_until_revealed(make_harness) -> None:
    h: Harness = make_harness(
        reveal={"policy_schedule": [{"start": DAY, "end": DAY, "policy": "C"}]}
    )
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    _photo(h, b.token)
    match_id = make_match(h, a, b, DAY, ["date"])
    assert (
        h.client.get(f"/v1/matches/{match_id}/photos/0", headers=auth(a.token)).status_code == 404
    )

    for _ in range(8):
        assert (
            h.client.post(
                f"/v1/matches/{match_id}/messages", json={"body": "hi"}, headers=auth(a.token)
            ).status_code
            == 201
        )
        assert (
            h.client.post(
                f"/v1/matches/{match_id}/messages", json={"body": "hey"}, headers=auth(b.token)
            ).status_code
            == 201
        )
    assert (
        h.client.get(f"/v1/matches/{match_id}/photos/0", headers=auth(a.token)).status_code == 200
    )


def test_reveal_consent_is_idempotent(make_harness) -> None:
    h: Harness = make_harness(
        reveal={"policy_schedule": [{"start": DAY, "end": DAY, "policy": "C"}]}
    )
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    match_id = make_match(h, a, b, DAY, ["date"])
    for _ in range(3):
        assert (
            h.client.post(
                f"/v1/matches/{match_id}/reveal-consent", headers=auth(a.token)
            ).status_code
            == 204
        )
    assert (
        h.client.post(f"/v1/matches/{match_id}/reveal-consent", headers=auth(b.token)).status_code
        == 204
    )
    assert (
        h.client.get("/v1/matches", headers=auth(a.token)).json()[0]["reveal"]["state"]
        == "revealed"
    )


def test_photo_index_out_of_range_404s(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    _photo(h, b.token)
    match_id = make_match(h, a, b, DAY, ["date"])
    assert (
        h.client.get(f"/v1/matches/{match_id}/photos/3", headers=auth(a.token)).status_code == 404
    )


def test_no_photo_route_before_any_match_exists(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    _photo(h, b.token)
    r = h.client.get("/v1/matches/not-a-real-match/photos/0", headers=auth(a.token))
    assert r.status_code == 404
