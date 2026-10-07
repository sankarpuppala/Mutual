"""AC-T3-1 / CLAUDE.md invariant 9: the server refuses study mode without written approval."""

from pathlib import Path

import pytest
from conftest import Harness, auth, login, make_settings
from mutual_protocol.encoding import b64url_encode
from mutual_protocol.keys import generate_identity_keypair

from mutual_server import config as config_module
from mutual_server.config import ConfigError
from mutual_server.models import User

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


def test_declining_consent_still_gets_an_account(make_harness, approval_file: Path) -> None:
    """SPEC §16: declining must not cost someone the use of the app (Board Q9).

    This test used to assert the opposite -- that `POST /account` returns
    `consent_required` on a study campus. That made consent the price of an account on a
    campus social app, and consent obtained that way is not freely given. The account is
    created either way; what differs is whether a `consent_version` is recorded, and a user
    without one takes no part in the study.
    """
    h: Harness = make_harness(study=APPROVED)
    _, pk = generate_identity_keypair()
    body = {"date_of_birth": "2004-05-01", "identity_pk": b64url_encode(pk), "first_name": "A"}

    token = login(h)
    r = h.client.post("/v1/account", json=body, headers=auth(token))
    assert r.status_code == 201
    with h.db() as db:
        declined = db.get(User, r.json()["user_id"])
        assert declined is not None and declined.consent_version is None

    consenting = login(h, "c@example.ac.in")
    _, pk3 = generate_identity_keypair()
    r = h.client.post(
        "/v1/account",
        json={**body, "identity_pk": b64url_encode(pk3), "consent_version": "v1"},
        headers=auth(consenting),
    )
    assert r.status_code == 201
    with h.db() as db:
        joined = db.get(User, r.json()["user_id"])
        assert joined is not None and joined.consent_version == "v1"


def test_consent_version_is_ignored_off_a_study_campus(make_harness, approval_file: Path) -> None:
    """A consent version sent from a campus with no study is not recorded as consent."""
    h: Harness = make_harness(study=APPROVED)
    other = login(h, "b@other.edu.in")
    _, pk2 = generate_identity_keypair()
    r = h.client.post(
        "/v1/account",
        json={
            "date_of_birth": "2004-05-01",
            "identity_pk": b64url_encode(pk2),
            "first_name": "A",
            "consent_version": "v1",
        },
        headers=auth(other),
    )
    assert r.status_code == 201
    with h.db() as db:
        user = db.get(User, r.json()["user_id"])
        assert user is not None and user.consent_version is None
