"""GET /prompts, PUT /profile, voice and photo uploads (SPEC.md §11 Profile).

The voice and photo routes act only on the caller's own media (own-resource routes,
allowlisted in the Phase 5 route audit).
"""

from __future__ import annotations

import base64
import json
from functools import lru_cache
from importlib import resources

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from mutual_server.deps import AppContext, current_user, get_ctx, get_db
from mutual_server.errors import ApiError
from mutual_server.models import Media, Profile, User
from mutual_server.routers.account import check_name_and_year
from mutual_server.schemas import MediaOut, PhotoOut, PromptsOut, PutProfileIn
from mutual_server.services import media as media_service

router = APIRouter(tags=["profile"])


@lru_cache(maxsize=1)
def prompt_library() -> PromptsOut:
    text = resources.files("mutual_server").joinpath("data/prompts.json").read_text("utf-8")
    return PromptsOut.model_validate(json.loads(text))


@router.get("/prompts", response_model=PromptsOut)
def get_prompts() -> PromptsOut:
    return prompt_library()


@router.put("/profile", status_code=204)
def put_profile(
    body: PutProfileIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    cfg = ctx.settings.profile
    library = prompt_library()
    known = {p.id for p in library.prompts}
    ids = [p.prompt_id for p in body.prompts]
    if len(ids) != cfg.prompts_required or len(set(ids)) != len(ids):
        raise ApiError(
            422, "invalid_prompts", f"Answer exactly {cfg.prompts_required} different prompts."
        )
    if not set(ids) <= known:
        raise ApiError(422, "invalid_prompts", "Unknown prompt.")
    if library.looking_for not in ids:
        raise ApiError(422, "looking_for_required", 'One answer must be "I\'m looking for".')
    answers = []
    for p in body.prompts:
        text = p.text.strip()
        if not text or len(text) > cfg.prompt_text_max_length:
            raise ApiError(
                422,
                "invalid_answer",
                f"Each answer needs 1 to {cfg.prompt_text_max_length} characters.",
            )
        answers.append({"prompt_id": p.prompt_id, "text": text})
    tags = [" ".join(t.split()) for t in body.tags]
    if len(tags) > cfg.tags_max or any(not t or len(t) > cfg.tag_max_length for t in tags):
        raise ApiError(
            422, "invalid_tags", f"Up to {cfg.tags_max} tags of {cfg.tag_max_length} characters."
        )

    user.first_name = check_name_and_year(body.first_name, body.year_of_study, ctx)
    user.year_of_study = body.year_of_study
    now = ctx.clock.now()
    profile = db.get(Profile, user.id)
    if profile is None:
        db.add(Profile(user_id=user.id, prompts=answers, tags=tags, updated_at=now))
    else:
        profile.prompts, profile.tags, profile.updated_at = answers, tags, now
    # Voice notes for prompts that are no longer answered are removed.
    for m in db.scalars(select(Media).where(Media.user_id == user.id, Media.kind == "voice")):
        if m.prompt_id not in ids:
            ctx.media_store.remove(m.path)
            db.delete(m)
    db.commit()
    return Response(status_code=204)


async def _read_limited(upload: UploadFile, limit: int) -> bytes:
    data = await upload.read(limit + 1)
    if len(data) > limit:
        raise ApiError(413, "too_large", "That file is too large.")
    return data


@router.post("/profile/voice/{prompt_id}", response_model=MediaOut, status_code=201)
async def upload_voice(
    prompt_id: str,
    audio: UploadFile = File(...),
    waveform: str = Form(...),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> MediaOut:
    profile = db.get(Profile, user.id)
    if profile is None or prompt_id not in {p["prompt_id"] for p in profile.prompts}:
        raise ApiError(422, "prompt_not_in_profile", "Add this prompt to your profile first.")
    raw = await _read_limited(audio, ctx.settings.media.voice_max_bytes)
    try:
        seconds = media_service.voice_duration_seconds(raw)
        points = media_service.check_waveform(json.loads(waveform), ctx.settings.media)
    except (media_service.MediaError, json.JSONDecodeError) as exc:
        raise ApiError(
            422,
            "invalid_voice",
            str(exc) if isinstance(exc, media_service.MediaError) else "Invalid waveform.",
        ) from exc
    if seconds > ctx.settings.media.voice_max_seconds:
        raise ApiError(
            422,
            "voice_too_long",
            f"Voice notes can be up to {ctx.settings.media.voice_max_seconds} seconds.",
        )

    old = db.scalar(
        select(Media).where(
            Media.user_id == user.id, Media.kind == "voice", Media.prompt_id == prompt_id
        )
    )
    if old is not None:
        ctx.media_store.remove(old.path)
        db.delete(old)
    media_id = ctx.ids.new()
    name = f"{media_id}.m4a"
    size, digest = ctx.media_store.store(name, raw)
    db.add(
        Media(
            id=media_id,
            user_id=user.id,
            kind="voice",
            prompt_id=prompt_id,
            path=name,
            bytes=size,
            sha256=digest,
            waveform=points,
            duration_ms=round(seconds * 1000),
            created_at=ctx.clock.now(),
        )
    )
    db.commit()
    return MediaOut(media_id=media_id)


@router.delete("/profile/voice/{prompt_id}", status_code=204)
def delete_voice(
    prompt_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    row = db.scalar(
        select(Media).where(
            Media.user_id == user.id, Media.kind == "voice", Media.prompt_id == prompt_id
        )
    )
    if row is None:
        raise ApiError(404, "not_found", "No voice note for this prompt.")
    ctx.media_store.remove(row.path)
    db.delete(row)
    db.commit()
    return Response(status_code=204)


def _photos(db: Session, user: User) -> list[Media]:
    rows = db.scalars(select(Media).where(Media.user_id == user.id, Media.kind == "photo"))
    return sorted(rows, key=lambda m: m.photo_index or 0)


@router.post("/profile/photos", response_model=PhotoOut, status_code=201)
async def upload_photo(
    request: Request,
    image: UploadFile | None = File(None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> PhotoOut:
    existing = _photos(db, user)
    if len(existing) >= ctx.settings.media.photos_max:
        raise ApiError(
            409, "photos_full", f"You can add up to {ctx.settings.media.photos_max} photos."
        )
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        body = await request.json()
        b64_data = body.get("data") or body.get("image") or ""
        if "," in b64_data:
            b64_data = b64_data.split(",", 1)[1]
        try:
            raw = base64.b64decode(b64_data)
        except Exception as exc:
            raise ApiError(422, "invalid_photo", "Invalid base64 image data.") from exc
        if len(raw) > ctx.settings.media.photo_max_bytes:
            raise ApiError(413, "too_large", "That file is too large.")
    elif image is not None:
        raw = await _read_limited(image, ctx.settings.media.photo_max_bytes)
    else:
        form = await request.form()
        image_field = form.get("image")
        if isinstance(image_field, UploadFile):
            raw = await _read_limited(image_field, ctx.settings.media.photo_max_bytes)
        else:
            raise ApiError(422, "invalid_photo", "No image provided.")
    try:
        clean = media_service.clean_photo(raw, ctx.settings.media)
    except media_service.MediaError as exc:
        raise ApiError(422, "invalid_photo", str(exc)) from exc
    media_id = ctx.ids.new()
    name = f"{media_id}.jpg"
    size, digest = ctx.media_store.store(name, clean)
    index = len(existing)
    db.add(
        Media(
            id=media_id,
            user_id=user.id,
            kind="photo",
            photo_index=index,
            path=name,
            bytes=size,
            sha256=digest,
            created_at=ctx.clock.now(),
        )
    )
    db.commit()
    return PhotoOut(media_id=media_id, index=index)


@router.get("/profile/photos", response_model=list[PhotoOut])
def list_photos(
    user: User = Depends(current_user), db: Session = Depends(get_db)
) -> list[PhotoOut]:
    photos = _photos(db, user)
    return [PhotoOut(media_id=m.id, index=m.photo_index or i) for i, m in enumerate(photos)]


@router.get("/profile/photos/{index}")
def get_own_photo(
    index: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    photos = _photos(db, user)
    if not 0 <= index < len(photos):
        raise ApiError(404, "not_found", "No photo at this position.")
    data = ctx.media_store.read(photos[index].path)
    return Response(content=data, media_type="image/jpeg")


@router.delete("/profile/photos/{index}", status_code=204)
def delete_photo(
    index: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    ctx: AppContext = Depends(get_ctx),
) -> Response:
    photos = _photos(db, user)
    if not 0 <= index < len(photos):
        raise ApiError(404, "not_found", "No photo at this position.")
    target = photos[index]
    ctx.media_store.remove(target.path)
    db.delete(target)
    for i, m in enumerate(p for p in photos if p.id != target.id):
        m.photo_index = i
    db.commit()
    return Response(status_code=204)
