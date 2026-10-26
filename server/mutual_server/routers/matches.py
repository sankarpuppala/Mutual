"""GET /matches, GET /matches/{id}/photos/{index}, POST /matches/{id}/reveal-consent,
DELETE /matches/{id} (SPEC.md §11, §6.9, §11.2).

Any match id that does not exist, is not the caller's, or carries no notified token
gets the same 404 on every one of these routes (SPEC §11) — enforced by
``services.matching.get_active_match``, used by every route below except the list.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from mutual_protocol.encoding import b64url_encode
from sqlalchemy import select
from sqlalchemy.orm import Session

from mutual_server.config import Settings
from mutual_server.deps import AppContext, current_user, get_ctx, get_db, synced_matches
from mutual_server.errors import ApiError
from mutual_server.models import Match, MatchRead, Media, Message, RevealConsent, User
from mutual_server.schemas import MatchedTokenOut, MatchOut, PeerCardOut, RevealOut
from mutual_server.services.cards import build_peer_card
from mutual_server.services.matching import (
    end_match,
    get_active_match,
    maybe_reveal_policy_c,
    notified_tokens,
)

router = APIRouter(tags=["matches"], dependencies=[Depends(synced_matches)])


def _reveal(match: Match, settings: Settings) -> RevealOut:
    revealed = match.revealed_at is not None
    needed = None
    if match.policy == "C" and not revealed:
        needed = settings.reveal.conversation_messages_each
    return RevealOut(
        state="revealed" if revealed else "pending",
        policy=match.policy,
        messages_needed_each=needed,
    )


def _unread(db: Session, match_id: str, viewer_id: str) -> bool:
    read_row = db.get(MatchRead, (match_id, viewer_id))
    last_read = read_row.read_at if read_row is not None else None
    query = select(Message.id).where(Message.match_id == match_id, Message.sender_id != viewer_id)
    if last_read is not None:
        query = query.where(Message.created_at > last_read)
    return db.execute(query).first() is not None


@router.get("/matches", response_model=list[MatchOut])
def list_matches(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> list[MatchOut]:
    out: list[MatchOut] = []

    active = db.scalars(
        select(Match).where(
            Match.ended_at.is_(None), (Match.user_lo == user.id) | (Match.user_hi == user.id)
        )
    ).all()
    for match in sorted(active, key=lambda m: (m.created_epoch, m.id)):
        notified = notified_tokens(db, match.id)
        if not notified:
            continue
        peer_id = match.user_hi if match.user_lo == user.id else match.user_lo
        peer = db.get(User, peer_id)
        if peer is None:
            continue  # defensive: an active match always has both live users
        out.append(
            MatchOut(
                match_id=match.id,
                state="active",
                peer=build_peer_card(db, peer),
                matched=[
                    MatchedTokenOut(epoch=t.epoch, token=b64url_encode(t.token)) for t in notified
                ],
                created_epoch=match.created_epoch,
                reveal=_reveal(match, ctx.settings),
                unread=_unread(db, match.id, user.id),
            )
        )

    ended = db.scalars(
        select(Match).where(
            Match.ended_at.is_not(None),
            Match.ended_by != user.id,
            (Match.user_lo == user.id) | (Match.user_hi == user.id),
        )
    ).all()
    for match in sorted(ended, key=lambda m: (m.created_epoch, m.id)):
        notified = notified_tokens(db, match.id)
        card = match.frozen_card or {}
        out.append(
            MatchOut(
                match_id=match.id,
                state="ended",
                peer=PeerCardOut(
                    peer_id=card.get("peer_id", ""),
                    first_name=card.get("first_name", ""),
                    year_of_study=None,
                    identity_pk=card.get("identity_pk", ""),
                    prompts=[],
                ),
                matched=[
                    MatchedTokenOut(epoch=t.epoch, token=b64url_encode(t.token)) for t in notified
                ],
                created_epoch=match.created_epoch,
                reveal=_reveal(match, ctx.settings),
                unread=False,
            )
        )
        db.delete(match)  # delivered once (SPEC §6.9: "until... fetched or 30 days pass")
    if ended:
        db.commit()

    return out


@router.get("/matches/{match_id}/photos/{index}")
def get_match_photo(
    match_id: str,
    index: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    match = get_active_match(match_id, user, db)
    if match.revealed_at is None:
        raise ApiError(404, "not_found", "Not found.")
    peer_id = match.user_hi if match.user_lo == user.id else match.user_lo
    photo = db.execute(
        select(Media).where(
            Media.user_id == peer_id, Media.kind == "photo", Media.photo_index == index
        )
    ).scalar_one_or_none()
    if photo is None:
        raise ApiError(404, "not_found", "Not found.")
    data = ctx.media_store.read(photo.path)
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={"Content-Disposition": f'attachment; filename="{photo.path}"'},
    )


@router.post("/matches/{match_id}/reveal-consent", status_code=204)
def post_reveal_consent(
    match_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    match = get_active_match(match_id, user, db)
    if match.policy != "C":
        raise ApiError(400, "wrong_policy", "Reveal consent only applies to policy C.")
    if db.get(RevealConsent, (match_id, user.id)) is None:
        db.add(RevealConsent(match_id=match_id, user_id=user.id))
        db.flush()
    maybe_reveal_policy_c(db, ctx.clock, ctx.settings, match)
    db.commit()
    return Response(status_code=204)


@router.delete("/matches/{match_id}", status_code=204)
def unmatch(
    match_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    match = get_active_match(match_id, user, db)
    end_match(db, ctx.clock, match, ended_by=user)
    db.commit()
    return Response(status_code=204)
