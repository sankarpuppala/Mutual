"""GET /digest, GET /media/{media_id} (SPEC.md §11).

PeerCard never carries photos, counts or times. GET /media serves only the voice notes
of peers currently in the viewer's digest window, with a uniform 404 otherwise, whether
or not the id exists (no account-existence oracle).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from mutual_protocol.encoding import b64url_encode
from sqlalchemy import select
from sqlalchemy.orm import Session

from mutual_server.deps import AppContext, current_user, get_ctx, get_db
from mutual_server.errors import ApiError
from mutual_server.models import Media, Profile, User
from mutual_server.schemas import (
    DigestMediaOut,
    DigestOut,
    DigestPeerOut,
    PeerCardOut,
    PromptAnswer,
)
from mutual_server.services.digest import visible_peers

router = APIRouter(tags=["digest"])


def _peer_card(db: Session, peer: User) -> PeerCardOut:
    profile = db.get(Profile, peer.id)
    prompts = profile.prompts if profile is not None else []
    voice = {
        m.prompt_id: m
        for m in db.scalars(select(Media).where(Media.user_id == peer.id, Media.kind == "voice"))
    }
    return PeerCardOut(
        peer_id=peer.id,
        first_name=peer.first_name,
        year_of_study=peer.year_of_study,
        identity_pk=b64url_encode(peer.identity_pk),
        prompts=[
            PromptAnswer(
                prompt_id=p["prompt_id"],
                text=p["text"],
                voice_media_id=voice[p["prompt_id"]].id if p["prompt_id"] in voice else None,
                waveform=voice[p["prompt_id"]].waveform if p["prompt_id"] in voice else None,
            )
            for p in prompts
        ],
    )


@router.get("/digest", response_model=DigestOut)
def get_digest(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> DigestOut:
    release_day, entries = visible_peers(db, ctx.clock, ctx.settings, user)
    peers: list[DigestPeerOut] = []
    media_ids: set[str] = set()
    for entry in entries:
        peer = db.get(User, entry["peer_id"])
        if peer is None:
            continue
        card = _peer_card(db, peer)
        media_ids.update(p.voice_media_id for p in card.prompts if p.voice_media_id)
        peers.append(
            DigestPeerOut(
                card=card,
                last_day=entry["last_day"],
                encounter=b64url_encode(bytes.fromhex(entry["token"])),
            )
        )
    media_rows = db.scalars(select(Media).where(Media.id.in_(media_ids))) if media_ids else []
    media = sorted(
        (DigestMediaOut(media_id=m.id, bytes=m.bytes, sha256=m.sha256) for m in media_rows),
        key=lambda m: m.media_id,
    )
    return DigestOut(release_day=release_day, peers=peers, media=media)


@router.get("/media/{media_id}")
def get_media(
    media_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> FileResponse:
    _, entries = visible_peers(db, ctx.clock, ctx.settings, user)
    allowed = {e["peer_id"] for e in entries}
    media = db.get(Media, media_id)
    if media is None or media.kind != "voice" or media.user_id not in allowed:
        raise ApiError(404, "not_found", "Not found.")
    return FileResponse(ctx.media_dir / media.path, media_type="audio/mp4", filename=media.path)
