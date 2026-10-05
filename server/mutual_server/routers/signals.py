"""PUT /signals/{epoch} (SPEC.md §11, §6.7, §6.9, §6.11).

Only stores the uploaded set. Matching runs later, once, in the nightly batch
(``services.matching``) — never inside this request (CLAUDE.md invariant 12).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from mutual_protocol.constants import SIGNAL_SET_SIZE, TOKEN_BYTES
from mutual_protocol.encoding import ProtocolError, b64url_decode
from sqlalchemy.orm import Session

from mutual_server.clock import at_local, local_day
from mutual_server.deps import AppContext, current_user, get_ctx, get_db
from mutual_server.errors import ApiError
from mutual_server.models import EpochToken, SignalUpload, User
from mutual_server.schemas import SignalsUploadIn

router = APIRouter(tags=["signals"])


def _parse_tokens(raw: list[str]) -> list[bytes]:
    if len(raw) != SIGNAL_SET_SIZE:
        raise ApiError(422, "invalid_tokens", f"Send exactly {SIGNAL_SET_SIZE} tokens.")
    tokens: list[bytes] = []
    for item in raw:
        try:
            token = b64url_decode(item)
        except ProtocolError as exc:
            raise ApiError(422, "invalid_tokens", "Invalid token.") from exc
        if len(token) != TOKEN_BYTES:
            raise ApiError(422, "invalid_tokens", "Invalid token.")
        tokens.append(token)
    if len(set(tokens)) != len(tokens):
        raise ApiError(422, "invalid_tokens", "Duplicate token.")
    return tokens


@router.put("/signals/{epoch}", status_code=201)
def upload_signals(
    epoch: str,
    body: SignalsUploadIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    tz = ctx.settings.tz
    today = local_day(ctx.clock, tz)
    if epoch != today:
        raise ApiError(400, "invalid_epoch", "You can only upload for the current epoch.")
    window_start = at_local(epoch, ctx.settings.signals.upload_window_start, tz)
    if ctx.clock.now() < window_start:
        raise ApiError(425, "too_early", "The signal upload window hasn't opened yet.")
    batch_time = at_local(epoch, ctx.settings.signals.match_batch_time, tz)
    if ctx.clock.now() >= batch_time:
        raise ApiError(400, "window_closed", "Tonight's signals have already gone out.")
    if db.get(SignalUpload, (epoch, user.id)) is not None:
        raise ApiError(409, "already_uploaded", "Already uploaded for this epoch.")

    tokens = _parse_tokens(body.tokens)
    db.add(SignalUpload(epoch=epoch, user_id=user.id, uploaded_at=ctx.clock.now()))
    for token in tokens:
        db.add(EpochToken(epoch=epoch, user_id=user.id, token=token))
    db.commit()
    return Response(status_code=201)
