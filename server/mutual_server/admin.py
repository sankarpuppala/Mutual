"""Operator CLI: ``python -m mutual_server.admin <command>``.

campuses list
campuses approve <key> --name "<College name>"
campuses reject <key>
suspend <user_id>
reports list            (filled in Phase 5)
"""

from __future__ import annotations

import argparse

from sqlalchemy import select

from mutual_server.clock import SystemClock
from mutual_server.config import load_settings
from mutual_server.db import make_engine, make_session_factory
from mutual_server.ids import UuidIds
from mutual_server.models import Campus, User
from mutual_server.services import campus as campus_service


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m mutual_server.admin")
    sub = parser.add_subparsers(dest="command", required=True)
    camp = sub.add_parser("campuses").add_subparsers(dest="action", required=True)
    camp.add_parser("list")
    approve = camp.add_parser("approve")
    approve.add_argument("key")
    approve.add_argument("--name", required=True)
    reject = camp.add_parser("reject")
    reject.add_argument("key")
    suspend = sub.add_parser("suspend")
    suspend.add_argument("user_id")
    sub.add_parser("reports").add_subparsers(dest="action", required=True).add_parser("list")
    args = parser.parse_args(argv)

    settings = load_settings()
    session_factory = make_session_factory(make_engine(settings.database_url))
    clock, ids = SystemClock(), UuidIds()
    with session_factory() as db:
        if args.command == "campuses":
            if args.action == "list":
                for c in db.scalars(select(Campus).order_by(Campus.status, Campus.key)):
                    print(f"{c.status:8s} {c.key:30s} {c.name or '-':30s} attempts={c.attempts}")
            elif args.action == "approve":
                c = campus_service.approve(db, args.key, args.name, ids, clock)
                print(f"opened {c.key} ({c.name})")
            else:
                campus_service.reject(db, args.key)
                print(f"rejected {args.key}")
        elif args.command == "suspend":
            user = db.get(User, args.user_id)
            if user is None:
                print("no such user")
                return 1
            user.suspended_at = clock.now()
            db.commit()
            print(f"suspended {args.user_id}")
        else:
            print("reports are implemented in Phase 5")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
