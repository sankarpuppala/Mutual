"""The nightly matching batch and fair delivery (SPEC.md §6.9).

Two independent, idempotent steps, both safe to call as often as you like:

- ``run_match_batch`` turns each epoch's ``epoch_tokens`` into pending ``match_tokens``,
  once that epoch's ``match_batch_time`` has passed, then deletes the epoch's tokens.
- ``release_due_tokens`` evaluates each pending token exactly once, the first time it is
  seen at or after its own ``notify_after``: a block, an unmatch, or either side having
  deleted their account drops it silently; otherwise it becomes ``notified`` forever.

Neither step ever runs inside a request that a human triggered (CLAUDE.md invariant 12)
— routers call them as a housekeeping step before reading state, not in response to a
block, unmatch or delete.
"""

from __future__ import annotations

from collections import defaultdict

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from mutual_server.clock import Clock, add_days, at_local
from mutual_server.config import Settings
from mutual_server.errors import ApiError
from mutual_server.ids import IdFactory
from mutual_server.models import Block, EpochToken, Match, MatchToken, Message, RevealConsent, User
from mutual_server.services.arms import policy_for_day
from mutual_server.services.cards import frozen_card_snapshot


def _due_epochs(db: Session, clock: Clock, settings: Settings) -> list[str]:
    """Every distinct epoch still in ``epoch_tokens`` whose own batch time has passed."""
    epochs = [e for (e,) in db.execute(select(EpochToken.epoch).distinct())]
    tz = settings.tz
    return [e for e in epochs if clock.now() >= at_local(e, settings.signals.match_batch_time, tz)]


def run_match_batch(db: Session, clock: Clock, settings: Settings, ids: IdFactory) -> None:
    """Process every epoch whose nightly batch is due. Safe to call repeatedly."""
    for epoch in _due_epochs(db, clock, settings):
        _process_epoch(db, clock, settings, ids, epoch)


def _process_epoch(
    db: Session, clock: Clock, settings: Settings, ids: IdFactory, epoch: str
) -> None:
    tz = settings.tz
    rows = db.execute(
        select(EpochToken.token, EpochToken.user_id).where(EpochToken.epoch == epoch)
    ).all()
    by_token: dict[bytes, list[str]] = defaultdict(list)
    for token, user_id in rows:
        by_token[token].append(user_id)

    notify_after = at_local(add_days(epoch, 1), settings.digest.release_time, tz)
    policy, _ = policy_for_day(settings, epoch)

    for token, uploaders in by_token.items():
        if len(uploaders) != 2:
            continue  # 0 or 1: no match; 2+ distinct users holding the same real token
            # is cryptographically not expected in honest operation — skip defensively.
        a, b = uploaders
        user_a, user_b = db.get(User, a), db.get(User, b)
        if user_a is None or user_b is None or user_a.campus_id != user_b.campus_id:
            continue  # defensive: signals only ever target same-campus digest peers
        lo, hi = sorted((a, b))
        match = db.execute(
            select(Match).where(Match.user_lo == lo, Match.user_hi == hi, Match.ended_at.is_(None))
        ).scalar_one_or_none()
        if match is None:
            match = Match(
                id=ids.new(),
                user_lo=lo,
                user_hi=hi,
                created_epoch=epoch,
                policy=policy,
                revealed_at=None,
                ended_at=None,
                ended_by=None,
                frozen_card=None,
                ended_seen_by_other_at=None,
            )
            db.add(match)
            db.flush()
        if db.get(MatchToken, (match.id, token)) is None:  # guard against a partial re-run
            db.add(
                MatchToken(
                    match_id=match.id,
                    token=token,
                    epoch=epoch,
                    notify_after=notify_after,
                    notified=False,
                )
            )

    db.execute(delete(EpochToken).where(EpochToken.epoch == epoch))
    db.commit()


def _blocked_pair(db: Session, a: str, b: str) -> bool:
    return (
        db.execute(
            select(Block.blocker_id).where(
                ((Block.blocker_id == a) & (Block.blocked_id == b))
                | ((Block.blocker_id == b) & (Block.blocked_id == a))
            )
        ).first()
        is not None
    )


def _remaining_tokens(db: Session, match_id: str) -> int:
    return (
        db.scalar(
            select(func.count()).select_from(MatchToken).where(MatchToken.match_id == match_id)
        )
        or 0
    )


