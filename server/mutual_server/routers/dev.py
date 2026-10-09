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

# One distinct, 3-answer persona per name in _NAMES (indices line up), so a seeded campus
# reads as ten different people rather than one answer repeated on every card. Every prompt
# in each tuple's first element is a real id from data/prompts.json; PUT /profile would
# itself require `prompts_required` (3) distinct ids, and these honour that even though the
# dev seed route writes the Profile row directly and so is not routed through that check.
_ANSWERS: list[list[tuple[str, str]]] = [
    [  # Meera
        ("looking_for", "People to study with before the panic sets in."),
        ("simple_pleasures", "Filter coffee before an early lab."),
        ("ask_me_about", "The time I got lost on campus on day one."),
    ],
    [  # Arjun
        ("geek_out", "Ask me about competitive programming and I will not stop."),
        ("typical_sunday", "Laundry, cricket highlights, then pretending to revise."),
        ("win_me_over", "Bring snacks to the group project meeting."),
    ],
    [  # Zoya
        ("irrational_fear", "Group projects where nobody responds to messages."),
        ("shower_thought", "Why do vending machines never have what I actually want."),
        ("together_we_could", "Start a campus book swap that isn't just textbooks."),
    ],
    [  # Kabir
        ("recently_discovered", "The library's third floor is always empty before 9am."),
        ("makes_my_week", "A genuinely good question in a lecture that goes nowhere."),
        ("unpopular_opinion", "Instant noodles are better the next morning, cold."),
    ],
    [  # Ishaan
        ("currently_learning", "How to not procrastinate on the thing I enjoy most."),
        ("study_ritual", "Same table, same corner, headphones even with no music on."),
        ("comfort_food", "Whatever my roommate is cooking when I walk in hungry."),
    ],
    [  # Tara
        ("go_to_song", "Something loud enough to drown out the deadline."),
        ("proud_of", "Finishing a half marathon I did zero training for."),
        ("green_flag", "Remembers small things you mentioned once in passing."),
    ],
    [  # Nila
        ("looking_for", "Someone to argue with about which café has the better filter coffee."),
        ("ask_me_about", "The time our lab experiment set off the fire alarm."),
        ("simple_pleasures", "A seat by the window on the bus back from campus."),
    ],
    [  # Sana
        ("geek_out", "Ask me about the ongoing argument in my head about fonts."),
        ("win_me_over", "Actually read the thing I recommended you."),
        ("typical_sunday", "Overambitious grocery list, half of it never gets cooked."),
    ],
    [  # Vikram
        ("irrational_fear", "Running into a professor outside of office hours."),
        ("together_we_could", "Finally use the rooftop for something other than photos."),
        ("shower_thought", "Every group chat eventually becomes just memes."),
    ],
    [  # Dev
        ("unpopular_opinion", "The canteen's filter coffee is actually underrated."),
        ("recently_discovered", "A shortcut between the two blocks nobody else uses."),
        ("makes_my_week", "Getting a seat in the library on the first try."),
    ],
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
                prompts=[{"prompt_id": p, "text": t} for p, t in _ANSWERS[n % len(_ANSWERS)]],
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
