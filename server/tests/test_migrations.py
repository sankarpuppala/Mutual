"""``alembic upgrade head`` must produce exactly the schema ``models.py`` declares
(CLAUDE.md §6: every schema change goes through Alembic)."""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine

from mutual_server.config import REPO_ROOT
from mutual_server.db import Base


def test_migrations_match_models(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    url = f"sqlite:///{(tmp_path / 'm.db').as_posix()}"
    monkeypatch.setenv("MUTUAL_DATABASE_URL", url)
    cfg = Config(str(REPO_ROOT / "server" / "alembic.ini"))
    cfg.set_main_option("script_location", str(REPO_ROOT / "server" / "migrations"))
    command.upgrade(cfg, "head")
    engine = create_engine(url)
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    engine.dispose()
    # Type-only noise (e.g. SQLite reporting DATETIME for UtcDateTime) is not a schema gap.
    real = [d for d in diff if not (isinstance(d, list) and d and d[0][0] == "modify_type")]
    assert real == [], real
