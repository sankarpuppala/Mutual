"""App wiring: config route, dev routes only in dev, error format, config validation."""

from pathlib import Path

import pytest
from conftest import Harness, auth, make_settings, signup
from mutual_protocol.constants import PROTOCOL_VERSION

from mutual_server import clock as clock_module


def test_config_route(h: Harness) -> None:
    c = h.client.get("/v1/config").json()
    assert c["epoch"] == "2026-10-05" and c["reveal_policy"] == "M"
    assert c["campus"] is None and c["protocol_version"] == PROTOCOL_VERSION
    assert c["signal_upload_window"] == {"start": "18:00", "end": "23:30"}
    acct = signup(h)
    assert (
        h.client.get("/v1/config", headers=auth(acct.token)).json()["campus"]["key"]
        == "example.ac.in"
    )


def test_epoch_follows_local_midnight(h: Harness) -> None:
    h.clock.advance(hours=13, minutes=59)  # 10:00 + 13:59 = 23:59 IST
    assert h.client.get("/v1/config").json()["epoch"] == "2026-10-05"
    h.clock.advance(minutes=1)  # 00:00 IST
    assert h.client.get("/v1/config").json()["epoch"] == "2026-10-06"


def test_policy_schedule(make_harness) -> None:
    h = make_harness(
        reveal={"policy_schedule": [{"start": "2026-10-01", "end": "2026-10-14", "policy": "C"}]}
    )
    c = h.client.get("/v1/config").json()
    assert c["reveal_policy"] == "C" and c["next_policy_change"] == "2026-10-15"


def test_dev_routes_absent_outside_dev(h: Harness) -> None:
    for path in ("/v1/dev/clock", "/v1/dev/seed"):
        r = h.client.post(path, json={})
        assert r.status_code == 404 and r.json()["error"] == "not_found"


def test_dev_routes_in_dev(make_harness) -> None:
    h = make_harness(env="dev")
    assert h.client.post("/v1/dev/clock", json={"offset_seconds": 86400}).status_code == 204
    assert h.client.get("/v1/config").json()["epoch"] == "2026-10-06"
    users = h.client.post("/v1/dev/seed", json={"count": 3, "campus_key": "example.ac.in"}).json()
    assert len(users) == 3
    me = h.client.get("/v1/account/me", headers=auth(users[0]["session_token"])).json()
    assert me["campus"]["key"] == "example.ac.in" and me["profile"] is not None


def test_error_body_format(h: Harness) -> None:
    r = h.client.get("/v1/nope")
    assert r.status_code == 404 and set(r.json()) == {"error", "message"}
    r = h.client.post("/v1/auth/request-otp", json={"wrong": 1})
    assert r.status_code == 422 and r.json()["error"] == "validation_error"


def test_rejects_timezone_with_daylight_saving(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="daylight saving"):
        make_settings(tmp_path, timezone="America/New_York")


def test_prod_refuses_console_email(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="console"):
        make_settings(tmp_path, env="prod")


def test_no_datetime_now_outside_clock() -> None:
    """CLAUDE.md §6: server request-handling logic never reads the wall clock directly.

    `demo_seed.py` is deliberately excluded alongside `clock.py` itself: it is an operator
    script that runs *outside* the server process, over the live HTTP API, and drives
    `POST /dev/clock` -- which takes an offset from the server's real time. Computing that
    offset is the one place a real wall-clock read is the point, not a bug; there is no
    injected clock for a separate process to be injected with. It has no route, so it
    cannot make a response depend on anything (invariant 12).
    """
    root = Path(clock_module.__file__).parent
    excluded = {"clock.py", "demo_seed.py"}
    offenders = [
        p.name
        for p in root.rglob("*.py")
        if p.name not in excluded
        and (
            "datetime.now" in p.read_text(encoding="utf-8")
            or ".utcnow(" in p.read_text(encoding="utf-8")
        )
    ]
    assert offenders == []


