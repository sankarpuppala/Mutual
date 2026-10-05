"""POST /presence/{day} (SPEC.md §11, §6.13).

The server never sees a daily key, an EID, RSSI or a sighting time — only the padded,
secret-keyed encounter-token set (CLAUDE.md invariant 1).
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Response
from mutual_protocol.constants import ENCOUNTER_BYTES, ENCOUNTER_MAX_ENTRIES, ENCOUNTER_PAD_BLOCK
from mutual_protocol.encoding import ProtocolError, b64url_decode
from sqlalchemy.orm import Session

from mutual_server.clock import add_days, at_local, local_day
from mutual_server.deps import AppContext, current_user, get_ctx, get_db
from mutual_server.errors import ApiError
from mutual_server.models import PresenceUpload, User
from mutual_server.schemas import PresenceUploadIn
from mutual_server.services.resolution import process_presence_upload

router = APIRouter(tags=["presence"])


def _parse_tokens(raw: list[str]) -> list[bytes]:
    n = len(raw)
    if n == 0 or n % ENCOUNTER_PAD_BLOCK != 0 or n > ENCOUNTER_MAX_ENTRIES:
        raise ApiError(
            422,
            "invalid_encounters",
            f"Send a positive multiple of {ENCOUNTER_PAD_BLOCK}, up to {ENCOUNTER_MAX_ENTRIES}.",
        )
    tokens: list[bytes] = []
    for item in raw:
        try:
            token = b64url_decode(item)
        except ProtocolError as exc:
            raise ApiError(422, "invalid_encounters", "Invalid encounter token.") from exc
        if len(token) != ENCOUNTER_BYTES:
            raise ApiError(422, "invalid_encounters", "Invalid encounter token.")
        tokens.append(token)
    if len(set(tokens)) != len(tokens):
        raise ApiError(422, "invalid_encounters", "Duplicate encounter token.")
    return tokens


@router.post("/presence/{day}", status_code=201)
def upload_presence(
    day: str,
    body: PresenceUploadIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    tz = ctx.settings.tz
    try:
        date.fromisoformat(day)
    except ValueError as exc:
        raise ApiError(400, "invalid_day", "Not a valid day.") from exc

    today = local_day(ctx.clock, tz)
    if day >= today:
        raise ApiError(400, "invalid_day", "You can only upload a day that has already ended.")
    cutoff = at_local(add_days(day, 2), "00:00", tz)
    if ctx.clock.now() >= cutoff:
        raise ApiError(400, "past_cutoff", "It's too late to upload for that day.")
    if db.get(PresenceUpload, (user.id, day)) is not None:
        raise ApiError(409, "already_uploaded", "Already uploaded for that day.")

    tokens = _parse_tokens(body.encounters)
    db.add(PresenceUpload(user_id=user.id, day=day, uploaded_at=ctx.clock.now()))
    process_presence_upload(db, ctx.clock, user, day, tokens)
    return Response(status_code=201)
