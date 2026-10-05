"""POST /blocks, /reports, /discovery/pause, /discovery/resume (SPEC.md §11, S4-S6).

Both /blocks and /reports act only on an id the caller actually knows — currently in
their digest window, or a notified match — and return the same 204 either way, so the
response itself never reveals whether an id was known (CLAUDE.md invariant 10).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from mutual_server.clock import Clock
from mutual_server.config import Settings
from mutual_server.deps import AppContext, current_user, get_ctx, get_db, synced_matches
from mutual_server.models import Block, Crossing, Match, Message, Report, User
from mutual_server.schemas import BlockIn, ReportIn
from mutual_server.services.digest import visible_peers
from mutual_server.services.matching import end_match, notified_tokens

router = APIRouter(tags=["safety"], dependencies=[Depends(synced_matches)])


def _notified_match_between(db: Session, a: str, b: str) -> Match | None:
    lo, hi = sorted((a, b))
    match = db.execute(
        select(Match).where(Match.user_lo == lo, Match.user_hi == hi)
    ).scalar_one_or_none()
    if match is None or not notified_tokens(db, match.id):
        return None
    return match


def _is_known_peer(db: Session, clock: Clock, settings: Settings, user: User, peer_id: str) -> bool:
    _, entries = visible_peers(db, clock, settings, user)
    if peer_id in {e["peer_id"] for e in entries}:
        return True
    return _notified_match_between(db, user.id, peer_id) is not None


@router.post("/blocks", status_code=204)
def post_block(
    body: BlockIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    peer_id = body.peer_id
    if peer_id != user.id and _is_known_peer(db, ctx.clock, ctx.settings, user, peer_id):
        if db.get(Block, (user.id, peer_id)) is None:
            db.add(Block(blocker_id=user.id, blocked_id=peer_id, created_at=ctx.clock.now()))
        lo, hi = sorted((user.id, peer_id))
        db.execute(delete(Crossing).where(Crossing.user_lo == lo, Crossing.user_hi == hi))  # S4
        match = _notified_match_between(db, user.id, peer_id)
        if match is not None and match.ended_at is None:
            end_match(db, ctx.clock, match, ended_by=user)
        db.commit()
    return Response(status_code=204)


@router.post("/reports", status_code=204)
def post_report(
    body: ReportIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    peer_id = body.peer_id
    if peer_id != user.id and _is_known_peer(db, ctx.clock, ctx.settings, user, peer_id):
        lo, hi = sorted((user.id, peer_id))
        excerpt = []
        if body.message_ids:
            rows = db.scalars(
                select(Message)
                .join(Match, Match.id == Message.match_id)
                .where(
                    Message.id.in_(body.message_ids[:10]),
                    Match.user_lo == lo,
                    Match.user_hi == hi,
                )
                .order_by(Message.created_at)
            ).all()
            excerpt = [
                {"sender_id": m.sender_id, "body": m.body, "created_at": m.created_at.isoformat()}
                for m in rows
            ]
        db.add(
            Report(
                id=ctx.ids.new(),
                reporter_id=user.id,
                reported_id=peer_id,
                reason=body.reason,
                excerpt=excerpt,
                status="open",
                created_at=ctx.clock.now(),
                resolved_at=None,
            )
        )
        db.commit()
    return Response(status_code=204)


@router.post("/discovery/pause", status_code=204)
def pause_discovery(user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    user.discovery_paused = True
    db.commit()
    return Response(status_code=204)


@router.post("/discovery/resume", status_code=204)
def resume_discovery(user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    user.discovery_paused = False
    db.commit()
    return Response(status_code=204)
