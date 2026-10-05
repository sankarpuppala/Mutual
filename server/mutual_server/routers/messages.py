"""GET/POST /matches/{id}/messages (SPEC.md §11, S3). Text only; no chat once ended."""

from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from mutual_server.deps import AppContext, current_user, get_ctx, get_db, synced_matches
from mutual_server.errors import ApiError
from mutual_server.models import MatchRead, Message, User
from mutual_server.schemas import MessageIn, MessageOut
from mutual_server.services.matching import get_active_match, maybe_reveal_policy_c

router = APIRouter(tags=["messages"], dependencies=[Depends(synced_matches)])


@router.get("/matches/{match_id}/messages", response_model=list[MessageOut])
def get_messages(
    match_id: str,
    after: datetime | None = Query(None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> list[MessageOut]:
    get_active_match(match_id, user, db)
    query = select(Message).where(Message.match_id == match_id)
    if after is not None:
        query = query.where(Message.created_at > after)
    rows = db.scalars(query.order_by(Message.created_at)).all()

    read_row = db.get(MatchRead, (match_id, user.id))
    now = ctx.clock.now()
    if read_row is None:
        db.add(MatchRead(match_id=match_id, user_id=user.id, read_at=now))
    else:
        read_row.read_at = now
    db.commit()
    return [
        MessageOut(message_id=r.id, sender_id=r.sender_id, body=r.body, created_at=r.created_at)
        for r in rows
    ]


@router.post("/matches/{match_id}/messages", response_model=MessageOut, status_code=201)
def post_message(
    match_id: str,
    body: MessageIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> MessageOut:
    match = get_active_match(match_id, user, db)
    text = body.body.strip()
    if not text or len(text) > ctx.settings.messages.max_length:
        raise ApiError(
            422,
            "invalid_message",
            f"Messages are 1 to {ctx.settings.messages.max_length} characters.",
        )

    now = ctx.clock.now()
    one_minute_ago = now - timedelta(minutes=1)
    recent_count = len(
        db.execute(
            select(Message.id).where(
                Message.sender_id == user.id, Message.created_at > one_minute_ago
            )
        ).all()
    )
    if recent_count >= ctx.settings.messages.rate_limit_per_minute:
        raise ApiError(429, "rate_limited", "Slow down a little.")

    message = Message(
        id=ctx.ids.new(), match_id=match_id, sender_id=user.id, body=text, created_at=now
    )
    db.add(message)
    maybe_reveal_policy_c(db, ctx.clock, ctx.settings, match)
    db.commit()
    return MessageOut(
        message_id=message.id,
        sender_id=message.sender_id,
        body=message.body,
        created_at=message.created_at,
    )
