"""Sending login codes. Console mode (dev/test only) prints the code; SMTP for real use."""

from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage
from typing import Protocol

from mutual_server.config import EmailConfig


class EmailSender(Protocol):
    def send_login_code(self, to: str, code: str) -> None: ...


class ConsoleEmailSender:
    """Dev only (SPEC.md §11): prints the code to the server console."""

    def send_login_code(self, to: str, code: str) -> None:
        print(f"[dev] Mutual login code for {to}: {code}", flush=True)


class SmtpEmailSender:
    def __init__(self, config: EmailConfig) -> None:
        self._config = config

    def send_login_code(self, to: str, code: str) -> None:
        msg = EmailMessage()
        msg["From"] = self._config.from_address
        msg["To"] = to
        msg["Subject"] = "Your Mutual code"
        msg.set_content(f"Your Mutual code is {code}. It expires in 10 minutes.")
        with smtplib.SMTP(self._config.smtp_host, self._config.smtp_port, timeout=10) as smtp:
            smtp.starttls()
            smtp.login(
                os.environ.get(self._config.smtp_user_env, ""),
                os.environ.get(self._config.smtp_password_env, ""),
            )
            smtp.send_message(msg)


def make_sender(config: EmailConfig) -> EmailSender:
    return ConsoleEmailSender() if config.mode == "console" else SmtpEmailSender(config)
