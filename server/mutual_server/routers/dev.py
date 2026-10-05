"""/dev/* routes — mounted only when MUTUAL_ENV=dev (CLAUDE.md invariant 11).

Synthetic users only (CLAUDE.md invariant 9).
"""

from __future__ import annotations

import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, Response
from mutual_protocol.encoding import b64url_encode
from mutual_protocol.keys import generate_identity_keypair
from sqlalchemy import select
from sqlalchemy.orm import Session

from mutual_server import security
from mutual_server.deps import AppContext, get_ctx, get_db
from mutual_server.errors import ApiError
from mutual_server.models import Campus, Crossing, Profile, SessionRow, User
from mutual_server.schemas import DevClockIn, DevCrossingIn, DevSeededUser, DevSeedIn

router = APIRouter(prefix="/dev", tags=["dev"])

_NAMES = ["Meera", "Arjun", "Zoya", "Kabir", "Ishaan", "Tara", "Nila", "Sana", "Vikram", "Dev"]
_ANSWERS = [
    ("looking_for", "People to study with before the panic sets in."),
    ("simple_pleasures", "Filter coffee before an early lab."),
    ("ask_me_about", "The time I got lost on campus on day one."),
]


@router.post("/clock", status_code=204)
def set_clock(body: DevClockIn, ctx: AppContext = Depends(get_ctx)) -> None:
    ctx.clock.offset_seconds = body.offset_seconds


@router.post("/seed", response_model=list[DevSeededUser], status_code=201)
def seed(
    body: DevSeedIn, db: Session = Depends(get_db), ctx: AppContext = Depends(get_ctx)
) -> list[DevSeededUser]:
    campus = db.scalar(select(Campus).where(Campus.key == body.campus_key, Campus.status == "open"))
    if campus is None:
        raise ApiError(404, "not_found", "No open campus with that key.")
    now = ctx.clock.now()
    out = []
    for n in range(body.count):
        user_id = ctx.ids.new()
        email = f"synthetic-{user_id}@{campus.domains[0]}"
        sk, pk = generate_identity_keypair()
        db.add(
            User(
                id=user_id,
                email_hmac=security.email_hmac(email, ctx.pepper),
                campus_id=campus.id,
                first_name=_NAMES[n % len(_NAMES)],
                year_of_study=1 + n % 4,
                identity_pk=pk,
                identity_key_changed_at=now - timedelta(days=365),
                age_verified_at=now,
                discovery_paused=False,
                created_at=now,
            )
        )
        db.flush()  # the user row must exist before rows that reference it
        db.add(
            Profile(
                user_id=user_id,
                prompts=[{"prompt_id": p, "text": t} for p, t in _ANSWERS],
                tags=[],
                updated_at=now,
            )
        )
        token, token_hash = security.new_session_token()
        db.add(
            SessionRow(
                token_hash=token_hash,
                user_id=user_id,
                email_hmac="synthetic",
                campus_id=campus.id,
                expires_at=now + timedelta(days=30),
                created_at=now,
            )
        )
        out.append(
            DevSeededUser(
                user_id=user_id,
                session_token=token,
                identity_sk=b64url_encode(sk),
                identity_pk=b64url_encode(pk),
            )
        )
    db.commit()
    return out


@router.post("/crossing", status_code=201)
def dev_crossing(
    body: DevCrossingIn, db: Session = Depends(get_db), ctx: AppContext = Depends(get_ctx)
) -> Response:
    """Simulate a confirmed crossing directly, bypassing the presence/BLE pipeline."""
    user_a, user_b = db.get(User, body.user_a), db.get(User, body.user_b)
    if user_a is None or user_b is None:
        raise ApiError(404, "not_found", "No such user.")
    if user_a.campus_id != user_b.campus_id:
        raise ApiError(422, "cross_campus", "Both users must be on the same campus.")
    day = body.day.isoformat()
    lo, hi = sorted((user_a.id, user_b.id))
    row = db.get(Crossing, (day, lo, hi))
    token = secrets.token_bytes(32)
    if row is None:
        db.add(Crossing(day=day, user_lo=lo, user_hi=hi, token=token, created_at=ctx.clock.now()))
    else:
        row.token = token
    db.commit()
    return Response(status_code=201)
