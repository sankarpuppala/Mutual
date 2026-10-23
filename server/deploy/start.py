"""Production entry point: migrate the database, then serve (docs/DEPLOYMENT.md).

    python server/deploy/start.py

Runs on Windows and Linux alike (CLAUDE.md §2: no shell-only scripts). Environment:

* ``MUTUAL_CONFIG`` — the config file (default ``server/config.yaml``);
* ``MUTUAL_HOST`` / ``MUTUAL_PORT`` — bind address (default ``0.0.0.0:8000``);
* ``MUTUAL_FORWARDED_ALLOW_IPS`` — the reverse proxy whose ``X-Forwarded-For`` is trusted,
  so the per-IP rate limits see the real client rather than the proxy (default
  ``127.0.0.1``). The address is only ever counted in memory, never logged (invariant 5).

The uvicorn access log stays off, always: it would record client IP addresses (D22).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    from alembic import command
    from alembic.config import Config

    from mutual_server.config import load_settings

    settings = load_settings()  # fail fast, before touching the database, on a bad config
    os.environ.setdefault("MUTUAL_DATABASE_URL", settings.database_url)
    media = settings.resolve_path(settings.media.storage_dir)
    media.mkdir(parents=True, exist_ok=True)

    cfg = Config(str(REPO_ROOT / "server" / "alembic.ini"))
    cfg.set_main_option("script_location", str(REPO_ROOT / "server" / "migrations"))
    command.upgrade(cfg, "head")

    import uvicorn

    uvicorn.run(
        "mutual_server.main:create_app",
        factory=True,
        host=os.environ.get("MUTUAL_HOST", "0.0.0.0"),
        port=int(os.environ.get("MUTUAL_PORT", "8000")),
        access_log=False,
        proxy_headers=True,
        forwarded_allow_ips=os.environ.get("MUTUAL_FORWARDED_ALLOW_IPS", "127.0.0.1"),
        server_header=False,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
