"""Email hashing, login codes and session tokens (SPEC.md §9, CLAUDE.md invariant 5).

Nothing here stores or logs a plaintext email, code or token.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets

from mutual_protocol.encoding import b64url_encode

OTP_DIGITS = 6  # SPEC.md §5 J1: "6-digit code"
SESSION_TOKEN_BYTES = 32  # SPEC.md §9

_EMAIL = re.compile(r"^[a-z0-9._%+\-]{1,64}@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")


class InvalidEmail(ValueError):
    pass


def normalize_email(email: str) -> tuple[str, str]:
    """Lowercase and validate; return ``(normalized_email, domain)``."""
    value = email.strip().lower().rstrip(".")
    if len(value) > 254 or not _EMAIL.match(value):
        raise InvalidEmail("not a valid email address")
    return value, value.rsplit("@", 1)[1]


def email_hmac(normalized_email: str, pepper: bytes) -> str:
    """HMAC-SHA256 of the normalized email under the server pepper, hex."""
    return hmac.new(pepper, normalized_email.encode("utf-8"), hashlib.sha256).hexdigest()


def new_otp() -> str:
    """A uniformly random 6-digit code from the CSPRNG."""
    return f"{secrets.randbelow(10**OTP_DIGITS):0{OTP_DIGITS}d}"


def otp_hash(code: str, email_hash: str, pepper: bytes) -> str:
    """Keyed SHA-256 (HMAC) of the code, bound to the email hash, so a DB dump cannot be
    brute-forced offline without the pepper."""
    return hmac.new(pepper, f"{email_hash}:{code}".encode(), hashlib.sha256).hexdigest()


def otp_matches(code: str, email_hash: str, stored_hash: str, pepper: bytes) -> bool:
    """Constant-time comparison of a submitted code with the stored hash."""
    return hmac.compare_digest(otp_hash(code, email_hash, pepper), stored_hash)


def new_session_token() -> tuple[str, str]:
    """Return ``(token for the client, SHA-256 hex stored by the server)``."""
    token = b64url_encode(secrets.token_bytes(SESSION_TOKEN_BYTES))
    return token, session_hash(token)


def session_hash(token: str) -> str:
    return hashlib.sha256(token.encode("ascii", errors="replace")).hexdigest()
