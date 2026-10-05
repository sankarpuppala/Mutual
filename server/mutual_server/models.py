"""All tables from SPEC.md §12, created in the first migration even if used in later phases.

Ids are UUID strings, timestamps are aware UTC, "day"/"epoch" are local YYYY-MM-DD strings.
No column ever holds a plaintext email, a date of birth, an OTP code or a session token
(CLAUDE.md invariant 5).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from mutual_server.db import Base, UtcDateTime

ID = String(36)
DAY = String(10)
TOKEN = LargeBinary(32)


class Campus(Base):
    __tablename__ = "campuses"
    id: Mapped[str] = mapped_column(ID, primary_key=True)
    key: Mapped[str] = mapped_column(String(253), unique=True)
    name: Mapped[str | None] = mapped_column(String(120))
    domains: Mapped[list[str]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(10))  # open | pending | rejected
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(ID, primary_key=True)
    email_hmac: Mapped[str] = mapped_column(String(64), unique=True)
    campus_id: Mapped[str] = mapped_column(ForeignKey("campuses.id"))
    first_name: Mapped[str] = mapped_column(String(80))
    year_of_study: Mapped[int | None] = mapped_column(Integer)
    identity_pk: Mapped[bytes] = mapped_column(LargeBinary(32))
    identity_key_changed_at: Mapped[datetime] = mapped_column(UtcDateTime)
    age_verified_at: Mapped[datetime] = mapped_column(UtcDateTime)
    discovery_paused: Mapped[bool] = mapped_column(Boolean, default=False)
    suspended_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    deleted_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime)
    consent_version: Mapped[str | None] = mapped_column(String(32))

    __table_args__ = (
        # SPEC §6.5: a public key may belong to only one non-deleted account.
        Index(
            "uq_users_identity_pk_live",
            "identity_pk",
            unique=True,
            sqlite_where=text("deleted_at IS NULL"),
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_users_campus", "campus_id"),
    )


class OtpCode(Base):
    __tablename__ = "otp_codes"
    email_hmac: Mapped[str] = mapped_column(String(64), primary_key=True)
    campus_id: Mapped[str] = mapped_column(ForeignKey("campuses.id"))
    code_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(UtcDateTime)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_sent_at: Mapped[datetime] = mapped_column(UtcDateTime)


class SessionRow(Base):
    __tablename__ = "sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    email_hmac: Mapped[str] = mapped_column(String(64))
    campus_id: Mapped[str] = mapped_column(ForeignKey("campuses.id"))
    expires_at: Mapped[datetime] = mapped_column(UtcDateTime)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime)


class Profile(Base):
    __tablename__ = "profiles"
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    prompts: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    tags: Mapped[list[str]] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime)


class Media(Base):
    __tablename__ = "media"
    id: Mapped[str] = mapped_column(ID, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(8))  # voice | photo
    prompt_id: Mapped[str | None] = mapped_column(String(40))
    photo_index: Mapped[int | None] = mapped_column(Integer)
    path: Mapped[str] = mapped_column(String(80))  # file name inside media.storage_dir
    bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    waveform: Mapped[list[int] | None] = mapped_column(JSON)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime)
    __table_args__ = (Index("ix_media_user", "user_id"),)


class PresenceUpload(Base):
    __tablename__ = "presence_uploads"
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    day: Mapped[str] = mapped_column(DAY, primary_key=True)
    uploaded_at: Mapped[datetime] = mapped_column(UtcDateTime)


class Encounter(Base):
    __tablename__ = "encounters"
    day: Mapped[str] = mapped_column(DAY, primary_key=True)
    token: Mapped[bytes] = mapped_column(TOKEN, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    __table_args__ = (Index("ix_encounters_day_token", "day", "token"),)


class Crossing(Base):
    __tablename__ = "crossings"
    day: Mapped[str] = mapped_column(DAY, primary_key=True)
    user_lo: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    user_hi: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    token: Mapped[bytes] = mapped_column(TOKEN)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime)


class SignalUpload(Base):
    __tablename__ = "signal_uploads"
    epoch: Mapped[str] = mapped_column(DAY, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    uploaded_at: Mapped[datetime] = mapped_column(UtcDateTime)


class EpochToken(Base):
    __tablename__ = "epoch_tokens"
    epoch: Mapped[str] = mapped_column(DAY, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    token: Mapped[bytes] = mapped_column(TOKEN, primary_key=True)
    __table_args__ = (Index("ix_epoch_tokens_epoch_token", "epoch", "token"),)


class Match(Base):
    __tablename__ = "matches"
    id: Mapped[str] = mapped_column(ID, primary_key=True)
    # Nullable so an "ended" match can outlive a deleted account for the other party (§6.9).
    user_lo: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    user_hi: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_epoch: Mapped[str] = mapped_column(DAY)
    policy: Mapped[str] = mapped_column(String(1))  # M | C
    revealed_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    ended_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    ended_by: Mapped[str | None] = mapped_column(ID)
    frozen_card: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    ended_seen_by_other_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    __table_args__ = (
        Index(
            "uq_matches_active_pair",
            "user_lo",
            "user_hi",
            unique=True,
            sqlite_where=text("ended_at IS NULL"),
            postgresql_where=text("ended_at IS NULL"),
        ),
    )


class MatchToken(Base):
    __tablename__ = "match_tokens"
    match_id: Mapped[str] = mapped_column(
        ForeignKey("matches.id", ondelete="CASCADE"), primary_key=True
    )
    token: Mapped[bytes] = mapped_column(TOKEN, primary_key=True)
    epoch: Mapped[str] = mapped_column(DAY)
    notify_after: Mapped[datetime] = mapped_column(UtcDateTime)


class RevealConsent(Base):
    __tablename__ = "reveal_consents"
    match_id: Mapped[str] = mapped_column(
        ForeignKey("matches.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(ID, primary_key=True)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(ID, primary_key=True)
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"))
    sender_id: Mapped[str] = mapped_column(ID)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime)
    __table_args__ = (Index("ix_messages_match", "match_id", "created_at"),)


class Block(Base):
    __tablename__ = "blocks"
    blocker_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    blocked_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(UtcDateTime)


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[str] = mapped_column(ID, primary_key=True)
    reporter_id: Mapped[str] = mapped_column(ID)
    reported_id: Mapped[str] = mapped_column(ID)
    reason: Mapped[str] = mapped_column(String(32))
    excerpt: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(12))  # open | resolved
    created_at: Mapped[datetime] = mapped_column(UtcDateTime)
    resolved_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
