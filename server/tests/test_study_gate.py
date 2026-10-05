"""AC-T3-1 / CLAUDE.md invariant 9: the server refuses study mode without written approval."""

from pathlib import Path

import pytest
from conftest import Harness, auth, login, make_settings
from mutual_protocol.encoding import b64url_encode
from mutual_protocol.keys import generate_identity_keypair

from mutual_server import config as config_module
from mutual_server.config import ConfigError

APPROVED = {"enabled": True, "approval_reference": "IEC/2026/042", "campuses": ["example.ac.in"]}


@pytest.fixture
def approval_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    (tmp_path / "study").mkdir()
    (tmp_path / "study" / "APPROVAL.md").write_text("approved", encoding="utf-8")
    monkeypatch.setattr(config_module, "REPO_ROOT", tmp_path)
    return tmp_path


def test_study_disabled_starts(tmp_path: Path) -> None:
    assert make_settings(tmp_path).study.enabled is False


def test_refuses_without_approval_reference(tmp_path: Path, approval_file: Path) -> None:
    with pytest.raises(ValueError, match="approval_reference"):
        make_settings(tmp_path, study={**APPROVED, "approval_reference": " "})


def test_refuses_without_approval_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config_module, "REPO_ROOT", tmp_path)  # no study/APPROVAL.md here
    with pytest.raises(ValueError, match="APPROVAL.md"):
        make_settings(tmp_path, study=APPROVED)


def test_refuses_without_campuses(tmp_path: Path, approval_file: Path) -> None:
    with pytest.raises(ValueError, match="campus"):
        make_settings(tmp_path, study={**APPROVED, "campuses": []})


def test_refuses_to_start_when_study_campus_is_not_open(make_harness, approval_file: Path) -> None:
    with pytest.raises(ConfigError, match="not open"):
        make_harness(study={**APPROVED, "campuses": ["nowhere.ac.in"]})


def test_consent_required_only_on_study_campus(make_harness, approval_file: Path) -> None:
    h: Harness = make_harness(study=APPROVED)
    _, pk = generate_identity_keypair()
    body = {"date_of_birth": "2004-05-01", "identity_pk": b64url_encode(pk), "first_name": "A"}
    token = login(h)
    r = h.client.post("/v1/account", json=body, headers=auth(token))
    assert r.status_code == 422 and r.json()["error"] == "consent_required"
    assert (
        h.client.post(
            "/v1/account", json={**body, "consent_version": "v1"}, headers=auth(token)
        ).status_code
        == 201
    )
    other = login(h, "b@other.edu.in")
    _, pk2 = generate_identity_keypair()
    assert (
        h.client.post(
            "/v1/account", json={**body, "identity_pk": b64url_encode(pk2)}, headers=auth(other)
        ).status_code
        == 201
    )
