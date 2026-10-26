"""Sending codes. Console mode (dev/test only) prints the code; SMTP for real use."""

from __future__ import annotations

import os
import smtplib
import sys
from email.message import EmailMessage
from typing import Protocol

from mutual_server.config import EmailConfig, Settings


class EmailSender(Protocol):
    def send_login_code(self, to: str, code: str) -> None: ...

    def send_college_code(self, to: str, code: str) -> None: ...


class ConsoleEmailSender:
    """Dev only (SPEC.md §11): prints the code to the server console."""

    def send_login_code(self, to: str, code: str) -> None:
        print(f"[dev] Mutual login code for {to}: {code}", flush=True)

    def send_college_code(self, to: str, code: str) -> None:
        print(f"[dev] Mutual college verification code for {to}: {code}", flush=True)


class SmtpEmailSender:
    def __init__(self, config: EmailConfig, otp_ttl_seconds: int, college_ttl_seconds: int) -> None:
        self._config = config
        self._otp_minutes = max(1, otp_ttl_seconds // 60)
        self._college_minutes = max(1, college_ttl_seconds // 60)

    def _send(self, to: str, subject: str, body: str) -> None:
        msg = EmailMessage()
        msg["From"] = self._config.from_address
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body)
        user = (os.environ.get(self._config.smtp_user_env) or os.environ.get("MUTUAL_SMTP_USER", "")).strip()
        password = (
            os.environ.get(self._config.smtp_password_env) or os.environ.get("MUTUAL_SMTP_PASSWORD", "")
        ).replace(" ", "").strip()
        try:
            with smtplib.SMTP(self._config.smtp_host, self._config.smtp_port, timeout=12) as smtp:
                smtp.starttls()
                if user or password:
                    smtp.login(user, password)
                smtp.send_message(msg)
        except Exception as exc:
            print(
                f"[email] ERROR sending to {to} via {self._config.smtp_host}:{self._config.smtp_port}: {exc!r}",
                file=sys.stderr,
            )
            print(f"[email] Backup delivery code for {to}: {body.splitlines()[0] if body else ''}", file=sys.stderr)
            from mutual_server.errors import ApiError

            raise ApiError(503, "email_delivery_failed", f"Email send failed: {exc}") from exc

    def send_login_code(self, to: str, code: str) -> None:
        self._send(
            to,
            "Your Mutual code",
            f"Your Mutual code is {code}. It expires in {self._otp_minutes} minutes.\n\n"
            "If you did not ask for it, ignore this email.",
        )

    def send_college_code(self, to: str, code: str) -> None:
        self._send(
            to,
            "Confirm your college's application to Mutual",
            f"Your verification code is {code}. It expires in {self._college_minutes} "
            "minutes.\n\nSomeone asked for Mutual to be opened at your college and gave "
            "this address as the official contact. If that was not you, ignore this email "
            "and nothing will happen.",
        )


def make_sender(settings: Settings) -> EmailSender:
    if settings.email.mode == "console":
        return ConsoleEmailSender()
    return SmtpEmailSender(
        settings.email, settings.auth.otp_ttl_seconds, settings.colleges.code_ttl_seconds
    )
