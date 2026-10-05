"""Shared test harness: in-memory SQLite, fixed clock, deterministic ids, captured emails.

Tests use the real ``mutual_protocol`` for keys (CLAUDE.md §7) and synthetic accounts only.
"""

from __future__ import annotations

import copy
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient
from mutual_protocol.eid import eid, ephemeral_private_key, new_daily_key
from mutual_protocol.encoding import b64url_encode
from mutual_protocol.encounter import encounter_token, padded_encounter_set
from mutual_protocol.keys import generate_identity_keypair
from sqlalchemy import Engine, inspect, select, text
from sqlalchemy.orm import Session

from mutual_server.clock import FixedClock
from mutual_server.config import REPO_ROOT, Settings
from mutual_server.db import Base, make_engine
from mutual_server.ids import SequentialIds
from mutual_server.main import create_app

EXAMPLE_CONFIG = REPO_ROOT / "server" / "config.example.yaml"
START = datetime(2026, 10, 5, 4, 30, tzinfo=UTC)  # 10:00 in Asia/Kolkata
EMAIL = "ananya@example.ac.in"


@dataclass
class CapturingEmail:
    sent: list[tuple[str, str]] = field(default_factory=list)

    def send_login_code(self, to: str, code: str) -> None:
        self.sent.append((to, code))

    def last_code(self) -> str:
        return self.sent[-1][1]


def _merge(base: dict[str, Any], changes: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(base)
    for k, v in changes.items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def settings_data(tmp_path: Path, **changes: Any) -> dict[str, Any]:
    data = yaml.safe_load(EXAMPLE_CONFIG.read_text(encoding="utf-8"))
    data["env"] = "test"
    data["database"] = {"url": "sqlite://"}
    data["media"]["storage_dir"] = str(tmp_path / "media")
    data["campuses"].append(
        {"key": "other.edu.in", "name": "Other College", "domains": ["other.edu.in"]}
    )
    return _merge(data, changes)


def make_settings(tmp_path: Path, **changes: Any) -> Settings:
    return Settings.model_validate(settings_data(tmp_path, **changes))


@dataclass
class Harness:
    client: TestClient
    clock: FixedClock
    email: CapturingEmail
    engine: Engine
    settings: Settings

    def db(self) -> Session:
        return Session(self.engine)

    def dump(self) -> str:
        """Every row of every table as text, to search for data that must never be stored."""
        parts = []
        with self.engine.connect() as conn:
            for table in inspect(self.engine).get_table_names():
                parts.extend(repr(tuple(r)) for r in conn.execute(text(f'SELECT * FROM "{table}"')))
        return "\n".join(parts)


@pytest.fixture
def make_harness(tmp_path: Path) -> Iterator[Callable[..., Harness]]:
    clients: list[TestClient] = []

    def factory(**changes: Any) -> Harness:
        settings = make_settings(tmp_path, **changes)
        engine = make_engine("sqlite://")
        Base.metadata.create_all(engine)
        clock, email = FixedClock(START), CapturingEmail()
        app = create_app(settings, clock=clock, ids=SequentialIds(), email=email, engine=engine)
        client = TestClient(app)
        client.__enter__()
        clients.append(client)
        return Harness(client, clock, email, engine, settings)

    yield factory
    for c in clients:
        c.__exit__(None, None, None)


@pytest.fixture
def h(make_harness: Callable[..., Harness]) -> Harness:
    return make_harness()


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def login(h: Harness, email: str = EMAIL) -> str:
    assert h.client.post("/v1/auth/request-otp", json={"email": email}).status_code == 204
    r = h.client.post("/v1/auth/verify-otp", json={"email": email, "code": h.email.last_code()})
    assert r.status_code == 200, r.text
    return r.json()["session_token"]


@dataclass
class Account:
    token: str
    user_id: str
    sk: bytes
    pk: bytes


def signup(
    h: Harness, email: str = EMAIL, dob: str = "2004-05-01", name: str = "Ananya"
) -> Account:
    token = login(h, email)
    sk, pk = generate_identity_keypair()
    r = h.client.post(
        "/v1/account",
        json={
            "date_of_birth": dob,
            "identity_pk": b64url_encode(pk),
            "first_name": name,
            "year_of_study": 3,
        },
        headers=auth(token),
    )
    assert r.status_code == 201, r.text
    return Account(token, r.json()["user_id"], sk, pk)


def campus_status(h: Harness, key: str) -> tuple[str, int] | None:
    from mutual_server.models import Campus

    with h.db() as db:
        row = db.scalar(select(Campus).where(Campus.key == key))
        return (row.status, row.attempts) if row else None


def make_shared_token(day: str, interval: int = 40) -> bytes:
    """A real encounter token (SPEC §6.13), as two independent devices would each compute it.

    Built with the real mutual_protocol, not an arbitrary random value (CLAUDE.md §7):
    the server treats encounter tokens as opaque 32-byte data either way, so what matters
    here is that the token is a genuine output of the protocol, not its provenance.
    """
    dk_a = new_daily_key()
    esk_a, id_a = ephemeral_private_key(dk_a, interval), eid(dk_a, interval)
    dk_b = new_daily_key()
    esk_b, id_b = ephemeral_private_key(dk_b, interval), eid(dk_b, interval)
    token = encounter_token(day, esk_a, id_a, id_b)
    assert token == encounter_token(day, esk_b, id_b, id_a)
    return token


def padded(real: list[bytes]) -> list[str]:
    """Base64url-encode a padded encounter set, ready for POST /presence/{day}."""
    return [b64url_encode(t) for t in padded_encounter_set(real)]
