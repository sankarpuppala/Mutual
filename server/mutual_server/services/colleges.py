"""Official college applications (SPEC.md §4.2).

A college official proves control of an address at the college's domain with a one-time
code; the application then waits for an operator. Nothing here opens a campus by itself:
only ``approve`` does, and only an operator calls it (D24 — no college opens automatically).
"""

from __future__ import annotations

import hashlib
import hmac
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from mutual_server import security
from mutual_server.clock import Clock
from mutual_server.config import DOMAIN_PATTERN as DOMAIN_RE
from mutual_server.config import Settings
from mutual_server.ids import IdFactory
from mutual_server.models import Campus, CollegeApplication
from mutual_server.services import campus as campus_service


class ApplicationError(ValueError):
    """A rejected application; the message is safe to show to the applicant."""


def _code_hash(app_id: str, code: str, pepper: bytes) -> str:
    return hmac.new(pepper, f"college:{app_id}:{code}".encode(), hashlib.sha256).hexdigest()


def _covers(email_domain: str, college_domain: str) -> bool:
    return email_domain == college_domain or email_domain.endswith("." + college_domain)


def submit(
    db: Session,
    settings: Settings,
    ids: IdFactory,
    clock: Clock,
    pepper: bytes,
    *,
    college_name: str,
    domain: str,
    contact_name: str,
    contact_role: str,
    contact_email: str,
    note: str,
) -> tuple[CollegeApplication, str]:
    """Validate and store an unverified application; return it and the code to email."""
    college_name, contact_name, contact_role = (
        college_name.strip(),
        contact_name.strip(),
        contact_role.strip(),
    )
    domain = domain.strip().lower().removeprefix("@").rstrip(".")
    if not 2 <= len(college_name) <= 120:
        raise ApplicationError("Give the college's full name.")
    if not 2 <= len(contact_name) <= 80 or not 2 <= len(contact_role) <= 80:
        raise ApplicationError("Give your name and your role at the college.")
    if len(note) > 2000:
        raise ApplicationError("Keep the note under 2000 characters.")
    if not DOMAIN_RE.match(domain):
        raise ApplicationError("The email domain should look like college.ac.in.")
    try:
        email, email_domain = security.normalize_email(contact_email)
    except security.InvalidEmail as exc:
        raise ApplicationError("That does not look like an email address.") from exc
    if not _covers(email_domain, domain):
        raise ApplicationError(
            "Use your official address at the college's own domain, so we can tell the "
            "application really comes from the college."
        )
    for campus in db.scalars(select(Campus).where(Campus.status == "open")):
        if any(_covers(domain, d) for d in campus.domains):
            raise ApplicationError("Mutual is already open at this college.")

    code = security.new_otp()
    now = clock.now()
    app_id = ids.new()
    row = CollegeApplication(
        id=app_id,
        college_name=college_name,
        domain=domain,
        contact_name=contact_name,
        contact_role=contact_role,
        contact_email=email,
        note=note.strip(),
        status="unverified",
        code_hash=_code_hash(app_id, code, pepper),
        code_expires_at=now + timedelta(seconds=settings.colleges.code_ttl_seconds),
        code_attempts=0,
        created_at=now,
    )
    db.add(row)
    db.commit()
    return row, code


def verify(
    db: Session, settings: Settings, clock: Clock, pepper: bytes, app_id: str, code: str
) -> CollegeApplication:
    """Check the emailed code; on success the application becomes ``verified``."""
    row = db.get(CollegeApplication, app_id)
    if row is None or row.status != "unverified" or row.code_hash is None:
        raise ApplicationError("This application can't be verified. Start again.")
    if row.code_expires_at is None or row.code_expires_at <= clock.now():
        raise ApplicationError("That code has expired. Start the application again.")
    if row.code_attempts >= settings.colleges.code_max_attempts:
        raise ApplicationError("Too many tries. Start the application again.")
    if not hmac.compare_digest(_code_hash(row.id, code.strip(), pepper), row.code_hash):
        row.code_attempts += 1
        db.commit()
        raise ApplicationError("That code didn't work. Check it and try again.")
    row.status, row.verified_at = "verified", clock.now()
    row.code_hash = row.code_expires_at = None
    db.commit()
    return row


def approve(
    db: Session,
    settings: Settings,
    ids: IdFactory,
    clock: Clock,
    row: CollegeApplication,
    operator: str,
    name: str | None = None,
) -> Campus:
    """Open the campus an application asks for, as a verified partner."""
    if row.status != "verified":
        raise ApplicationError("Only a verified application can be approved.")
    key = campus_service.key_for_domain(row.domain, settings.auth.academic_suffixes)
    campus = campus_service.approve(
        db,
        key,
        (name or row.college_name).strip()[:120],
        ids,
        clock,
        domains=[row.domain],
        partner=True,
    )
    row.status, row.decided_at, row.decided_by = "approved", clock.now(), operator
    db.commit()
    return campus


def reject(db: Session, clock: Clock, row: CollegeApplication, operator: str) -> None:
    if row.status not in ("verified", "unverified"):
        raise ApplicationError("This application was already decided.")
    row.status, row.decided_at, row.decided_by = "rejected", clock.now(), operator
    row.code_hash = row.code_expires_at = None
    db.commit()
