from datetime import timedelta

from conftest import Harness, auth, make_shared_token, padded, signup
from mutual_protocol.encoding import b64url_encode

from mutual_server.clock import add_days, at_local
from mutual_server.models import Crossing, Encounter


def _upload(h: Harness, token: str, day: str, tokens: list[bytes]):
    return h.client.post(
        f"/v1/presence/{day}", json={"encounters": padded(tokens)}, headers=auth(token)
    )


def _crossing_count(h: Harness) -> int:
    with h.db() as db:
        return db.query(Crossing).count()


def test_schema_has_only_encounter_tokens(h: Harness) -> None:
    from mutual_server.schemas import PresenceUploadIn

    assert set(PresenceUploadIn.model_fields) == {"encounters"}  # no key, EID, window or time field
    a = signup(h)
    day = "2026-10-04"
    r = h.client.post(
        f"/v1/presence/{day}",
        json={"encounters": padded([make_shared_token(day)]), "daily_key": "x", "windows": 4},
        headers=auth(a.token),
    )
    assert r.status_code == 422  # extra='forbid' rejects it


def test_upload_rules_day_count_and_duplicates(h: Harness) -> None:
    a = signup(h)
    today = "2026-10-05"
    assert _upload(h, a.token, today, [make_shared_token(today)]).status_code == 400
    future = "2026-10-06"
    assert _upload(h, a.token, future, [make_shared_token(future)]).status_code == 400
    assert (
        h.client.post(
            "/v1/presence/not-a-day", json={"encounters": []}, headers=auth(a.token)
        ).status_code
        == 400
    )

    day = "2026-10-04"
    too_few = h.client.post(
        f"/v1/presence/{day}",
        json={"encounters": [b64url_encode(make_shared_token(day))]},
        headers=auth(a.token),
    )
    assert too_few.status_code == 422
    too_many = h.client.post(
        f"/v1/presence/{day}",
        json={"encounters": [b64url_encode(b"x" * 32)] * 1025},
        headers=auth(a.token),
    )
    assert too_many.status_code == 422
    bad_length = h.client.post(
        f"/v1/presence/{day}",
        json={"encounters": [b64url_encode(b"x" * 31)] * 256},
        headers=auth(a.token),
    )
    assert bad_length.status_code == 422
    tok = make_shared_token(day)
    duplicated = h.client.post(
        f"/v1/presence/{day}",
        json={"encounters": [b64url_encode(tok)] * 256},
        headers=auth(a.token),
    )
    assert duplicated.status_code == 422

    assert _upload(h, a.token, day, [tok]).status_code == 201
    assert _upload(h, a.token, day, [make_shared_token(day)]).status_code == 409  # once per day


def test_past_cutoff_is_rejected(h: Harness) -> None:
    a = signup(h)
    day = "2026-10-04"
    cutoff = at_local(add_days(day, 2), "00:00", h.settings.tz)
    h.clock.set(cutoff - timedelta(seconds=1))
    assert _upload(h, a.token, day, [make_shared_token(day)]).status_code == 201

    b = signup(h, email="b@example.ac.in")
    h.clock.set(cutoff)
    r = _upload(h, b.token, day, [make_shared_token(day)])
    assert r.status_code == 400 and r.json()["error"] == "past_cutoff"


def test_one_sided_upload_never_creates_a_crossing(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    day = "2026-10-04"
    assert _upload(h, a.token, day, [make_shared_token(day)]).status_code == 201
    assert _crossing_count(h) == 0


def test_two_uploaders_of_the_same_token_create_a_crossing(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    day = "2026-10-04"
    shared = make_shared_token(day)
    assert _upload(h, a.token, day, [shared]).status_code == 201
    assert _crossing_count(h) == 0
    assert _upload(h, b.token, day, [shared]).status_code == 201
    with h.db() as db:
        lo, hi = sorted((a.user_id, b.user_id))
        row = db.get(Crossing, (day, lo, hi))
        assert row is not None and row.token == shared


def test_token_shared_by_three_accounts_is_poisoned(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    c = signup(h, email="c@example.ac.in")
    day = "2026-10-04"
    shared = make_shared_token(day)
    _upload(h, a.token, day, [shared])
    _upload(h, b.token, day, [shared])
    assert _crossing_count(h) == 1
    _upload(h, c.token, day, [shared])  # a third uploader poisons it for every pair
    assert _crossing_count(h) == 0


def test_poisoned_token_falls_back_to_another_shared_token(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    c = signup(h, email="c@example.ac.in")
    day = "2026-10-04"
    poisoned = make_shared_token(day)
    also_shared = make_shared_token(day)
    _upload(h, a.token, day, [poisoned, also_shared])
    _upload(h, b.token, day, [poisoned, also_shared])
    with h.db() as db:
        lo, hi = sorted((a.user_id, b.user_id))
        assert db.get(Crossing, (day, lo, hi)).token == min(poisoned, also_shared)
    _upload(h, c.token, day, [poisoned])
    with h.db() as db:
        row = db.get(Crossing, (day, lo, hi))
        assert row is not None and row.token == also_shared  # recovered via the un-poisoned token


def test_cross_campus_token_creates_no_crossing(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@other.edu.in")
    day = "2026-10-04"
    shared = make_shared_token(day)
    _upload(h, a.token, day, [shared])
    _upload(h, b.token, day, [shared])
    assert _crossing_count(h) == 0


def test_presence_upload_requires_auth(h: Harness) -> None:
    day = "2026-10-04"
    r = h.client.post(f"/v1/presence/{day}", json={"encounters": padded([make_shared_token(day)])})
    assert r.status_code == 401


def test_no_daily_key_eid_or_time_ever_reaches_the_database(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    day = "2026-10-04"
    tok = make_shared_token(day)
    _upload(h, a.token, day, [tok])
    with h.db() as db:
        row = db.query(Encounter).first()
        assert row is not None and len(row.token) == 32
    assert "daily_key" not in h.dump() and "windows" not in h.dump()
