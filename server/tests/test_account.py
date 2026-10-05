from conftest import Harness, auth, login, signup
from mutual_protocol.encoding import b64url_encode
from mutual_protocol.keys import generate_identity_keypair

DOB = "2004-05-01"


def _create(h: Harness, token: str, **fields):
    _, pk = generate_identity_keypair()
    body = {"date_of_birth": DOB, "identity_pk": b64url_encode(pk), "first_name": "Ananya"}
    body.update(fields)
    return h.client.post("/v1/account", json=body, headers=auth(token))


def test_create_account_and_me(h: Harness) -> None:
    acct = signup(h)
    me = h.client.get("/v1/account/me", headers=auth(acct.token)).json()
    assert me["user_id"] == acct.user_id
    assert me["first_name"] == "Ananya" and me["year_of_study"] == 3
    assert me["campus"]["key"] == "example.ac.in"
    assert me["profile"] is None


def test_under_18_rejected_kindly_and_nothing_stored(h: Harness) -> None:
    token = login(h)
    r = _create(h, token, date_of_birth="2008-10-06")  # 17 on 2026-10-05
    assert r.status_code == 403 and r.json()["error"] == "underage"
    assert "18 and over" in r.json()["message"]
    assert "2008-10-06" not in h.dump()
    assert _create(h, token, date_of_birth="2008-10-05").status_code == 201  # 18 today


def test_date_of_birth_is_never_persisted_or_echoed(h: Harness) -> None:
    signup(h, dob="2003-02-17")
    dump = h.dump()
    assert "2003-02-17" not in dump and "2003, 2, 17" not in dump
    token = login(h, "b@example.ac.in")
    r = h.client.post(
        "/v1/account", json={"date_of_birth": "2003-02-31", "identity_pk": 5}, headers=auth(token)
    )
    assert r.status_code == 422 and "2003-02-31" not in r.text


def test_future_date_of_birth(h: Harness) -> None:
    assert _create(h, login(h), date_of_birth="2027-01-01").status_code == 422


def test_identity_key_validity_and_uniqueness(h: Harness) -> None:
    token = login(h)
    for bad in (
        b64url_encode(bytes(32)),
        b64url_encode(b"\x01" + bytes(31)),
        "not-base64!",
        b64url_encode(bytes(31)),
    ):
        r = _create(h, token, identity_pk=bad)
        assert r.status_code == 422 and r.json()["error"] == "invalid_identity_key", bad
    _, pk = generate_identity_keypair()
    alias = pk[:31] + bytes([pk[31] | 0x80])
    assert _create(h, token, identity_pk=b64url_encode(alias)).status_code == 422
    first = signup(h, email="first@example.ac.in")
    r = _create(h, token, identity_pk=b64url_encode(first.pk))
    assert r.status_code == 409 and r.json()["error"] == "identity_key_taken"


def test_second_account_on_same_session_rejected(h: Harness) -> None:
    acct = signup(h)
    assert _create(h, acct.token).status_code == 409


def test_account_needs_a_session(h: Harness) -> None:
    _, pk = generate_identity_keypair()
    body = {"date_of_birth": DOB, "identity_pk": b64url_encode(pk), "first_name": "A"}
    assert h.client.post("/v1/account", json=body).status_code == 401


def test_identity_key_change_is_rate_limited(h: Harness) -> None:
    acct = signup(h)
    other = signup(h, email="other@example.ac.in")
    _, new_pk = generate_identity_keypair()
    r = h.client.put(
        "/v1/account/identity-key",
        json={"identity_pk": b64url_encode(new_pk)},
        headers=auth(acct.token),
    )
    assert r.status_code == 429
    h.clock.advance(days=30)
    # Sessions last 30 days; sign in again before changing the key.
    token = login(h)
    r = h.client.put(
        "/v1/account/identity-key",
        json={"identity_pk": b64url_encode(other.pk)},
        headers=auth(token),
    )
    assert r.status_code == 409
    r = h.client.put(
        "/v1/account/identity-key", json={"identity_pk": b64url_encode(new_pk)}, headers=auth(token)
    )
    assert r.status_code == 204


def test_name_and_year_validation(h: Harness) -> None:
    token = login(h)
    assert _create(h, token, first_name="   ").status_code in (422,)
    assert _create(h, token, year_of_study=0).status_code == 422
    assert _create(h, token, year_of_study=9).status_code == 422


def test_delete_account_revokes_sessions(h: Harness) -> None:
    acct = signup(h)
    assert h.client.delete("/v1/account", headers=auth(acct.token)).status_code == 202
    assert h.client.get("/v1/account/me", headers=auth(acct.token)).status_code == 401


def test_delete_account_cascades_rows_and_media_files(h: Harness) -> None:
    from pathlib import Path

    from conftest import make_shared_token, padded

    from mutual_server.models import Crossing, Encounter, Media, Profile, User

    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    h.client.put(
        "/v1/profile",
        json={
            "first_name": "Ananya",
            "prompts": [
                {"prompt_id": "looking_for", "text": "x"},
                {"prompt_id": "simple_pleasures", "text": "y"},
                {"prompt_id": "ask_me_about", "text": "z"},
            ],
        },
        headers=auth(a.token),
    )
    import io

    from PIL import Image

    img = Image.new("RGB", (40, 30), (1, 2, 3))
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    photo = h.client.post(
        "/v1/profile/photos",
        files={"image": ("p.jpg", buf.getvalue(), "image/jpeg")},
        headers=auth(a.token),
    ).json()
    stored_path = Path(h.settings.media.storage_dir) / f"{photo['media_id']}.jpg"
    assert stored_path.exists()

    day = "2026-10-04"
    shared = make_shared_token(day)
    for acct in (a, b):
        h.client.post(
            f"/v1/presence/{day}", json={"encounters": padded([shared])}, headers=auth(acct.token)
        )
    with h.db() as db:
        assert db.query(Crossing).count() == 1

    assert h.client.delete("/v1/account", headers=auth(a.token)).status_code == 202

    assert not stored_path.exists()
    with h.db() as db:
        assert db.get(User, a.user_id) is None
        assert db.get(Profile, a.user_id) is None
        assert db.query(Media).filter_by(user_id=a.user_id).count() == 0
        assert db.query(Crossing).count() == 0
        assert db.query(Encounter).filter_by(user_id=a.user_id).count() == 0


def test_delete_account_ends_active_matches_for_the_other_side(h: Harness) -> None:
    from conftest import make_match

    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    match_id = make_match(h, a, b, "2026-10-05", ["date"])

    assert h.client.delete("/v1/account", headers=auth(a.token)).status_code == 202

    rb = h.client.get("/v1/matches", headers=auth(b.token)).json()
    assert len(rb) == 1 and rb[0]["match_id"] == match_id
    assert rb[0]["state"] == "ended"
    assert rb[0]["peer"]["peer_id"] == a.user_id  # frozen card survives the deleted account
