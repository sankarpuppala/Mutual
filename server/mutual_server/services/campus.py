"""Campuses: one server, many colleges, each a closed partition (SPEC.md §4.1)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from mutual_server.clock import Clock
from mutual_server.config import Settings
from mutual_server.ids import IdFactory
from mutual_server.models import Campus


@dataclass(frozen=True)
class Resolution:
    status: Literal["open", "pending", "not_college"]
    campus: Campus | None = None


def _covers(domain: str, listed: str) -> bool:
    return domain == listed or domain.endswith("." + listed)


def academic_key(domain: str, suffixes: list[str]) -> str | None:
    """``cse.iitb.ac.in`` → ``iitb.ac.in`` for suffix ``ac.in`` (longest suffix wins)."""
    for suffix in sorted(suffixes, key=len, reverse=True):
        if domain.endswith("." + suffix):
            head = domain[: -len(suffix) - 1]
            if head:
                return head.rsplit(".", 1)[-1] + "." + suffix
    return None


def seed_config_campuses(db: Session, settings: Settings, ids: IdFactory, clock: Clock) -> None:
    """Make every campus listed in the config exist and be open."""
    for c in settings.campuses:
        row = db.scalar(select(Campus).where(Campus.key == c.key))
        if row is None:
            db.add(
                Campus(
                    id=ids.new(),
                    key=c.key,
                    name=c.name,
                    domains=list(c.domains),
                    status="open",
                    attempts=0,
                    created_at=clock.now(),
                )
            )
        else:
            row.name, row.domains, row.status = c.name, list(c.domains), "open"
    db.commit()


def resolve(
    db: Session, domain: str, settings: Settings, ids: IdFactory, clock: Clock
) -> Resolution:
    """Map an email domain to its campus, recording an attempt for an unknown academic domain."""
    best: Campus | None = None
    best_len = -1
    for campus in db.scalars(select(Campus).where(Campus.status == "open")):
        for listed in campus.domains:
            if _covers(domain, listed) and len(listed) > best_len:
                best, best_len = campus, len(listed)
    if best is not None:
        return Resolution("open", best)

    key = academic_key(domain, settings.auth.academic_suffixes)
    if key is None:
        return Resolution("not_college")
    row = db.scalar(select(Campus).where(Campus.key == key))
    if row is None:
        row = Campus(
            id=ids.new(),
            key=key,
            name=None,
            domains=[key],
            status="pending",
            attempts=0,
            created_at=clock.now(),
        )
        db.add(row)
    if row.status == "rejected":
        return Resolution("not_college")
    row.attempts += 1
    db.commit()
    return Resolution("pending", row)


def approve(db: Session, key: str, name: str, ids: IdFactory, clock: Clock) -> Campus:
    """Open a campus (operator action via the admin CLI)."""
    row = db.scalar(select(Campus).where(Campus.key == key))
    if row is None:
        row = Campus(
            id=ids.new(),
            key=key,
            name=name,
            domains=[key],
            status="open",
            attempts=0,
            created_at=clock.now(),
        )
        db.add(row)
    row.name, row.status = name, "open"
    if key not in row.domains:
        row.domains = [*row.domains, key]
    db.commit()
    return row


def reject(db: Session, key: str) -> None:
    row = db.scalar(select(Campus).where(Campus.key == key))
    if row is None:
        raise KeyError(key)
    row.status = "rejected"
    db.commit()
