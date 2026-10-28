"""Digest snapshots (SPEC.md §11): computed once per viewer per release, then frozen.

Two exclusion timings apply (quoted from §11):
- **Immediate** (checked live, every request, never baked in): the viewer's own blocks,
  and a peer who has since been suspended.
- **At the next release** (baked into the snapshot at the moment it is first built): a
  peer who blocked the viewer, paused, deleted their account, or matched the viewer.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from mutual_server.clock import Clock, add_days, at_local, local_day
from mutual_server.config import Settings
from mutual_server.models import Block, Crossing, DigestSnapshot, Match, User
from mutual_server.services.ranking import random_order


@dataclass(frozen=True)
class _Candidate:
    peer_id: str
    last_day: str
    token: bytes


def release_day_for(clock: Clock, settings: Settings) -> str:
    """The local day D whose release (at digest.release_time) is the most recent one <= now."""
    today = local_day(clock, settings.tz)
    if clock.now() >= at_local(today, settings.digest.release_time, settings.tz):
        return today
    return add_days(today, -1)


def _has_active_match(db: Session, a: str, b: str) -> bool:
    lo, hi = sorted((a, b))
    row = db.execute(
        select(Match.id).where(Match.user_lo == lo, Match.user_hi == hi, Match.ended_at.is_(None))
    ).first()
    return row is not None


def _candidates(
    db: Session, viewer: User, release_day: str, settings: Settings
) -> list[_Candidate]:
    """Peers with an eligible crossing, most recent day only, minus the exclusions baked at release."""
    window_start = add_days(release_day, -settings.digest.lookback_days)
    rows = db.execute(
        select(Crossing.user_lo, Crossing.user_hi, Crossing.day, Crossing.token).where(
            Crossing.day >= window_start,
            Crossing.day < release_day,
            (Crossing.user_lo == viewer.id) | (Crossing.user_hi == viewer.id),
        )
    ).all()
    best: dict[str, _Candidate] = {}
    for lo, hi, day, token in rows:
        peer_id = hi if lo == viewer.id else lo
        current = best.get(peer_id)
        if current is None or day > current.last_day:
            best[peer_id] = _Candidate(peer_id=peer_id, last_day=day, token=token)

    out = []
    for peer_id, candidate in best.items():
        peer = db.get(User, peer_id)
        if peer is None or peer.discovery_paused:
            continue
        blocked_viewer = db.execute(
            select(Block.blocker_id).where(
                Block.blocker_id == peer_id, Block.blocked_id == viewer.id
            )
        ).first()
        if blocked_viewer is not None:
            continue
        if _has_active_match(db, viewer.id, peer_id):
            continue
        out.append(candidate)
    return out


def get_or_build_snapshot(
    db: Session, clock: Clock, settings: Settings, viewer: User
) -> DigestSnapshot:
    """Return this release's snapshot, building and caching it on first access."""
    release_day = release_day_for(clock, settings)
    existing = db.get(DigestSnapshot, (viewer.id, release_day))
    if existing is not None:
        return existing
    candidates = _candidates(db, viewer, release_day, settings)
    window_start = add_days(release_day, -settings.digest.lookback_days)
    prior_snapshots = db.scalars(
        select(DigestSnapshot).where(
            DigestSnapshot.user_id == viewer.id,
            DigestSnapshot.release_day >= window_start,
            DigestSnapshot.release_day < release_day,
        )
    ).all()
    already_shown: set[str] = {p["peer_id"] for snap in prior_snapshots for p in (snap.peers or [])}
    unseen_ids = [c.peer_id for c in candidates if c.peer_id not in already_shown]
    shown_ids = [c.peer_id for c in candidates if c.peer_id in already_shown]

    ordered_unseen = random_order(viewer.id, release_day, unseen_ids)
    ordered_shown = random_order(viewer.id, release_day, shown_ids)
    capped = (ordered_unseen + ordered_shown)[: settings.digest.display_cap]

    by_id = {c.peer_id: c for c in candidates}
    peers = [
        {"peer_id": pid, "last_day": by_id[pid].last_day, "token": by_id[pid].token.hex()}
        for pid in capped
    ]
    snapshot = DigestSnapshot(
        user_id=viewer.id, release_day=release_day, peers=peers, created_at=clock.now()
    )
    db.add(snapshot)
    db.commit()
    return snapshot


def visible_peers(
    db: Session, clock: Clock, settings: Settings, viewer: User
) -> tuple[str, list[dict]]:
    """``(release_day, peers)`` — the cached snapshot with the two live exclusions applied."""
    snapshot = get_or_build_snapshot(db, clock, settings, viewer)
    blocked_by_viewer = {
        pid for (pid,) in db.execute(select(Block.blocked_id).where(Block.blocker_id == viewer.id))
    }
    out = []
    for entry in snapshot.peers:
        if entry["peer_id"] in blocked_by_viewer:
            continue
        peer = db.get(User, entry["peer_id"])
        if peer is None or peer.suspended_at is not None:
            continue
        out.append(entry)
    return snapshot.release_day, out
