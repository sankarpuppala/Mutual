"""Building a PeerCard from a live profile (SPEC.md §11). Never photos, counts or times."""

from __future__ import annotations

from mutual_protocol.encoding import b64url_encode
from sqlalchemy import select
from sqlalchemy.orm import Session

from mutual_server.models import Media, Profile, User
from mutual_server.schemas import PeerCardOut, PromptAnswer


def build_peer_card(db: Session, peer: User) -> PeerCardOut:
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


def frozen_card_snapshot(user: User) -> dict[str, str]:
    """The minimal snapshot stored on a match when it ends (SPEC §6.9): no prompts."""
    return {
        "peer_id": user.id,
        "first_name": user.first_name,
        "identity_pk": b64url_encode(user.identity_pk),
    }