def release_due_tokens(db: Session, clock: Clock) -> None:
    """Evaluate every pending token whose ``notify_after`` has passed, exactly once each."""
    now = clock.now()
    due = db.scalars(
        select(MatchToken).where(MatchToken.notified.is_(False), MatchToken.notify_after <= now)
    ).all()
    touched: set[str] = set()
    for row in due:
        match = db.get(Match, row.match_id)
        if match is None:
            db.delete(row)
            continue
        touched.add(match.id)
        deleted = match.user_lo is None or match.user_hi is None
        blocked = deleted or _blocked_pair(db, match.user_lo, match.user_hi)
        if blocked or match.ended_at is not None:
            db.delete(row)
        else:
            row.notified = True
            if match.policy == "M" and match.revealed_at is None:
                # M: "photos available to both parties as soon as the match is notified."
                match.revealed_at = now
    db.flush()
    for match_id in touched:
        _cleanup_if_empty(db, match_id)
    db.commit()


def _cleanup_if_empty(db: Session, match_id: str) -> None:
    """SPEC §6.9: "If no notified token remains, the match is deleted" — i.e. it never
    had any (a purely-pending match whose only tokens were all just dropped blind)."""
    match = db.get(Match, match_id)
    if match is not None and match.ended_at is None and _remaining_tokens(db, match_id) == 0:
        db.delete(match)


def end_match(db: Session, clock: Clock, match: Match, ended_by: User) -> None:
    """Unmatch, block or account deletion, once the match has at least one notified
    token: freeze a minimal card of the person who is leaving, delete the chat, and
    leave the notified tokens in place so the other party still sees "this mutual has
    ended" (SPEC §6.9, S4, S11)."""
    match.ended_at = clock.now()
    match.ended_by = ended_by.id
    match.frozen_card = frozen_card_snapshot(ended_by)
    db.execute(delete(Message).where(Message.match_id == match.id))
    db.execute(delete(RevealConsent).where(RevealConsent.match_id == match.id))


def maybe_reveal_policy_c(db: Session, clock: Clock, settings: Settings, match: Match) -> None:
    """Policy C: reveal when both sides have sent enough messages, or both consented,
    whichever comes first (SPEC §11.2). A no-op once already revealed, or under M."""
    if match.policy != "C" or match.revealed_at is not None:
        return
    if match.user_lo is None or match.user_hi is None:
        return
    consented = set(
        db.scalars(select(RevealConsent.user_id).where(RevealConsent.match_id == match.id))
    )
    if match.user_lo in consented and match.user_hi in consented:
        match.revealed_at = clock.now()
        return
    needed = settings.reveal.conversation_messages_each
    counts = dict(
        db.execute(
            select(Message.sender_id, func.count())
            .where(
                Message.match_id == match.id, Message.sender_id.in_((match.user_lo, match.user_hi))
            )
            .group_by(Message.sender_id)
        ).all()
    )
    if counts.get(match.user_lo, 0) >= needed and counts.get(match.user_hi, 0) >= needed:
        match.revealed_at = clock.now()


def sync_matches(db: Session, clock: Clock, settings: Settings, ids: IdFactory) -> None:
    """Housekeeping to run before reading or acting on any match: finish due batches,
    then release due tokens. Never run inside a block/unmatch/delete request itself."""
    run_match_batch(db, clock, settings, ids)
    release_due_tokens(db, clock)


def notified_tokens(db: Session, match_id: str) -> list[MatchToken]:
    """This match's notified tokens, in a fixed order (SPEC §11: ``matched``)."""
    rows = db.scalars(
        select(MatchToken).where(MatchToken.match_id == match_id, MatchToken.notified.is_(True))
    ).all()
    return sorted(rows, key=lambda r: (r.epoch, r.token))


def get_active_match(match_id: str, user: User, db: Session) -> Match:
    """SPEC §11: every ``/matches/{id}/*`` sub-route gives the same 404 for a match id
    that does not exist, is not the caller's, has no notified token, or has ended —
    ended matches carry "no chat or photos" and are shown only via the ``GET /matches``
    list, never through these sub-routes."""
    match = db.get(Match, match_id)
    if (
        match is None
        or match.ended_at is not None
        or user.id not in (match.user_lo, match.user_hi)
        or not notified_tokens(db, match_id)
    ):
        raise ApiError(404, "not_found", "Not found.")
    return match
