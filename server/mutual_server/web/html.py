"""A tiny HTML toolkit: escaping, the page shell and the shared stylesheet.

Everything interpolated into a page goes through ``e()``. Colours are the app's own
tokens (app/src/design/tokens.ts, SPEC.md §13.4) so the operator console reads as the same
product; both themes follow the OS setting.
"""

from __future__ import annotations

from datetime import datetime
from html import escape
from zoneinfo import ZoneInfo

from fastapi.responses import HTMLResponse

# The response headers every page carries: no framing, no referrer, no caching of
# operator data, and a CSP that allows nothing but this page's own inline stylesheet.
SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; "
        "frame-ancestors 'none'; base-uri 'none'"
    ),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
}

_CSS = """
:root{--bg:#F7F3EE;--card:#FFFFFF;--ink:#1D1A22;--muted:#5F5868;--line:#E3DCD2;
--accent:#B5523F;--accent-ink:#FFFFFF;--ok:#4F4FC4;--warn:#8A5A12;--danger:#A3333D;
--chip:#EFE9E1}
@media (prefers-color-scheme:dark){:root{--bg:#121016;--card:#1B1820;--ink:#F2EEF6;
--muted:#A49DAE;--line:#2C2733;--accent:#F08A72;--accent-ink:#1D1A22;--ok:#9A9AF2;
--warn:#E2B25A;--danger:#F2808A;--chip:#16131B}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,
"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
header.top{display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center;padding:14px 20px;
border-bottom:1px solid var(--line);background:var(--card)}
header.top .brand{font:600 20px/1 Georgia,"Times New Roman",serif;color:var(--ink);
text-decoration:none;margin-right:auto}
header.top nav{display:flex;flex-wrap:wrap;gap:4px 14px}
header.top nav a{text-decoration:none;color:var(--muted);font-weight:500}
header.top nav a.on{color:var(--accent)}
main{max-width:980px;margin:0 auto;padding:24px 16px 64px}
main.narrow{max-width:560px}
h1{font:600 30px/1.2 Georgia,"Times New Roman",serif;margin:8px 0 6px}
h2{font:600 20px/1.3 Georgia,"Times New Roman",serif;margin:28px 0 10px}
p.lede{color:var(--muted);margin:0 0 20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;
margin:0 0 14px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
.stat b{display:block;font:600 28px/1.1 Georgia,serif}
.stat span{color:var(--muted);font-size:14px}
table{width:100%;border-collapse:collapse;font-size:15px}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:500;font-size:13px;text-transform:uppercase;letter-spacing:.04em}
.scroll{overflow-x:auto}
.chip{display:inline-block;padding:2px 10px;border-radius:99px;background:var(--chip);
font-size:13px;font-weight:500}
.chip.ok{color:var(--ok)}.chip.warn{color:var(--warn)}.chip.danger{color:var(--danger)}
label{display:block;font-weight:500;margin:12px 0 4px}
input[type=text],input[type=password],input[type=email],select,textarea{width:100%;
padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--bg);
color:var(--ink);font:inherit}
textarea{min-height:90px}
.hint{color:var(--muted);font-size:14px;margin:4px 0 0}
button{font:inherit;font-weight:600;border:0;border-radius:99px;padding:10px 18px;
cursor:pointer;background:var(--accent);color:var(--accent-ink)}
button.ghost{background:transparent;color:var(--accent);border:1px solid var(--line)}
button.danger{background:var(--danger);color:var(--card)}
form.inline{display:inline}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.flash{padding:12px 14px;border-radius:12px;margin:0 0 16px;background:var(--chip)}
.flash.error{color:var(--danger)}
.muted{color:var(--muted)}
.excerpt{border-left:3px solid var(--line);padding:4px 0 4px 12px;margin:8px 0}
.excerpt div{margin:4px 0}
code{font-size:13px;background:var(--chip);padding:1px 6px;border-radius:6px;word-break:break-all}
"""


def e(value: object) -> str:
    """HTML-escape anything for interpolation into a page."""
    return escape("" if value is None else str(value), quote=True)


def when(value: datetime | None, tz: ZoneInfo) -> str:
    """A timestamp in the deployment timezone, minutes precision, escaped."""
    return "—" if value is None else e(value.astimezone(tz).strftime("%Y-%m-%d %H:%M"))


def page(
    title: str,
    body: str,
    *,
    nav: list[tuple[str, str, bool]] | None = None,
    brand_href: str = "/colleges",
    narrow: bool = False,
    status_code: int = 200,
) -> HTMLResponse:
    """Wrap ``body`` (already-escaped HTML) in the shared page shell."""
    links = "".join(
        f'<a href="{e(href)}" class="{"on" if on else ""}">{e(label)}</a>'
        for label, href, on in (nav or [])
    )
    html = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="robots" content="noindex">'
        f"<title>{e(title)} · Mutual</title><style>{_CSS}</style></head><body>"
        f'<header class="top"><a class="brand" href="{e(brand_href)}">Mutual</a>'
        f"<nav>{links}</nav></header>"
        f'<main class="{"narrow" if narrow else ""}">{body}</main></body></html>'
    )
    return HTMLResponse(html, status_code=status_code, headers=SECURITY_HEADERS)


def flash(message: str | None, *, error: bool = False) -> str:
    if not message:
        return ""
    return f'<div class="flash{" error" if error else ""}" role="status">{e(message)}</div>'
