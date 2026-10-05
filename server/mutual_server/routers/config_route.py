"""GET /config (SPEC.md §11). Clients take the current epoch from here, never their own clock."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends
from mutual_protocol.constants import PROTOCOL_VERSION
from sqlalchemy.orm import Session

from mutual_server.clock import local_day
from mutual_server.config import Settings
from mutual_server.deps import AppContext, get_ctx, get_db, optional_session
from mutual_server.models import Campus, SessionRow
from mutual_server.schemas import CampusOut, ConfigOut, Window

router = APIRouter(tags=["config"])


def policy_for_day(settings: Settings, day: str) -> tuple[str, str | None]:
    """The reveal policy active on ``day`` and the next date it changes (SPEC §11.2)."""
    d = date.fromisoformat(day)
    active = settings.reveal.default_policy
    upcoming: list[str] = []
    for w in settings.reveal.policy_schedule:
        start, end = date.fromisoformat(w.start), date.fromisoformat(w.end)
        if start <= d <= end:
            active = w.policy
            upcoming.append(date.fromordinal(end.toordinal() + 1).isoformat())
        elif start > d:
            upcoming.append(w.start)
    return active, (min(upcoming) if upcoming else None)


@router.get("/config", response_model=ConfigOut)
def get_config(
    session: SessionRow | None = Depends(optional_session),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> ConfigOut:
    s = ctx.settings
    epoch = local_day(ctx.clock, s.tz)
    policy, next_change = policy_for_day(s, epoch)
    campus = db.get(Campus, session.campus_id) if session is not None else None
    return ConfigOut(
        campus=CampusOut(id=campus.id, key=campus.key, name=campus.name or campus.key)
        if campus
        else None,
        server_time=ctx.clock.now(),
        epoch=epoch,
        protocol_version=PROTOCOL_VERSION,
        reveal_policy=policy,
        next_policy_change=next_change,
        signal_upload_window=Window(
            start=s.signals.upload_window_start, end=s.signals.upload_window_end
        ),
        presence_upload_window=Window(
            start=s.presence.upload_window_start, end=s.presence.upload_window_end
        ),
        match_batch_time=s.signals.match_batch_time,
        digest_release_time=s.digest.release_time,
        interest_ttl_days=s.signals.interest_ttl_days,
        ble=s.ble.model_dump(),
        study_enabled=bool(campus and s.study.enabled and campus.key in s.study.campuses),
    )
