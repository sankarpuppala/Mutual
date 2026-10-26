"""Tests for the MediaStore backends (DiskStore, R2Store, make_store)."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from mutual_server.config import Settings
from mutual_server.services.media import DiskStore, R2Store, make_store

# ---------------------------------------------------------------------------
# DiskStore
# ---------------------------------------------------------------------------


def test_disk_store_roundtrip(tmp_path: Path) -> None:
    store = DiskStore(tmp_path / "media")
    data = b"hello voice note"
    size, sha = store.store("test.m4a", data)
    assert size == len(data)
    assert sha == hashlib.sha256(data).hexdigest()
    assert store.read("test.m4a") == data


def test_disk_store_creates_directory(tmp_path: Path) -> None:
    store = DiskStore(tmp_path / "deep" / "nested" / "dir")
    store.store("x.jpg", b"img")
    assert (tmp_path / "deep" / "nested" / "dir" / "x.jpg").exists()


def test_disk_store_remove(tmp_path: Path) -> None:
    store = DiskStore(tmp_path)
    store.store("a.m4a", b"audio")
    store.remove("a.m4a")
    assert not (tmp_path / "a.m4a").exists()


def test_disk_store_remove_missing_is_noop(tmp_path: Path) -> None:
    store = DiskStore(tmp_path)
    store.remove("does_not_exist.m4a")  # must not raise


def test_disk_store_sha256_matches_content(tmp_path: Path) -> None:
    store = DiskStore(tmp_path)
    data = b"exact content"
    _, sha = store.store("f.jpg", data)
    assert sha == hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# R2Store (mocked boto3)
# ---------------------------------------------------------------------------


def _make_r2() -> tuple[R2Store, MagicMock]:
    """Return an R2Store and the mock boto3 S3 client it wraps.

    boto3 is an optional dep and may not be installed in the test environment, so we mock
    the whole module in sys.modules before importing R2Store's constructor path.
    """
    import sys

    mock_client = MagicMock()
    mock_client.get_object.return_value = {
        "Body": MagicMock(read=MagicMock(return_value=b"stored"))
    }

    mock_boto3 = MagicMock()
    mock_boto3.client.return_value = mock_client

    with patch.dict(sys.modules, {"boto3": mock_boto3}):
        store = R2Store(
            bucket="test-bucket",
            account_id="acc123",
            access_key_id="key_id",
            secret_access_key="key_secret",
        )
    # Replace the internal client with our mock so subsequent calls are recorded.
    store._client = mock_client
    return store, mock_client


def test_r2_store_store_calls_put_object() -> None:
    store, client = _make_r2()
    data = b"voice bytes"
    size, sha = store.store("abc.m4a", data)

    assert size == len(data)
    assert sha == hashlib.sha256(data).hexdigest()
    client.put_object.assert_called_once_with(Bucket="test-bucket", Key="abc.m4a", Body=data)


def test_r2_store_remove_calls_delete_object() -> None:
    store, client = _make_r2()
    store.remove("abc.m4a")
    client.delete_object.assert_called_once_with(Bucket="test-bucket", Key="abc.m4a")


def test_r2_store_read_calls_get_object() -> None:
    store, client = _make_r2()
    result = store.read("abc.m4a")
    assert result == b"stored"
    client.get_object.assert_called_once_with(Bucket="test-bucket", Key="abc.m4a")


def test_r2_store_missing_boto3_raises_config_error() -> None:
    import sys

    from mutual_server.config import ConfigError

    # Simulate boto3 not being installed by removing it from sys.modules and blocking re-import.
    with (
        patch.dict(sys.modules, {"boto3": None}),  # type: ignore[dict-item]
        pytest.raises((ConfigError, ImportError)),
    ):
        R2Store(
            bucket="b",
            account_id="a",
            access_key_id="k",
            secret_access_key="s",
        )


# ---------------------------------------------------------------------------
# make_store
# ---------------------------------------------------------------------------


def test_make_store_returns_disk_store_when_no_r2(tmp_path: Path) -> None:
    import yaml

    from mutual_server.config import REPO_ROOT

    data = yaml.safe_load((REPO_ROOT / "server" / "config.example.yaml").read_text("utf-8"))
    data["env"] = "test"
    data["database"] = {"url": "sqlite://"}
    data["media"]["storage_dir"] = str(tmp_path / "media")
    settings = Settings.model_validate(data)

    store = make_store(settings)
    assert isinstance(store, DiskStore)


def test_make_store_returns_r2_store_when_r2_configured(tmp_path: Path) -> None:
    import sys

    import yaml

    from mutual_server.config import REPO_ROOT

    data = yaml.safe_load((REPO_ROOT / "server" / "config.example.yaml").read_text("utf-8"))
    data["env"] = "test"
    data["database"] = {"url": "sqlite://"}
    data["media"]["storage_dir"] = str(tmp_path / "media")
    data["media"]["r2"] = {
        "bucket": "my-bucket",
        "account_id": "acc",
        "access_key_id_env": "TEST_R2_KEY_ID",
        "secret_access_key_env": "TEST_R2_SECRET",
    }
    settings = Settings.model_validate(data)

    mock_boto3 = MagicMock()
    mock_boto3.client.return_value = MagicMock()
    with (
        patch.dict(os.environ, {"TEST_R2_KEY_ID": "kid", "TEST_R2_SECRET": "sec"}),
        patch.dict(sys.modules, {"boto3": mock_boto3}),
    ):
        store = make_store(settings)

    assert isinstance(store, R2Store)


def test_make_store_raises_if_r2_env_vars_missing(tmp_path: Path) -> None:
    import yaml

    from mutual_server.config import REPO_ROOT, ConfigError

    data = yaml.safe_load((REPO_ROOT / "server" / "config.example.yaml").read_text("utf-8"))
    data["env"] = "test"
    data["database"] = {"url": "sqlite://"}
    data["media"]["storage_dir"] = str(tmp_path / "media")
    data["media"]["r2"] = {
        "bucket": "b",
        "account_id": "a",
        "access_key_id_env": "MISSING_KEY_ID_VAR",
        "secret_access_key_env": "MISSING_SECRET_VAR",
    }
    settings = Settings.model_validate(data)

    # Ensure the env vars are absent.
    env = {
        k: v for k, v in os.environ.items() if k not in ("MISSING_KEY_ID_VAR", "MISSING_SECRET_VAR")
    }
    with (
        patch.dict(os.environ, env, clear=True),
        pytest.raises(ConfigError, match="MISSING_KEY_ID_VAR"),
    ):
        make_store(settings)


def test_make_store_returns_r2_store_from_env_vars(tmp_path: Path) -> None:
    import sys

    import yaml

    from mutual_server.config import REPO_ROOT

    data = yaml.safe_load((REPO_ROOT / "server" / "config.example.yaml").read_text("utf-8"))
    data["env"] = "test"
    data["database"] = {"url": "sqlite://"}
    data["media"]["storage_dir"] = str(tmp_path / "media")
    # media.r2 is None in this config
    settings = Settings.model_validate(data)
    assert settings.media.r2 is None

    mock_boto3 = MagicMock()
    mock_boto3.client.return_value = MagicMock()
    with (
        patch.dict(
            os.environ,
            {
                "MUTUAL_R2_BUCKET": "env-bucket",
                "MUTUAL_R2_ACCOUNT_ID": "env-acc",
                "MUTUAL_R2_ACCESS_KEY_ID": "env-key",
                "MUTUAL_R2_SECRET_ACCESS_KEY": "env-sec",
            },
        ),
        patch.dict(sys.modules, {"boto3": mock_boto3}),
    ):
        store = make_store(settings)

    assert isinstance(store, R2Store)
    assert store._bucket == "env-bucket"


def test_r2_store_custom_endpoint() -> None:
    import sys

    mock_boto3 = MagicMock()
    mock_client = MagicMock()
    mock_boto3.client.return_value = mock_client

    with (
        patch.dict(os.environ, {"MUTUAL_R2_ENDPOINT": "https://custom.endpoint.com"}),
        patch.dict(sys.modules, {"boto3": mock_boto3}),
    ):
        store = R2Store(
            bucket="b",
            account_id="a",
            access_key_id="k",
            secret_access_key="s",
        )
        assert store._bucket == "b"
        mock_boto3.client.assert_called_once()
        _, kwargs = mock_boto3.client.call_args
        assert kwargs["endpoint_url"] == "https://custom.endpoint.com"
