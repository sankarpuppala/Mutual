"""The SMTP sender composes the right messages and always uses STARTTLS (SPEC.md §11)."""

from __future__ import annotations

from typing import Any, ClassVar, Self

import pytest
from conftest import make_settings

from mutual_server.services import email as email_module


class FakeSmtp:
    instances: ClassVar[list[FakeSmtp]] = []

    def __init__(self, host: str, port: int, timeout: float) -> None:
        self.host, self.port, self.calls, self.sent = host, port, [], []
        FakeSmtp.instances.append(self)

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def starttls(self) -> None:
        self.calls.append("starttls")

    def login(self, user: str, password: str) -> None:
        self.calls.append(f"login:{user}")

    def send_message(self, msg: Any) -> None:
        self.sent.append(msg)


def test_smtp_sender(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    FakeSmtp.instances.clear()
    monkeypatch.setattr(email_module.smtplib, "SMTP", FakeSmtp)
    monkeypatch.setenv("MUTUAL_SMTP_USER", "mailer")
    settings = make_settings(
        tmp_path,
        email={"mode": "smtp", "smtp_host": "smtp.test", "from_address": "Mutual <m@x.org>"},
    )
    sender = email_module.make_sender(settings)
    sender.send_login_code("s@example.ac.in", "123456")
    sender.send_college_code("dean@example.ac.in", "654321")
    first, second = FakeSmtp.instances
    assert first.calls == ["starttls", "login:mailer"]
    assert "123456" in first.sent[0].get_content()
    assert f"{settings.auth.otp_ttl_seconds // 60} minutes" in first.sent[0].get_content()
    assert second.sent[0]["To"] == "dean@example.ac.in"
    assert "654321" in second.sent[0].get_content()
