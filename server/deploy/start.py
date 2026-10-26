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
    import traceback

    try:
        from alembic import command
        from alembic.config import Config

        from mutual_server.config import load_settings

        settings = load_settings()  # fail fast, before touching the database, on a bad config
        os.environ.setdefault("MUTUAL_DATABASE_URL", settings.database_url)
        has_r2 = settings.media.r2 is not None or bool(
            os.environ.get("MUTUAL_R2_BUCKET") and os.environ.get("MUTUAL_R2_ACCOUNT_ID")
        )
        if not has_r2:
            try:
                media = settings.resolve_path(settings.media.storage_dir)
                media.mkdir(parents=True, exist_ok=True)
            except OSError:
                pass

        cfg = Config(str(REPO_ROOT / "server" / "alembic.ini"))
        cfg.set_main_option("script_location", str(REPO_ROOT / "server" / "migrations"))
        command.upgrade(cfg, "head")

        import uvicorn

        # Resolve port safely across Render ($PORT / PORT env var), Docker, or local environments
        port_raw = os.environ.get("PORT") or os.environ.get("MUTUAL_PORT") or "8000"
        try:
            port = int(port_raw)
        except ValueError:
            port = 8000

        uvicorn.run(
            "mutual_server.main:create_app",
            factory=True,
            host=os.environ.get("MUTUAL_HOST", "0.0.0.0"),
            port=port,
            access_log=False,
            proxy_headers=True,
            forwarded_allow_ips=os.environ.get("MUTUAL_FORWARDED_ALLOW_IPS", "127.0.0.1"),
            server_header=False,
        )
        return 0
    except Exception as exc:  # noqa: BLE001
        print("\n" + "=" * 60, file=sys.stderr)
        print(f"FATAL STARTUP ERROR: {exc}", file=sys.stderr)
        print("=" * 60 + "\n", file=sys.stderr)
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
