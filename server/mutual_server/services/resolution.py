"""Presence resolution: encounter tokens → crossings, inside one campus only (SPEC.md §6.13, §4.1).

The server never sees daily keys, EIDs, RSSI or sighting times — only opaque 32-byte
encounter tokens (CLAUDE.md invariant 1). A crossing is recorded only when a token was
uploaded by exactly two accounts, of the same campus; three or more uploaders "poison" the
token for every pair, which can retract an earlier crossing.
"""

from __future__ import annotations

import itertools

from sqlalchemy import select
from sqlalchemy.orm import Session

from mutual_server.clock import Clock
from mutual_server.models import Crossing, Encounter, User


def _shared_tokens_exactly_two(db: Session, day: str, a: str, b: str) -> list[bytes]:
    """Tokens uploaded by both a and b, and by nobody else, for this day."""
    tokens_a = {
        t
        for (t,) in db.execute(
            select(Encounter.token).where(Encounter.day == day, Encounter.user_id == a)
        )
    }
    tokens_b = {
        t
        for (t,) in db.execute(
            select(Encounter.token).where(Encounter.day == day, Encounter.user_id == b)
        )
    }
    shared = tokens_a & tokens_b
    out = []
    for token in shared:
        uploaders = {
            u
            for (u,) in db.execute(
                select(Encounter.user_id).where(Encounter.day == day, Encounter.token == token)
            )
        }
        if len(uploaders) == 2:
            out.append(token)
    return out


def recompute_crossing(db: Session, clock: Clock, day: str, a: str, b: str) -> None:
    """Recompute (or remove) the crossing row for this pair and day from scratch."""
    lo, hi = sorted((a, b))
    existing = db.get(Crossing, (day, lo, hi))
    user_a, user_b = db.get(User, a), db.get(User, b)
    if user_a is None or user_b is None or user_a.campus_id != user_b.campus_id:
        if existing is not None:
            db.delete(existing)
        return
    candidates = _shared_tokens_exactly_two(db, day, a, b)
    if not candidates:
        if existing is not None:
            db.delete(existing)
        return
    canonical = min(candidates)  # the byte-wise smallest shared, unpoisoned token
    if existing is None:
        db.add(Crossing(day=day, user_lo=lo, user_hi=hi, token=canonical, created_at=clock.now()))
    else:
        existing.token = canonical


def process_presence_upload(
    db: Session, clock: Clock, user: User, day: str, tokens: list[bytes]
) -> None:
    """Store this upload's encounter tokens and update every crossing they affect."""
    for token in tokens:
        db.add(Encounter(day=day, token=token, user_id=user.id))
    db.flush()

    for token in set(tokens):
        uploaders = sorted(
            {
                u
                for (u,) in db.execute(
                    select(Encounter.user_id).where(Encounter.day == day, Encounter.token == token)
                )
            }
        )
        if len(uploaders) < 2:
            continue
        # Exactly 2: that pair alone. 3+: the token is now poisoned, so every pair that
        # might have used it as a canonical token must be recomputed (it may still have
        # another unpoisoned shared token, or its crossing may now disappear entirely).
        pairs = (
            [tuple(uploaders)]
            if len(uploaders) == 2
            else list(itertools.combinations(uploaders, 2))
        )
        for a, b in pairs:
            recompute_crossing(db, clock, day, a, b)
    db.commit()
