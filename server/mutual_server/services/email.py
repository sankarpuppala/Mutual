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
        with smtplib.SMTP(self._config.smtp_host, self._config.smtp_port, timeout=10) as smtp:
            smtp.starttls()
            user = os.environ.get(self._config.smtp_user_env, "")
            password = os.environ.get(self._config.smtp_password_env, "")
            if not user or not password:
                print(
                    f"[email] WARNING: SMTP credentials: "
                    f"{self._config.smtp_user_env}={'set' if user else 'EMPTY'}, "
                    f"{self._config.smtp_password_env}={'set' if password else 'EMPTY'}",
                    file=sys.stderr,
                )
            smtp.login(user, password)
            smtp.send_message(msg)

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
