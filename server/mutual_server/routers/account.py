"""POST /account, GET /account/me, PUT /account/identity-key, DELETE /account (SPEC.md §11).

The date of birth is used once for the 18+ check and never stored or logged (S1, D11).
"""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Response
from mutual_protocol.encoding import ProtocolError, b64url_decode
from mutual_protocol.keys import is_valid_public_key
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from mutual_server.clock import local_now
from mutual_server.deps import AppContext, current_session, current_user, get_ctx, get_db
from mutual_server.errors import ApiError
from mutual_server.models import Campus, Match, MatchToken, Media, Profile, SessionRow, User
from mutual_server.schemas import (
    AccountMeOut,
    CampusOut,
    CreateAccountIn,
    CreateAccountOut,
    IdentityKeyIn,
    OwnProfileOut,
    PromptAnswer,
)
from mutual_server.services.matching import end_match, sync_matches

router = APIRouter(prefix="/account", tags=["account"])


def _age_on(dob: date, today: date) -> int:
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def parse_identity_key(value: str, db: Session, exclude_user: str | None = None) -> bytes:
    """Decode and validate a public key (SPEC §6.5), including uniqueness among live accounts."""
    try:
        pk = b64url_decode(value)
    except ProtocolError as exc:
        raise ApiError(422, "invalid_identity_key", "Invalid identity key.") from exc
    if not is_valid_public_key(pk):
        raise ApiError(422, "invalid_identity_key", "Invalid identity key.")
    query = select(User.id).where(User.identity_pk == pk)
    if exclude_user is not None:
        query = query.where(User.id != exclude_user)
    if db.scalar(query) is not None:
        raise ApiError(409, "identity_key_taken", "This identity key is already registered.")
    return pk


def check_name_and_year(first_name: str, year: int | None, ctx: AppContext) -> str:
    name = " ".join(first_name.split())
    if not name or len(name) > ctx.settings.profile.first_name_max_length:
        raise ApiError(422, "invalid_first_name", "Enter your first name.")
    if year is not None and not 1 <= year <= ctx.settings.profile.year_of_study_max:
        raise ApiError(422, "invalid_year", "Year of study is out of range.")
    return name


@router.post("", response_model=CreateAccountOut, status_code=201)
def create_account(
    body: CreateAccountIn,
    session: SessionRow = Depends(current_session),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> CreateAccountOut:
    if session.user_id is not None:
        raise ApiError(409, "account_exists", "You already have an account.")
    today = local_now(ctx.clock, ctx.settings.tz).date()
    if body.date_of_birth > today:
        raise ApiError(422, "invalid_date_of_birth", "Check your date of birth.")
    if _age_on(body.date_of_birth, today) < ctx.settings.auth.min_age_years:
        raise ApiError(
            403,
            "underage",
            f"Mutual is for people {ctx.settings.auth.min_age_years} and over. "
            "Thank you for understanding.",
        )
    campus = db.get(Campus, session.campus_id)
    if campus is None or campus.status != "open":
        raise ApiError(403, "campus_not_open", "Mutual isn't open at your college yet.")
    study_here = ctx.settings.study.enabled and campus.key in ctx.settings.study.campuses
    # No consent gate here, deliberately (SPEC §16, Board Q9). Declining must not cost
    # someone the use of a campus social app: consent given to get an account is not freely
    # given, and an ethics committee would be right to say so. A user with no
    # `consent_version` has the ordinary app and appears in no study outcome.
    name = check_name_and_year(body.first_name, body.year_of_study, ctx)
    pk = parse_identity_key(body.identity_pk, db)

    now = ctx.clock.now()
    user = User(
        id=ctx.ids.new(),
        email_hmac=session.email_hmac,
        campus_id=campus.id,
        first_name=name,
        year_of_study=body.year_of_study,
        identity_pk=pk,
        identity_key_changed_at=now,
        age_verified_at=now,
        discovery_paused=False,
        created_at=now,
        consent_version=body.consent_version if study_here else None,
    )
    db.add(user)
    db.flush()
    db.get(SessionRow, session.token_hash).user_id = user.id  # type: ignore[union-attr]
    db.commit()
    return CreateAccountOut(user_id=user.id)


def own_profile(db: Session, user: User) -> OwnProfileOut | None:
    profile = db.get(Profile, user.id)
    if profile is None:
        return None
    media = list(db.scalars(select(Media).where(Media.user_id == user.id)))
    voice = {m.prompt_id: m for m in media if m.kind == "voice"}
    photos = sorted((m for m in media if m.kind == "photo"), key=lambda m: m.photo_index or 0)
    return OwnProfileOut(
        prompts=[
            PromptAnswer(
                prompt_id=p["prompt_id"],
                text=p["text"],
                voice_media_id=voice[p["prompt_id"]].id if p["prompt_id"] in voice else None,
                waveform=voice[p["prompt_id"]].waveform if p["prompt_id"] in voice else None,
            )
            for p in profile.prompts
        ],
        tags=profile.tags,
        photos=[m.id for m in photos],
    )


@router.get("/me", response_model=AccountMeOut)
def me(user: User = Depends(current_user), db: Session = Depends(get_db)) -> AccountMeOut:
    campus = db.get(Campus, user.campus_id)
    assert campus is not None
    return AccountMeOut(
        user_id=user.id,
        first_name=user.first_name,
        year_of_study=user.year_of_study,
        campus=CampusOut(id=campus.id, key=campus.key, name=campus.name or campus.key),
        discovery_paused=user.discovery_paused,
        created_at=user.created_at,
        profile=own_profile(db, user),
    )


@router.put("/identity-key", status_code=204)
def change_identity_key(
    body: IdentityKeyIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    now = ctx.clock.now()
    min_gap = timedelta(days=ctx.settings.auth.identity_key_change_min_days)
    if now - user.identity_key_changed_at < min_gap:
        raise ApiError(429, "too_soon", "The identity key was changed recently.")
    user.identity_pk = parse_identity_key(body.identity_pk, db, exclude_user=user.id)
    user.identity_key_changed_at = now
    db.commit()
    return Response(status_code=204)


@router.delete("", status_code=202)
def delete_account(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    """S11: sessions revoked immediately; every row and media file hard-deleted now (within
    the 24-hour bound the spec allows). Active matches end first, each leaving the other
    party "This person has left" (§6.9's frozen-card mechanism) — a pending (not yet
    notified) match's tokens are untouched here and are dropped later by the ordinary
    release step, which treats this account's absence exactly like a block (§6.9)."""
    sync_matches(db, ctx.clock, ctx.settings, ctx.ids)

    active = db.scalars(
        select(Match).where(
            Match.ended_at.is_(None), (Match.user_lo == user.id) | (Match.user_hi == user.id)
        )
    ).all()
    for match in active:
        has_notified = db.execute(
            select(MatchToken.token).where(
                MatchToken.match_id == match.id, MatchToken.notified.is_(True)
            )
        ).first()
        if has_notified is not None:
            end_match(db, ctx.clock, match, ended_by=user)

    for item in db.scalars(select(Media).where(Media.user_id == user.id)):
        ctx.media_store.remove(item.path)

    db.execute(delete(SessionRow).where(SessionRow.user_id == user.id))
    db.delete(user)  # cascades profile/media rows/presence/crossings/blocks; Match FKs SET NULL
    db.commit()
    return Response(status_code=202)
