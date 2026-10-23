"""POST /feedback — a student's message to the Mutual team (SPEC.md §11.4).

User-initiated and about the app, never about a person: it carries no peer id, and its
existence depends only on the student pressing Send (invariant 1). Read by operators in
/admin → Feedback, scoped by campus like reports.
"""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mutual_server.deps import AppContext, current_user, get_ctx, get_db
from mutual_server.errors import ApiError
from mutual_server.models import Feedback, User
from mutual_server.schemas import FeedbackIn

router = APIRouter(tags=["feedback"])


@router.post("/feedback", status_code=204)
def send_feedback(
    body: FeedbackIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    text = body.body.strip()
    if not text:
        raise ApiError(422, "validation_error", "invalid fields: body")
    if len(text) > ctx.settings.feedback.max_length:
        raise ApiError(
            413, "too_large", f"Keep it under {ctx.settings.feedback.max_length} characters."
        )
    now = ctx.clock.now()
    recent = db.scalar(
        select(func.count()).where(
            Feedback.user_id == user.id, Feedback.created_at > now - timedelta(days=1)
        )
    )
    if (recent or 0) >= ctx.settings.feedback.per_user_per_day:
        raise ApiError(429, "rate_limited", "Thanks — that's plenty for today. Try again tomorrow.")
    db.add(
        Feedback(
            id=ctx.ids.new(),
            user_id=user.id,
            campus_id=user.campus_id,
            category=body.category,
            body=text,
            status="new",
            created_at=now,
        )
    )
    db.commit()
    return Response(status_code=204)
