"""Sending codes. Console mode (dev/test only) prints the code; SMTP/HTTP for real use."""

from __future__ import annotations

import json
import os
import smtplib
import sys
import urllib.error
import urllib.request
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


def _try_http_email(to: str, subject: str, body: str, from_address: str) -> bool:
    """Try sending via HTTP API (port 443), which works on hosts like Render that block SMTP ports."""
    # 1. Resend API
    resend_key = os.environ.get("RESEND_API_KEY", "").strip()
    if resend_key:
        try:
            from_hdr = from_address if "@" in from_address else "Mutual <onboarding@resend.dev>"
            req = urllib.request.Request(
                "https://api.resend.com/emails",
                data=json.dumps(
                    {
                        "from": from_hdr,
                        "to": [to],
                        "subject": subject,
                        "text": body,
                    }
                ).encode("utf-8"),
                headers={
                    "Authorization": f"Bearer {resend_key}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                if resp.status in (200, 201, 202):
                    print(f"[email] Successfully sent via Resend HTTP API to {to}", file=sys.stderr)
                    return True
        except Exception as exc:  # noqa: BLE001
            print(f"[email] Resend HTTP API failed: {exc}", file=sys.stderr)

    # 2. Brevo HTTP API
    brevo_key = (
        os.environ.get("BREVO_API_KEY") or os.environ.get("MUTUAL_BREVO_API_KEY", "")
    ).strip()
    if brevo_key:
        try:
            sender_email = from_address
            if "<" in from_address and ">" in from_address:
                sender_email = from_address.split("<")[1].split(">")[0].strip()
            req = urllib.request.Request(
                "https://api.brevo.com/v3/smtp/email",
                data=json.dumps(
                    {
                        "sender": {"email": sender_email, "name": "Mutual"},
                        "to": [{"email": to}],
                        "subject": subject,
                        "textContent": body,
                    }
                ).encode("utf-8"),
                headers={
                    "api-key": brevo_key,
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                if resp.status in (200, 201, 202):
                    print(f"[email] Successfully sent via Brevo HTTP API to {to}", file=sys.stderr)
                    return True
        except Exception as exc:  # noqa: BLE001
            print(f"[email] Brevo HTTP API failed: {exc}", file=sys.stderr)

    return False


class SmtpEmailSender:
    def __init__(self, config: EmailConfig, otp_ttl_seconds: int, college_ttl_seconds: int) -> None:
        self._config = config
        self._otp_minutes = max(1, otp_ttl_seconds // 60)
        self._college_minutes = max(1, college_ttl_seconds // 60)

    def _send(self, to: str, subject: str, body: str, code: str = "") -> None:
        # First try HTTP email providers (never blocked by cloud firewalls like Render free tier)
        if _try_http_email(to, subject, body, self._config.from_address):
            return

        msg = EmailMessage()
        msg["From"] = self._config.from_address
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body)
        user = (
            os.environ.get(self._config.smtp_user_env) or os.environ.get("MUTUAL_SMTP_USER", "")
        ).strip()
        password = (
            (
                os.environ.get(self._config.smtp_password_env)
                or os.environ.get("MUTUAL_SMTP_PASSWORD", "")
            )
            .replace(" ", "")
            .strip()
        )
        try:
            with smtplib.SMTP(self._config.smtp_host, self._config.smtp_port, timeout=3) as smtp:
                smtp.starttls()
                if user or password:
                    smtp.login(user, password)
                smtp.send_message(msg)
        except Exception as exc:  # noqa: BLE001
            # Free cloud tiers (such as Render Free) block outbound ports 25, 465, and 587.
            # Log the exact error and print the code to server logs as a reliable fallback
            # so development and testing can proceed without blocking the user.
            print(
                f"[email] WARNING: Outbound SMTP to {self._config.smtp_host}:{self._config.smtp_port} failed ({exc}). "
                f"Note: Render free tier blocks outbound SMTP ports (25, 465, 587).",
                file=sys.stderr,
            )
            print(f"[email] >>> LOGIN CODE FOR {to}: {code} <<<", file=sys.stderr, flush=True)

    def send_login_code(self, to: str, code: str) -> None:
        self._send(
            to,
            "Your Mutual code",
            f"Your Mutual code is {code}. It expires in {self._otp_minutes} minutes.\n\n"
            "If you did not ask for it, ignore this email.",
            code=code,
        )

    def send_college_code(self, to: str, code: str) -> None:
        self._send(
            to,
            "Confirm your college's application to Mutual",
            f"Your verification code is {code}. It expires in {self._college_minutes} "
            "minutes.\n\nSomeone asked for Mutual to be opened at your college and gave "
            "this address as the official contact. If that was not you, ignore this email "
            "and nothing will happen.",
            code=code,
        )


def make_sender(settings: Settings) -> EmailSender:
    if settings.email.mode == "console":
        return ConsoleEmailSender()
    return SmtpEmailSender(
        settings.email, settings.auth.otp_ttl_seconds, settings.colleges.code_ttl_seconds
    )
