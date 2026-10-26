"""/app — the interactive web client for Mutual.

Serves the standalone web application with Fraunces & Inter fonts, matching the approved
design prototype (docs/design/prototype.html).
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter(prefix="/app", tags=["web_app"])

_TEMPLATE_PATH_A = Path(__file__).resolve().parents[3] / "docs" / "design" / "prototype.html"
_TEMPLATE_PATH_B = Path(__file__).resolve().parent / "client_template.html"

_SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'unsafe-inline' 'unsafe-eval'; "
        "style-src 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com data:; "
        "connect-src 'self'; "
        "img-src 'self' data: https:; "
        "media-src 'self' data: blob:; "
        "frame-ancestors 'none'; base-uri 'none'"
    ),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-cache",
}


def _load_html() -> str:
    for candidate in (_TEMPLATE_PATH_B, _TEMPLATE_PATH_A):
        if candidate.is_file():
            return candidate.read_text(encoding="utf-8")
    return "<h1>Mutual Web App</h1><p>Client template not found.</p>"


@router.get("", response_class=HTMLResponse)
@router.get("/", response_class=HTMLResponse)
def web_app() -> HTMLResponse:
    content = _load_html()
    return HTMLResponse(content, status_code=200, headers=_SECURITY_HEADERS)
