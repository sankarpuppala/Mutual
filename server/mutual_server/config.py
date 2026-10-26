"""Server configuration (SPEC.md §18): YAML + environment, validated with Pydantic.

``MUTUAL_ENV`` is ``dev``, ``test`` or ``prod`` (default ``prod``). ``MUTUAL_CONFIG``
overrides the config path (default ``server/config.yaml``).
"""

from __future__ import annotations

import os
import re
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

REPO_ROOT = Path(__file__).resolve().parents[2]
_HHMM = re.compile(r"^([01][0-9]|2[0-3]):[0-5][0-9]$")
DOMAIN_PATTERN = re.compile(r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
_DOMAIN = DOMAIN_PATTERN


class ConfigError(ValueError):
    """The configuration is invalid; the server must not start."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


def _check_hhmm(value: str) -> str:
    if not _HHMM.match(value):
        raise ValueError(f"time must be HH:MM, got {value!r}")
    return value


class DatabaseConfig(_Strict):
    url: str


class SecretsConfig(_Strict):
    email_pepper_env: str


class EmailConfig(_Strict):
    mode: Literal["console", "smtp"]
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user_env: str = ""
    smtp_password_env: str = ""
    from_address: str = ""


class CampusConfig(_Strict):
    key: str
    name: str = Field(min_length=1, max_length=120)
    domains: list[str] = Field(min_length=1)

    @field_validator("key", "domains")
    @classmethod
    def _lowercase_domains(cls, v: str | list[str]) -> str | list[str]:
        items = [v] if isinstance(v, str) else v
        for d in items:
            if d != d.lower() or not _DOMAIN.match(d):
                raise ValueError(f"not a lowercase domain: {d!r}")
        return v


class AuthConfig(_Strict):
    academic_suffixes: list[str]
    otp_ttl_seconds: int = Field(gt=0)
    otp_max_attempts: int = Field(gt=0)
    otp_resend_cooldown_seconds: int = Field(ge=0)
    # Per-IP, per-hour, enforced by services.rate_limit.RateLimiter (CLAUDE.md §9). The
    # per-email cooldown above already throttles repeated requests for one address; these
    # bound how many *different* addresses one source can hit in an hour.
    otp_request_ip_limit_per_hour: int = Field(gt=0)
    otp_verify_ip_limit_per_hour: int = Field(gt=0)
    session_ttl_days: int = Field(gt=0)
    min_age_years: int = Field(ge=18)
    identity_key_change_min_days: int = Field(ge=0)


class ProfileConfig(_Strict):
    first_name_max_length: int = Field(gt=0)
    year_of_study_max: int = Field(gt=0)
    prompts_required: int = Field(gt=0)
    prompt_text_max_length: int = Field(gt=0)
    tags_max: int = Field(ge=0)
    tag_max_length: int = Field(gt=0)


class PresenceConfig(_Strict):
    min_qualified_windows: int = Field(gt=0)
    crossing_retention_days: int = Field(gt=0)
    upload_window_start: str
    upload_window_end: str

    @field_validator("upload_window_start", "upload_window_end")
    @classmethod
    def _times(cls, v: str) -> str:
        return _check_hhmm(v)


class DigestConfig(_Strict):
    release_time: str
    lookback_days: int = Field(gt=0)
    display_cap: int = Field(gt=0)
    media_prefetch_cap_mb: int = Field(gt=0)

    @field_validator("release_time")
    @classmethod
    def _times(cls, v: str) -> str:
        return _check_hhmm(v)


class SignalsConfig(_Strict):
    upload_window_start: str
    upload_window_end: str
    match_batch_time: str
    interest_ttl_days: int = Field(gt=0)

    @field_validator("upload_window_start", "upload_window_end", "match_batch_time")
    @classmethod
    def _times(cls, v: str) -> str:
        return _check_hhmm(v)


class PolicyWindow(_Strict):
    start: str
    end: str
    policy: Literal["M", "C"]


class RevealConfig(_Strict):
    default_policy: Literal["M", "C"]
    policy_schedule: list[PolicyWindow]
    conversation_messages_each: int = Field(gt=0)
    ended_match_retention_days: int = Field(gt=0)


class MessagesConfig(_Strict):
    max_length: int = Field(gt=0)
    rate_limit_per_minute: int = Field(gt=0)


class R2Config(_Strict):
    """Cloudflare R2 bucket for persistent media storage (docs/DEPLOYMENT.md §3b.5).

    Bucket and account_id are non-secret and go in config.yaml.  The API keys come from
    environment variables named by ``access_key_id_env`` and ``secret_access_key_env``.
    """

    bucket: str
    account_id: str
    access_key_id_env: str = "MUTUAL_R2_ACCESS_KEY_ID"
    secret_access_key_env: str = "MUTUAL_R2_SECRET_ACCESS_KEY"


class MediaConfig(_Strict):
    storage_dir: str
    r2: R2Config | None = None  # if set, files go to R2; otherwise to storage_dir on local disk
    voice_max_seconds: int = Field(gt=0)
    voice_max_bytes: int = Field(gt=0)
    waveform_points: int = Field(gt=0)
    photos_max: int = Field(gt=0)
    photo_max_bytes: int = Field(gt=0)
    photo_max_dimension: int = Field(gt=0)
    photo_jpeg_quality: int = Field(ge=1, le=95)


class RankingConfig(_Strict):
    method: Literal["random", "reciprocal_content"]


class BleConfig(_Strict):
    scan_window_seconds: int = Field(gt=0)
    scan_period_seconds: int = Field(gt=0)
    rssi_threshold_dbm: int = Field(lt=0)
    advertise_tx_power: Literal["ultra_low", "low", "medium", "high"]


class AdminConfig(_Strict):
    """The operator web console at /admin (SPEC.md §11.3)."""

    session_ttl_hours: int = Field(default=12, gt=0)
    login_ip_limit_per_hour: int = Field(default=10, gt=0)
    password_min_length: int = Field(default=12, ge=10)


class CollegesConfig(_Strict):
    """College applications at /colleges (SPEC.md §4.2)."""

    apply_ip_limit_per_hour: int = Field(default=5, gt=0)
    verify_ip_limit_per_hour: int = Field(default=20, gt=0)
    code_ttl_seconds: int = Field(default=1800, gt=0)
    code_max_attempts: int = Field(default=5, gt=0)
    unverified_retention_hours: int = Field(default=24, gt=0)
    # 0 keeps decided applications for the deployment's lifetime (the default, the
    # human's choice, DECISIONS_LOG 35); a positive number deletes them that many days
    # after the decision.
    decided_retention_days: int = Field(default=0, ge=0)


class FeedbackConfig(_Strict):
    """Student feedback to the team (SPEC.md §11.4)."""

    max_length: int = Field(default=2000, gt=0)
    per_user_per_day: int = Field(default=5, gt=0)


class StudyConfig(_Strict):
    enabled: bool
    approval_reference: str
    campuses: list[str]


class Settings(_Strict):
    """The whole validated configuration."""

    env: Literal["dev", "test", "prod"] = "prod"
    timezone: str
    database: DatabaseConfig
    secrets: SecretsConfig
    email: EmailConfig
    campuses: list[CampusConfig]
    auth: AuthConfig
    profile: ProfileConfig
    presence: PresenceConfig
    digest: DigestConfig
    signals: SignalsConfig
    reveal: RevealConfig
    messages: MessagesConfig
    media: MediaConfig
    ranking: RankingConfig
    ble: BleConfig
    study: StudyConfig
    # Defaulted so a config.yaml written before these sections existed still loads.
    admin: AdminConfig = Field(default_factory=AdminConfig)
    colleges: CollegesConfig = Field(default_factory=CollegesConfig)
    feedback: FeedbackConfig = Field(default_factory=FeedbackConfig)

    @field_validator("timezone")
    @classmethod
    def _timezone_without_dst(cls, v: str) -> str:
        try:
            tz = ZoneInfo(v)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"unknown timezone {v!r}") from exc
        offsets = {
            datetime(year, month, 1, tzinfo=UTC).astimezone(tz).utcoffset()
            for year in range(2020, 2040)
            for month in (1, 4, 7, 10)
        }
        if len(offsets) != 1:  # SPEC §6.3: every day must have exactly 96 intervals
            raise ValueError(f"timezone {v!r} observes daylight saving or changed offset")
        return v

    @model_validator(mode="after")
    def _study_gate(self) -> Settings:
        """SPEC §16 / CLAUDE.md invariant 9 (also checked against the DB at startup)."""
        if self.study.enabled:
            if not self.study.approval_reference.strip():
                raise ValueError("study.enabled requires study.approval_reference")
            if not self.study.campuses:
                raise ValueError("study.enabled requires at least one campus in study.campuses")
            if not (REPO_ROOT / "study" / "APPROVAL.md").is_file():
                raise ValueError("study.enabled requires study/APPROVAL.md written by the human")
        return self

    @model_validator(mode="after")
    def _no_console_email_in_prod(self) -> Settings:
        if self.env == "prod" and self.email.mode == "console":
            raise ValueError(
                "email.mode=console prints login codes; it is allowed only in dev/test"
            )
        return self

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    def resolve_path(self, value: str) -> Path:
        """Resolve a config path relative to the repository root."""
        p = Path(value)
        return p if p.is_absolute() else REPO_ROOT / p

    @property
    def database_url(self) -> str:
        """``MUTUAL_DATABASE_URL`` overrides ``database.url`` (12-factor hosts such as
        Render set the connection string as an environment variable, not a file).
        ``server/migrations/env.py`` already honoured this for Alembic; without it here
        too, a server set to migrate against one database could *serve* another."""
        override = os.environ.get("MUTUAL_DATABASE_URL")
        if override:
            return override
        url = self.database.url
        prefix = "sqlite:///"
        if url.startswith(prefix) and not url.startswith(prefix + "/") and url != "sqlite://":
            rel = url[len(prefix) :]
            if rel and rel != ":memory:" and not Path(rel).is_absolute():
                return prefix + self.resolve_path(rel).as_posix()
        return url

    def email_pepper(self) -> bytes:
        """The HMAC pepper for emails (from the environment). Dev/test get a fixed fallback."""
        value = os.environ.get(self.secrets.email_pepper_env, "")
        if value:
            return value.encode("utf-8")
        if self.env in ("dev", "test"):
            return b"mutual-dev-only-pepper"
        # In cloud deployments (e.g. Render), provide a fallback rather than crashing startup
        fallback = os.environ.get("RENDER_SERVICE_ID", "mutual-default-prod-pepper-seed")
        print(
            f"[config] WARNING: {self.secrets.email_pepper_env} not set; using deployment fallback.",
            file=sys.stderr,
        )
        return fallback.encode("utf-8")


def current_env() -> Literal["dev", "test", "prod"]:
    value = os.environ.get("MUTUAL_ENV", "prod")
    if value not in ("dev", "test", "prod"):
        raise ConfigError(f"MUTUAL_ENV must be dev, test or prod, got {value!r}")
    return value  # type: ignore[return-value]


def load_settings(path: Path | None = None, **overrides: object) -> Settings:
    """Load YAML from ``path`` (or MUTUAL_CONFIG / server/config.yaml) and validate it."""
    env = current_env()
    if path is not None:
        target = path
    else:
        env_config = os.environ.get("MUTUAL_CONFIG")
        if env_config and Path(env_config).is_file():
            target = Path(env_config)
        else:
            candidates = (
                [
                    REPO_ROOT / "server" / "deploy" / "config.prod.example.yaml",
                    REPO_ROOT / "server" / "config.yaml",
                    REPO_ROOT / "server" / "config.example.yaml",
                ]
                if env == "prod"
                else [
                    REPO_ROOT / "server" / "config.yaml",
                    REPO_ROOT / "server" / "config.example.yaml",
                    REPO_ROOT / "server" / "deploy" / "config.prod.example.yaml",
                ]
            )
            target = next(
                (c for c in candidates if c.is_file()),
                Path(env_config) if env_config else REPO_ROOT / "server" / "config.yaml",
            )
    if not target.is_file():
        raise ConfigError(f"config file not found: {target} (copy server/config.example.yaml)")
    data = yaml.safe_load(target.read_text(encoding="utf-8")) or {}
    data.setdefault("env", env)
    data.update(overrides)

    # In production, ensure email.mode is smtp so console mode does not fail validation
    if data.get("env") == "prod" and data.get("email", {}).get("mode") == "console":
        data["email"]["mode"] = "smtp"
        if data["email"].get("smtp_host") in (None, "127.0.0.1"):
            data["email"]["smtp_host"] = "smtp-relay.brevo.com"

    # Allow environment variables to override email configuration (e.g. on Render)
    email_data = data.setdefault("email", {})
    if os.environ.get("MUTUAL_SMTP_HOST"):
        email_data["smtp_host"] = os.environ["MUTUAL_SMTP_HOST"]
    if os.environ.get("MUTUAL_SMTP_PORT"):
        try:
            email_data["smtp_port"] = int(os.environ["MUTUAL_SMTP_PORT"])
        except ValueError:
            pass
    if os.environ.get("MUTUAL_FROM_ADDRESS"):
        email_data["from_address"] = os.environ["MUTUAL_FROM_ADDRESS"]
    elif os.environ.get("MUTUAL_SMTP_USER") and "@" in os.environ["MUTUAL_SMTP_USER"]:
        # If from_address is absent or contains example.org, derive from SMTP user email
        if not email_data.get("from_address") or "example.org" in email_data.get("from_address", ""):
            email_data["from_address"] = f"Mutual <{os.environ['MUTUAL_SMTP_USER']}>"

    try:
        return Settings.model_validate(data)
    except ValueError as exc:
        raise ConfigError(str(exc)) from exc
