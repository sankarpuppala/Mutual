"""Pydantic v2 request and response bodies (SPEC.md §11). No schema carries an intent (C3)."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _Out(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --- auth -------------------------------------------------------------------
class RequestOtpIn(_In):
    email: str = Field(max_length=254)


class VerifyOtpIn(_In):
    email: str = Field(max_length=254)
    code: str = Field(min_length=1, max_length=12)


class VerifyOtpOut(_Out):
    session_token: str
    account_exists: bool


# --- account ----------------------------------------------------------------
class CreateAccountIn(_In):
    date_of_birth: date
    identity_pk: str = Field(max_length=64)  # base64url, 32 bytes
    first_name: str = Field(min_length=1, max_length=200)
    year_of_study: int | None = None
    consent_version: str | None = Field(default=None, max_length=32)


class CreateAccountOut(_Out):
    user_id: str


class CampusOut(_Out):
    id: str
    key: str
    name: str


class PromptAnswer(_Out):
    prompt_id: str
    text: str
    voice_media_id: str | None = None
    waveform: list[int] | None = None


class OwnProfileOut(_Out):
    prompts: list[PromptAnswer]
    tags: list[str]
    photos: list[str]  # own photo media ids, in index order


class AccountMeOut(_Out):
    user_id: str
    first_name: str
    year_of_study: int | None
    campus: CampusOut
    discovery_paused: bool
    created_at: datetime
    profile: OwnProfileOut | None


class IdentityKeyIn(_In):
    identity_pk: str = Field(max_length=64)


# --- profile ----------------------------------------------------------------
class PromptItem(_Out):
    id: str
    text: str
    kind: str | None = None


class PromptsOut(_Out):
    looking_for: str
    prompts: list[PromptItem]


class PromptAnswerIn(_In):
    prompt_id: str = Field(max_length=40)
    text: str = Field(max_length=2000)


class PutProfileIn(_In):
    first_name: str = Field(min_length=1, max_length=200)
    year_of_study: int | None = None
    prompts: list[PromptAnswerIn]
    tags: list[str] = Field(default_factory=list)


class MediaOut(_Out):
    media_id: str


class PhotoOut(_Out):
    media_id: str
    index: int


# --- config / dev -----------------------------------------------------------
class Window(_Out):
    start: str
    end: str


class ConfigOut(_Out):
    campus: CampusOut | None
    server_time: datetime
    epoch: str
    protocol_version: int
    reveal_policy: str
    next_policy_change: str | None
    signal_upload_window: Window
    presence_upload_window: Window
    match_batch_time: str
    digest_release_time: str
    interest_ttl_days: int
    ble: dict[str, int | str]
    study_enabled: bool


class DevClockIn(_In):
    offset_seconds: float


class DevSeedIn(_In):
    count: int = Field(ge=1, le=200)
    campus_key: str


class DevSeededUser(_Out):
    user_id: str
    session_token: str
    identity_sk: str
    identity_pk: str
