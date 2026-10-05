from datetime import timedelta

from conftest import Harness, auth, make_shared_token, padded, signup

from mutual_server.clock import add_days, at_local
from mutual_server.models import (
    Crossing,
    DigestSnapshot,
    Encounter,
    OtpCode,
    PresenceUpload,
    SessionRow,
)
from mutual_server.services.retention import run_retention


def test_presence_cutoff_deletes_at_start_of_d_plus_2(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    day = "2026-10-04"
    tok = make_shared_token(day)
    r = h.client.post(
        f"/v1/presence/{day}", json={"encounters": padded([tok])}, headers=auth(a.token)
    )
    assert r.status_code == 201

    cutoff = at_local(add_days(day, 2), "00:00", h.settings.tz)
    h.clock.set(cutoff - timedelta(seconds=1))
    with h.db() as db:
        run_retention(db, h.clock, h.settings)
        assert db.query(PresenceUpload).count() == 1
        assert db.query(Encounter).count() > 0

    h.clock.set(cutoff)
    with h.db() as db:
        run_retention(db, h.clock, h.settings)
        assert db.query(PresenceUpload).count() == 0
        assert db.query(Encounter).count() == 0


def test_crossing_retention_days(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    today = h.client.get("/v1/config").json()["epoch"]
    lo, hi = sorted((a.user_id, b.user_id))
    kept_day = add_days(today, -7)  # exactly crossing_retention_days ago: kept
    removed_day = add_days(today, -8)  # one day older: removed

    with h.db() as db:
        db.add(
            Crossing(
                day=kept_day, user_lo=lo, user_hi=hi, token=b"k" * 32, created_at=h.clock.now()
            )
        )
        db.commit()
    with h.db() as db:
        run_retention(db, h.clock, h.settings)
        assert db.query(Crossing).filter_by(day=kept_day).count() == 1

    with h.db() as db:
        db.add(
            Crossing(
                day=removed_day, user_lo=lo, user_hi=hi, token=b"r" * 32, created_at=h.clock.now()
            )
        )
        db.commit()
    with h.db() as db:
        run_retention(db, h.clock, h.settings)
        assert db.query(Crossing).filter_by(day=kept_day).count() == 1
        assert db.query(Crossing).filter_by(day=removed_day).count() == 0


def test_old_digest_snapshots_are_cleaned_up(h: Harness) -> None:
    a = signup(h, email="a@example.ac.in")
    today = h.client.get("/v1/config").json()["epoch"]
    old_release = add_days(today, -8)
    with h.db() as db:
        db.add(
            DigestSnapshot(
                user_id=a.user_id, release_day=old_release, peers=[], created_at=h.clock.now()
            )
        )
        db.commit()
    with h.db() as db:
        run_retention(db, h.clock, h.settings)
        assert db.query(DigestSnapshot).count() == 0


def test_ended_match_deleted_after_30_days_if_never_fetched(h: Harness) -> None:
    from conftest import make_match

    a = signup(h, email="a@example.ac.in")
    b = signup(h, email="b@example.ac.in")
    match_id = make_match(h, a, b, "2026-10-05", ["date"])
    h.client.delete(f"/v1/matches/{match_id}", headers=auth(a.token))  # ends it for b
    with h.db() as db:
        from mutual_server.models import Match

        assert db.query(Match).filter_by(id=match_id).count() == 1
        run_retention(db, h.clock, h.settings)
        assert db.query(Match).filter_by(id=match_id).count() == 1  # not yet 30 days

    h.clock.advance(days=h.settings.reveal.ended_match_retention_days + 1)
    with h.db() as db:
        from mutual_server.models import Match

        run_retention(db, h.clock, h.settings)
        assert db.query(Match).filter_by(id=match_id).count() == 0


def test_otp_and_session_retention(h: Harness) -> None:
    acct = signup(h)
    h.client.post("/v1/auth/request-otp", json={"email": "pending@example.ac.in"})
    with h.db() as db:
        assert db.query(OtpCode).count() == 1
        run_retention(db, h.clock, h.settings)
        assert db.query(OtpCode).count() == 1  # not expired yet

    h.clock.advance(seconds=h.settings.auth.otp_ttl_seconds + 1)
    with h.db() as db:
        run_retention(db, h.clock, h.settings)
        assert db.query(OtpCode).count() == 0

    h.clock.advance(days=h.settings.auth.session_ttl_days + 1)
    with h.db() as db:
        run_retention(db, h.clock, h.settings)
        assert db.query(SessionRow).filter_by(user_id=acct.user_id).count() == 0
