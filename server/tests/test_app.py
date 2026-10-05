"""App wiring: config route, dev routes only in dev, error format, config validation."""

from pathlib import Path

import pytest
from conftest import Harness, auth, make_settings, signup

from mutual_server import clock as clock_module


def test_config_route(h: Harness) -> None:
    c = h.client.get("/v1/config").json()
    assert c["epoch"] == "2026-10-05" and c["reveal_policy"] == "M"
    assert c["campus"] is None and c["protocol_version"] == 1
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
    root = Path(clock_module.__file__).parent
    offenders = [
        p.name
        for p in root.rglob("*.py")
        if p.name != "clock.py"
        and (
            "datetime.now" in p.read_text(encoding="utf-8")
            or ".utcnow(" in p.read_text(encoding="utf-8")
        )
    ]
    assert offenders == []


def test_no_client_address_is_read() -> None:
    root = Path(clock_module.__file__).parent
    assert [
        p.name for p in root.rglob("*.py") if "client.host" in p.read_text(encoding="utf-8")
    ] == []
