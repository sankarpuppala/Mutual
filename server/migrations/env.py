"""Alembic environment for mutual_server (every schema change goes through here, CLAUDE.md §6)."""

from __future__ import annotations

import os
from pathlib import Path

import yaml
from alembic import context
from sqlalchemy import create_engine

from mutual_server import models  # noqa: F401  (registers every table on Base.metadata)
from mutual_server.config import REPO_ROOT
from mutual_server.db import Base


def _database_url() -> str:
    override = os.environ.get("MUTUAL_DATABASE_URL")
    if override:
        return override
    server = REPO_ROOT / "server"
    path = Path(os.environ.get("MUTUAL_CONFIG", server / "config.yaml"))
    if not path.is_file():
        path = server / "config.example.yaml"
    url: str = yaml.safe_load(path.read_text(encoding="utf-8"))["database"]["url"]
    prefix = "sqlite:///"
    if url.startswith(prefix) and not Path(url[len(prefix) :]).is_absolute():
        url = prefix + (REPO_ROOT / url[len(prefix) :]).as_posix()
    return url


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=Base.metadata,
        render_as_batch=True,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(_database_url())
    with engine.connect() as connection:
        context.configure(
            connection=connection, target_metadata=Base.metadata, render_as_batch=True
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