def test_no_client_address_is_read() -> None:
    """CLAUDE.md invariant 5: the client's IP address is never logged or stored.

    `deps.py` is the one documented exception, added 2026-10-09 alongside the IP rate
    limiter CLAUDE.md §9 had described since before that but which nothing actually
    implemented. `check_ip_rate_limit` reads `request.client.host` and feeds it straight
    into `RateLimiter.hit`, which folds it into a BLAKE2b-keyed counter held only in this
    process's memory and discarded whole every time the salt rotates (hourly). The address
    itself is never assigned to a variable that outlives the call, never logged, never
    written to the database, and never present in any response body -- so invariant 5
    still holds; what no longer holds is the stronger, simpler guarantee this test used to
    enforce, that the string "client.host" appears nowhere in the package at all. Allowing
    it in exactly one file is the deliberate, narrow trade for having the rate limit exist.
    """
    root = Path(clock_module.__file__).parent
    excluded = {"deps.py"}
    assert [
        p.name
        for p in root.rglob("*.py")
        if p.name not in excluded and "client.host" in p.read_text(encoding="utf-8")
    ] == []


def test_integrity_error_becomes_a_uniform_409_not_a_500() -> None:
    """Phase 5 security review (low, finding 1): a duplicate-write race (two concurrent
    requests both passing a route's own "does it exist" check) hits a unique constraint
    instead; it must surface as the documented 409, never an unhandled 500."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy.exc import IntegrityError

    from mutual_server.errors import install_error_handlers

    app = FastAPI()
    install_error_handlers(app)

    @app.get("/boom")
    def boom() -> None:
        raise IntegrityError(
            "INSERT INTO x ...",
            {"secret": "should-not-appear"},
            Exception("UNIQUE constraint failed"),
        )

    with TestClient(app, raise_server_exceptions=False) as client:
        r = client.get("/boom")
    assert r.status_code == 409
    assert r.json() == {"error": "conflict", "message": "That already exists."}
    assert "should-not-appear" not in r.text  # never echoes the underlying SQL/params


def test_dev_demo_accounts_serves_only_surviving_synthetic_accounts(
    make_harness, tmp_path, monkeypatch
) -> None:
    import json

    from mutual_server.routers import dev

    h = make_harness(env="dev")
    assert h.client.get("/v1/dev/demo-accounts").status_code in (200, 404)
    seeded = h.client.post("/v1/dev/seed", json={"campus_key": "example.ac.in", "count": 2})
    users = seeded.json()
    assert [u["first_name"] for u in users] == ["Meera", "Arjun"]
    path = tmp_path / "demo_accounts.json"
    gone = {**users[1], "user_id": "00000000-0000-4000-8000-ffffffffffff"}
    path.write_text(json.dumps({"campus": "example.ac.in", "users": [users[0], gone]}))
    monkeypatch.setattr(dev, "DEMO_ACCOUNTS_FILE", path)
    r = h.client.get("/v1/dev/demo-accounts")
    assert r.status_code == 200
    assert [u["first_name"] for u in r.json()["users"]] == ["Meera"]


def test_production_example_config_is_valid(monkeypatch) -> None:
    """server/deploy/config.prod.example.yaml must load as a prod config (docs/DEPLOYMENT.md)."""
    from mutual_server.config import REPO_ROOT, load_settings

    monkeypatch.setenv("MUTUAL_ENV", "prod")
    settings = load_settings(REPO_ROOT / "server" / "deploy" / "config.prod.example.yaml")
    assert settings.env == "prod" and settings.email.mode == "smtp"
    assert settings.campuses == [] and not settings.study.enabled


def test_no_telemetry_sdk_installed() -> None:
    """Invariant 6. FastAPI depends on ``opentelemetry-api``, which is a no-op facade: it
    records and sends nothing unless an SDK and an exporter are installed. Neither may be."""
    import importlib.util

    for module in ("opentelemetry.sdk", "opentelemetry.exporter", "sentry_sdk"):
        try:
            found = importlib.util.find_spec(module) is not None
        except ModuleNotFoundError:
            found = False
        assert not found, module
