"""POST /auth/request-otp, /auth/verify-otp, /auth/logout (SPEC.md §11, §4.1, §9)."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from mutual_server import security
from mutual_server.deps import AppContext, current_session, get_ctx, get_db
from mutual_server.errors import ApiError
from mutual_server.models import OtpCode, SessionRow, User
from mutual_server.schemas import RequestOtpIn, VerifyOtpIn, VerifyOtpOut
from mutual_server.services import campus as campus_service

router = APIRouter(prefix="/auth", tags=["auth"])

_INVALID_CODE = ApiError(
    400, "invalid_code", "That code didn't work. Check it or ask for a new one."
)


@router.post("/request-otp", status_code=204)
def request_otp(
    body: RequestOtpIn, db: Session = Depends(get_db), ctx: AppContext = Depends(get_ctx)
) -> Response:
    try:
        email, domain = security.normalize_email(body.email)
    except security.InvalidEmail as exc:
        raise ApiError(400, "not_a_college_email", "Use your college email address.") from exc

    resolution = campus_service.resolve(db, domain, ctx.settings, ctx.ids, ctx.clock)
    if resolution.status == "not_college":
        raise ApiError(400, "not_a_college_email", "Use your college email address.")
    if resolution.status == "pending":
        raise ApiError(403, "campus_not_open", "Mutual isn't open at your college yet.")
    assert resolution.campus is not None

    now = ctx.clock.now()
    email_hash = security.email_hmac(email, ctx.pepper)
    row = db.get(OtpCode, email_hash)
    cooldown = timedelta(seconds=ctx.settings.auth.otp_resend_cooldown_seconds)
    if row is not None and now - row.last_sent_at < cooldown:
        return Response(status_code=204)  # silent cooldown (SPEC §11)

    code = security.new_otp()
    fields = {
        "campus_id": resolution.campus.id,
        "code_hash": security.otp_hash(code, email_hash, ctx.pepper),
        "expires_at": now + timedelta(seconds=ctx.settings.auth.otp_ttl_seconds),
        "attempts": 0,
        "last_sent_at": now,
    }
    if row is None:
        db.add(OtpCode(email_hmac=email_hash, **fields))
    else:
        for k, v in fields.items():
            setattr(row, k, v)
    db.commit()
    ctx.email.send_login_code(email, code)
    return Response(status_code=204)


@router.post("/verify-otp", response_model=VerifyOtpOut)
def verify_otp(
    body: VerifyOtpIn, db: Session = Depends(get_db), ctx: AppContext = Depends(get_ctx)
) -> VerifyOtpOut:
    try:
        email, _ = security.normalize_email(body.email)
    except security.InvalidEmail as exc:
        raise _INVALID_CODE from exc
    email_hash = security.email_hmac(email, ctx.pepper)
    now = ctx.clock.now()
    row = db.get(OtpCode, email_hash)
    if row is None or row.expires_at <= now:
        if row is not None:
            db.delete(row)
            db.commit()
        raise _INVALID_CODE
    if row.attempts >= ctx.settings.auth.otp_max_attempts:
        db.delete(row)
        db.commit()
        raise ApiError(429, "too_many_attempts", "Too many tries. Ask for a new code.")
    if not security.otp_matches(body.code.strip(), email_hash, row.code_hash, ctx.pepper):
        row.attempts += 1
        db.commit()
        raise _INVALID_CODE

    campus_id = row.campus_id
    db.delete(row)
    user = db.scalar(select(User).where(User.email_hmac == email_hash))
    if user is not None and user.suspended_at is not None:
        db.commit()
        raise ApiError(403, "account_suspended", "This account is suspended.")
    token, token_hash = security.new_session_token()
    db.add(
        SessionRow(
            token_hash=token_hash,
            user_id=user.id if user else None,
            email_hmac=email_hash,
            campus_id=user.campus_id if user else campus_id,
            expires_at=now + timedelta(days=ctx.settings.auth.session_ttl_days),
            created_at=now,
        )
    )
    db.commit()
    return VerifyOtpOut(session_token=token, account_exists=user is not None)


@router.post("/logout", status_code=204)
def logout(
    session: SessionRow = Depends(current_session), db: Session = Depends(get_db)
) -> Response:
    row = db.get(SessionRow, session.token_hash)
    if row is not None:
        db.delete(row)
        db.commit()
    return Response(status_code=204)
