"""Operators: the people who run a deployment (SPEC.md §11.3, §19 Q8)."""

from __future__ import annotations

import os
import re
import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

from mutual_server import security
from mutual_server.clock import Clock
from mutual_server.config import Settings
from mutual_server.ids import IdFactory
from mutual_server.models import AdminAudit, Campus, Operator

_USERNAME = re.compile(r"^[a-z0-9][a-z0-9._-]{2,39}$")


class OperatorError(ValueError):
    """A rejected operator change; the message is safe to show to an operator."""


def create(
    db: Session,
    settings: Settings,
    ids: IdFactory,
    clock: Clock,
    *,
    username: str,
    password: str,
    campus_key: str | None,
) -> Operator:
    """Add an operator. ``campus_key`` None makes an owner (all campuses)."""
    username = username.strip().lower()
    if not _USERNAME.match(username):
        raise OperatorError("Username: 3-40 characters, lowercase letters, digits, . _ -")
    if len(password) < settings.admin.password_min_length:
        raise OperatorError(
            f"Password must be at least {settings.admin.password_min_length} characters."
        )
    if db.scalar(select(Operator).where(Operator.username == username)) is not None:
        raise OperatorError("That username is taken.")
    campus_id = None
    if campus_key:
        campus = db.scalar(select(Campus).where(Campus.key == campus_key))
        if campus is None or campus.status != "open":
            raise OperatorError("A campus moderator needs an open campus.")
        campus_id = campus.id
    op = Operator(
        id=ids.new(),
        username=username,
        password_hash=security.hash_password(password),
        campus_id=campus_id,
        created_at=clock.now(),
        disabled_at=None,
    )
    db.add(op)
    db.commit()
    return op


BOOTSTRAP_USERNAME_ENV = "MUTUAL_ADMIN_USERNAME"
BOOTSTRAP_PASSWORD_ENV = "MUTUAL_ADMIN_PASSWORD"


def ensure_bootstrap_owner(db: Session, settings: Settings, ids: IdFactory, clock: Clock) -> None:
    """Create the first owner from ``MUTUAL_ADMIN_USERNAME`` / ``MUTUAL_ADMIN_PASSWORD``
    at startup (docs/DEPLOYMENT.md), so a fresh deployment has a central admin without a
    shell. Does nothing if either is unset or the operator already exists: a password
    changed later in the console is never overwritten by the environment."""
    username = os.environ.get(BOOTSTRAP_USERNAME_ENV, "").strip().lower()
    password = os.environ.get(BOOTSTRAP_PASSWORD_ENV, "")
    if not username or not password:
        return
    if db.scalar(select(Operator).where(Operator.username == username)) is not None:
        return
    create(db, settings, ids, clock, username=username, password=password, campus_key=None)
    audit(db, ids, clock, "startup", "operator_add", f"{username} (owner, from environment)")
    print(f"[admin] created owner {username!r} from the environment", file=sys.stderr)


def audit(
    db: Session, ids: IdFactory, clock: Clock, operator: str, action: str, target: str
) -> None:
    """Record one operator action. Commits."""
    db.add(
        AdminAudit(
            id=ids.new(),
            operator=operator,
            action=action,
            target=target[:253],
            created_at=clock.now(),
        )
    )
    db.commit()
