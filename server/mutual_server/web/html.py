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
# operator data, and a CSP that allows Google Fonts and inline styles.
SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'none'; "
        "style-src 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "form-action 'self'; "
        "frame-ancestors 'none'; base-uri 'none'"
    ),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
}


def logo_svg(size: int = 34) -> str:
    """The authentic Mutual logo mark: two overlapping translucent circles (terracotta & indigo)."""
    h = int(size * 0.66)
    return (
        f'<svg class="mutual-logo" width="{size}" height="{h}" viewBox="0 0 60 40" aria-hidden="true" style="vertical-align:middle;display:inline-block;flex-shrink:0">'
        '<circle cx="22" cy="20" r="15" fill="var(--signal)" opacity="0.9" />'
        '<circle cx="38" cy="20" r="15" fill="var(--mutual)" opacity="0.8" />'
        "</svg>"
    )


_CSS = """
:root {
  --bg: #F7F3EE;
  --surface: #FFFFFF;
  --sunk: #EFE9E1;
  --ink: #1D1A22;
  --muted: #5F5868;
  --line: #E3DCD2;
  --signal: #B5523F;
  --signal-soft: #F6E3DD;
  --on-signal: #FFFFFF;
  --mutual: #4F4FC4;
  --mutual-soft: #E6E6FA;
  --on-mutual: #FFFFFF;
  --danger: #A3333D;
  --warn: #8A5A12;
  --shadow: 0 1px 3px rgba(29,26,34,0.05), 0 8px 24px rgba(29,26,34,0.06);
  --display: "Fraunces", Georgia, "Times New Roman", serif;
  --ui: "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --card: var(--surface);
  --accent: var(--signal);
  --accent-ink: var(--on-signal);
  --ok: var(--mutual);
  --chip: var(--sunk);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #121016;
    --surface: #1B1820;
    --sunk: #16131B;
    --ink: #F2EEF6;
    --muted: #A49DAE;
    --line: #2C2733;
    --signal: #F08A72;
    --signal-soft: #3A2420;
    --on-signal: #1D1A22;
    --mutual: #9A9AF2;
    --mutual-soft: #25244A;
    --on-mutual: #121016;
    --danger: #F2808A;
    --warn: #E2B25A;
    --shadow: 0 2px 4px rgba(0,0,0,0.35), 0 12px 36px rgba(0,0,0,0.3);
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 15px/1.6 var(--ui);
  -webkit-font-smoothing: antialiased;
}
a { color: var(--signal); text-decoration: none; transition: opacity 0.15s ease; }
a:hover { opacity: 0.85; }
header.top {
  border-bottom: 1px solid var(--line);
  background: var(--surface);
  position: sticky;
  top: 0;
  z-index: 100;
}
.top-inner {
  max-width: 980px;
  margin: 0 auto;
  padding: 14px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
  color: var(--ink);
}
.brand-name {
  font-family: var(--display);
  font-weight: 500;
  font-size: 24px;
  letter-spacing: -0.015em;
  line-height: 1;
}
header.top nav {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
header.top nav a {
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
  transition: all 0.15s ease;
}
header.top nav a:hover {
  color: var(--ink);
  background: var(--sunk);
}
header.top nav a.on {
  color: var(--ink);
  background: var(--sunk);
  font-weight: 600;
}
main {
  max-width: 980px;
  margin: 0 auto;
  padding: 32px 20px 80px;
}
main.narrow {
  max-width: 560px;
}
.hero {
  margin-bottom: 28px;
}
.eyebrow {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 8px;
}
h1 {
  font-family: var(--display);
  font-weight: 500;
  font-size: 34px;
  line-height: 1.15;
  letter-spacing: -0.02em;
  margin: 0 0 12px;
}
h2 {
  font-family: var(--display);
  font-weight: 500;
  font-size: 22px;
  line-height: 1.25;
  letter-spacing: -0.01em;
  margin: 24px 0 12px;
}
p.lede {
  color: var(--muted);
  font-size: 16px;
  line-height: 1.55;
  margin: 0 0 20px;
}
.italic-accent {
  font-family: var(--display);
  font-style: italic;
  color: var(--signal);
}
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 20px;
  padding: 24px;
  margin: 0 0 16px;
  box-shadow: var(--shadow);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}
.card-grid-item {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 20px;
  padding: 20px;
  box-shadow: var(--shadow);
}
.card-grid-item h3 {
  font-family: var(--display);
  font-weight: 500;
  font-size: 18px;
  margin: 0 0 8px;
}
.card-grid-item p {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--muted);
}
.stat {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 18px;
  box-shadow: var(--shadow);
}
.stat b {
  display: block;
  font-family: var(--display);
  font-weight: 500;
  font-size: 32px;
  line-height: 1.1;
  color: var(--ink);
}
.stat span {
  color: var(--muted);
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 12px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
.scroll { overflow-x: auto; }
.chip { display: inline-block; padding: 3px 12px; border-radius: 999px; background: var(--sunk); font-size: 12px; font-weight: 500; }
.chip.ok { color: var(--mutual); background: var(--mutual-soft); }
.chip.warn { color: var(--warn); }
.chip.danger { color: var(--danger); }
label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  margin: 16px 0 6px;
}
label:first-child { margin-top: 0; }
input[type=text], input[type=password], input[type=email], select, textarea {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--sunk);
  color: var(--ink);
  font-family: var(--ui);
  font-size: 14px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
input::placeholder, textarea::placeholder {
  color: var(--muted);
  opacity: 0.7;
}
input:focus, textarea:focus, select:focus {
  outline: none;
  border-color: var(--mutual);
  box-shadow: 0 0 0 3px var(--mutual-soft);
}
textarea { min-height: 100px; resize: vertical; }
.hint { color: var(--muted); font-size: 13px; margin: 6px 0 0; }
button {
  font-family: var(--ui);
  font-size: 14px;
  font-weight: 600;
  border: 0;
  border-radius: 999px;
  padding: 12px 24px;
  cursor: pointer;
  background: var(--ink);
  color: var(--bg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: opacity 0.15s ease, transform 0.1s ease;
}
button:hover { opacity: 0.9; transform: translateY(-1px); }
button:active { transform: translateY(0); }
button.accent { background: var(--signal); color: var(--on-signal); }
button.ghost { background: transparent; color: var(--ink); border: 1px solid var(--line); }
button.ghost:hover { background: var(--sunk); }
button.danger { background: var(--danger); color: #fff; }
form.inline { display: inline; }
.row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.flash {
  padding: 14px 18px;
  border-radius: 14px;
  margin: 0 0 20px;
  background: var(--sunk);
  border: 1px solid var(--line);
  font-size: 14px;
  line-height: 1.4;
}
.flash.error {
  background: var(--signal-soft);
  border-color: var(--danger);
  color: var(--danger);
  font-weight: 500;
}
.muted { color: var(--muted); }
.excerpt { border-left: 3px solid var(--line); padding: 4px 0 4px 14px; margin: 10px 0; }
.excerpt div { margin: 4px 0; }
code { font-size: 13px; background: var(--sunk); padding: 2px 6px; border-radius: 6px; word-break: break-all; }
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
        "<link rel=\"icon\" type=\"image/svg+xml\" href=\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 40'%3E%3Ccircle cx='22' cy='20' r='15' fill='%23E26D5C' opacity='0.9'/%3E%3Ccircle cx='38' cy='20' r='15' fill='%238282F6' opacity='0.8'/%3E%3C/svg%3E\">"
        '<link rel="alternate icon" href="/favicon.ico">'
        '<link rel="preconnect" href="https://fonts.googleapis.com">'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=Inter:wght@400;500;600&display=swap">'
        f"<title>{e(title)} · Mutual</title><style>{_CSS}</style></head><body>"
        f'<header class="top"><div class="top-inner">'
        f'<a class="brand" href="{e(brand_href)}">{logo_svg(36)}<span class="brand-name">Mutual</span></a>'
        f"<nav>{links}</nav></div></header>"
        f'<main class="{"narrow" if narrow else ""}">{body}</main></body></html>'
    )
    return HTMLResponse(html, status_code=status_code, headers=SECURITY_HEADERS)


def flash(message: str | None, *, error: bool = False) -> str:
    if not message:
        return ""
    return f'<div class="flash{" error" if error else ""}" role="status">{e(message)}</div>'
