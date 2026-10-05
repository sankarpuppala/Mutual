"""Deletes data whose retention period has passed (SPEC.md §9, CLAUDE.md §6).

Runs at server startup and every hour (``main.py``); also directly callable from tests
and the admin CLI with an injected clock.
"""

from __future__ import annotations

from sqlalchemy import delete
from sqlalchemy.orm import Session

from mutual_server.clock import Clock, add_days, local_day
from mutual_server.config import Settings
from mutual_server.models import (
    Crossing,
    DigestSnapshot,
    Encounter,
    OtpCode,
    PresenceUpload,
    SessionRow,
)


def run_retention(db: Session, clock: Clock, settings: Settings) -> None:
    today = local_day(clock, settings.tz)
    now = clock.now()

    # Presence cutoff (SPEC §6.11): day d's raw uploads are purged once day d+2 has started,
    # i.e. once d <= today - 2.
    presence_cutoff = add_days(today, -2)
    db.execute(delete(Encounter).where(Encounter.day <= presence_cutoff))
    db.execute(delete(PresenceUpload).where(PresenceUpload.day <= presence_cutoff))

    # Crossings and the digest snapshots built from them: kept for crossing_retention_days.
    crossing_cutoff = add_days(today, -settings.presence.crossing_retention_days)
    db.execute(delete(Crossing).where(Crossing.day < crossing_cutoff))
    db.execute(delete(DigestSnapshot).where(DigestSnapshot.release_day < crossing_cutoff))

    # Expired OTP codes and sessions.
    db.execute(delete(OtpCode).where(OtpCode.expires_at <= now))
    db.execute(delete(SessionRow).where(SessionRow.expires_at <= now))

    db.commit()
