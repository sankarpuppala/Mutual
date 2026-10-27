# Project Conversation Transcript — Mutual

**Project:** Mutual — Campus Connection App and Research Prototype  
**Student:** Sankara Puppala (sankarpuppala0@gmail.com)  
**Tool:** Claude Code (Claude Sonnet 4.6)  
**Period:** 2026-10-09 to 2026-10-27  

---

## Session 1 — 2026-10-09

### UI Fixes and Design Updates

**User:** I told you to change the name from answers to something, also change the 20 to 7 in design file.

**Claude:** Fixed both issues:
1. Changed `_ANSWERS[0]` in the demo seed to genuinely new text (Meera's persona was unchanged from before — the previous session had varied the other nine but missed index 0).
2. Replaced all six "20" signal-count occurrences in `docs/design/prototype.html` with "7" — the signals tab, privacy explainer, signal sheet, and mini-dots. Did not touch the `--signal` CSS colour variable or the "7 days" crossing-retention sentence.

---

### Push and Deployment

**User:** Push and deploy it completely and tell me how to download the app.

**Claude:** Pushed all pending commits to the remote. Explained the four deployment paths from `docs/DEPLOYMENT.md`:

- **Option A (Oracle Cloud):** Free VM + DuckDNS hostname. Needs a credit card for identity verification.
- **Option B (Laptop + cloudflared):** Demo only — URL changes each restart.
- **Option C (Laptop + ngrok static domain):** No card, stable URL, but depends on the laptop being on.
- **Option D (Render + Neon Postgres):** No card (usually), real data centre, but media files don't survive restarts on the free tier.

Recommended Option D for getting started. Noted the two critical mistakes to avoid: `MUTUAL_ENV` must be `prod` (not `dev`), and the database variable must be named exactly `MUTUAL_DATABASE_URL`.

---

### Bug Reports from the Phone

**User:** [Screenshot of chat screen + two screenshots of Mutuals tab] Few issues are there — the messages are going up not down and also even if we have a mutual they are not showing in the convos.

**Claude:** Investigated both issues:

**Message ordering:** Not a real bug. The demo seed had created messages with future timestamps using clock time-travel. When the server was restarted with `offset=0`, those timestamps were in the "future" relative to the current clock — the UI was displaying them correctly. Resolved by nudging the dev clock forward.

**Mutuals tab bug (real bug):** Root cause was in `app/app/(tabs)/mutuals.tsx`. `seenRevealIds()` was called inside a `useEffect` keyed on `matches.data`. After opening a reveal and returning to the tab, `matches.data` hadn't changed, so the seen-set was never refreshed — the match stayed under "New this morning" instead of moving to Conversations.

**Fix:** Replaced `useEffect` with `useFocusEffect` (matching the pattern used in `signals.tsx`), wrapping the load function in `useCallback`:

```typescript
const load = useCallback(async () => {
  if (!matches.data) return;
  const [result, played] = await Promise.all([resolveMatches(matches.data), seenRevealIds()]);
  setResolved(result);
  setSeen(played);
  setPhotos(sources);
}, [matches.data]);

useFocusEffect(
  useCallback(() => { void load(); }, [load]),
);
```

Verified live on emulator — Arjun moved to Conversations immediately on returning to the tab after opening his reveal.

---

### App Icon and Launcher Screen

**User:** [Screenshot of dev-client launcher screen] App logo is shit and also why is the opening of app like this, can't we directly go into the app as user and all the developer controls shouldn't be there right?

**Claude:** Two separate issues:

**Icon:** Replaced all five app icon assets with the overlapping two-circle mark from `docs/design/prototype.html` — terracotta `#B5523F` signal circle (opacity 0.9) overlapping indigo `#4F4FC4` mutual circle (opacity 0.8) on cream `#F7F3EE`:
- `icon.png` — 1024×1024, mark at 62%
- `android-icon-foreground.png` — transparent background, mark at 52% (survives adaptive icon mask)
- `android-icon-background.png` — flat cream field
- `android-icon-monochrome.png` — opaque/black circles for Android 13+ themed icons
- `splash-icon.png` — transparent, mark at 42%

**Launcher screen:** Explained the distinction — the launcher screen is a feature of `expo-dev-client` that lets developers switch between Metro servers. It only appears in dev builds (built with `EXPO_PUBLIC_MUTUAL_ENV=dev`). A release build (built without that variable) opens straight into the app. The dev panel itself is gated on `isDev()` and is invisible in release builds — invariant 11.

---

### Smart App Control Blocking hermesc.exe

**User:** You fix that issue completely pls. / Done. [after turning off Smart App Control]

**Claude:** Diagnosed the release build failure: `hermesc.exe` (the Hermes JavaScript compiler) was being blocked by Windows Smart App Control (SAC) with event 3033/3077 in the CodeIntegrity log. SAC has no per-file exception mechanism — the only fix is to turn it off.

Warned the user: turning SAC off is a one-way door. Once off it cannot be re-enabled without resetting or reinstalling Windows. Defender's real-time protection remains separate and unaffected.

After the user turned SAC off (`VerifiedAndReputablePolicyState = 0`), also resolved the 260-character Ninja path limit by building from a git worktree at `C:\m` (real short path, not a junction or subst drive). Built successfully as `app-release.apk` (84.8 MB, arm64-only). Documented both the dead ends (subst drives and `CMAKE_OBJECT_PATH_MAX`) and the working solution in `docs/RUNNING_LOCALLY.md`.

Also caught and fixed a silent bug: `android:usesCleartextTraffic="true"` was only in the debug manifest overlay. Release builds would have installed, opened, and failed every API call silently. Fixed by gating it on `EXPO_PUBLIC_MUTUAL_ENV` in `app.config.ts`:

```typescript
usesCleartextTraffic: process.env.EXPO_PUBLIC_MUTUAL_ENV === 'dev',
```

---

### IP Address Churn

**User:** [Screenshots of app failing] / Give me these steps and links more clearly.

**Claude:** Diagnosed the root cause: the laptop's IP address had changed four times in six days on campus Wi-Fi (DHCP lease churn). The server URL is baked into the APK at build time. Every IP change meant the APK was pointing at a dead address.

**Fix:** Implemented a runtime server URL override in the dev panel so the IP can be changed from the phone without rebuilding:

- `app/src/storage/secure.ts` — `getServerUrlOverride`, `setServerUrlOverride`, `clearServerUrlOverride`; `clearAll()` deliberately does not clear the override (wiping it on logout would point the device back at the stale address)
- `app/src/api/client.ts` — in-memory `serverUrlOverride` that `baseUrl()` checks first; `loadServerUrlOverride()` reads from SecureStore at startup; `overrideServerUrl()` writes both in-memory and to SecureStore
- `app/app/_layout.tsx` — loads the override at startup
- `app/app/dev.tsx` — "Server address" card with a text field and two buttons

The override persists across app restarts and survives logout. Entering the new IP in the dev panel on the phone fixes connectivity without a rebuild.

---

### Deep Link to Dev Panel

**User:** [Screenshot of Chrome searching Google for "mutual://dev"] This is what its showing.

**Claude:** Chrome's address bar treats custom-scheme URLs as search queries when typed directly. Provided two alternatives:

1. **Intent URL format** — paste `intent://dev#Intent;scheme=mutual;package=app.mutual;end` into Chrome's address bar (Chrome recognises this as an explicit app-launch request)
2. **Tap a rendered link** — type `mutual://dev` in Notes or any app where text auto-links, then tap it

---

## Session 2 — 2026-10-26 to 2026-10-27

### Deployment Options

**User:** So to deploy what should I do — just read deployment.md file and tell me more options like Microsoft Azure and all but which is best, also I can't create an Oracle account.

**Claude:** Read `docs/DEPLOYMENT.md` and added the broader picture:

| Option | Card? | Server uptime | Media survives restart? |
|---|---|---|---|
| D. Render + Neon | Usually no | Data centre, sleeps 15 min | No |
| C. Laptop + ngrok | No | When laptop is on | Yes |
| Azure App Service F1 | Yes (always) | Sleeps 20 min, 60 CPU min/day | Ephemeral |
| Railway | No (then card) | Good | Yes |
| Fly.io | Yes (always) | Good, persistent volumes | Yes |
| Google Cloud Run | Yes (always) | Serverless, cold starts | No |

**Recommendation:** Option D (Render + Neon) — no card ever, real HTTPS, the media limitation doesn't matter for testing with synthetic accounts. Add a keep-alive ping from cron-job.org to prevent sleep during testing. Media only becomes a problem when real students reveal photos, and that can be fixed with R2 at that point.

---

### Cloudflare R2 Object Storage

**User:** Wire up free object storage (e.g. Cloudflare R2's free tier) for `media.storage_dir` instead of local disk.

**Claude:** Implemented a full storage-backend abstraction. Files changed:

**`server/mutual_server/config.py`**
Added `R2Config` model and optional `r2` field in `MediaConfig`:
```python
class R2Config(_Strict):
    bucket: str
    account_id: str
    access_key_id_env: str = "MUTUAL_R2_ACCESS_KEY_ID"
    secret_access_key_env: str = "MUTUAL_R2_SECRET_ACCESS_KEY"


class MediaConfig(_Strict):
    storage_dir: str
    r2: R2Config | None = None
    # ... existing fields unchanged
```

**`server/mutual_server/services/media.py`**
Added `MediaStore` Protocol, `DiskStore` (existing disk behaviour), `R2Store` (boto3 S3-compatible client), and `make_store()` factory:

```python
class MediaStore(Protocol):
    def store(self, name: str, data: bytes) -> tuple[int, str]: ...
    def remove(self, name: str) -> None: ...
    def read(self, name: str) -> bytes: ...

class DiskStore:
    def __init__(self, directory: Path) -> None: ...
    # wraps existing store()/remove() module functions

class R2Store:
    def __init__(self, bucket, account_id, access_key_id, secret_access_key): ...
    # boto3.client('s3', endpoint_url=f'https://{account_id}.r2.cloudflarestorage.com', ...)

def make_store(settings: Settings) -> MediaStore:
    # returns R2Store if media.r2 is set, else DiskStore
    # raises ConfigError at startup if R2 env vars are missing
```

**`server/mutual_server/deps.py`**
Replaced `media_dir: Path` property with `media_store: MediaStore` field.

**`server/mutual_server/main.py`**
`create_app()` calls `make_store(settings)` and passes it to `AppContext`. Accepts optional `media_store` override for tests.

**7 call sites updated across 4 routers:**
- `routers/profile.py` — 5 sites (voice upload, voice delete, photo upload, photo delete, profile put)
- `routers/account.py` — 1 site (account deletion)
- `routers/digest.py` — 1 site (GET /media/{media_id})
- `routers/matches.py` — 1 site (GET /matches/{id}/photos/{index})

`FileResponse` removed from both serving routes; replaced with `Response(content=data, media_type=...)` so the same code works for both disk and R2.

**`server/pyproject.toml`**
```toml
r2 = ["boto3==1.38.28"]
```

**Both config example files** — commented-out `r2:` block added with full instructions.

**`docs/DEPLOYMENT.md §3b.5`** — rewritten from a placeholder ("ask Claude") to a 4-step setup guide:
1. Create R2 bucket at cloudflare.com (email only, no card)
2. Add `r2:` block to the Render secret config file
3. Add `MUTUAL_R2_ACCESS_KEY_ID` and `MUTUAL_R2_SECRET_ACCESS_KEY` as Render env vars
4. Update build command to `pip install ... -e "server[postgres,r2]"`

**`server/tests/test_media_store.py`** — 12 new tests:
- `DiskStore` roundtrip, directory creation, remove, idempotent remove, SHA256 correctness
- `R2Store` store/remove/read (mocked via `sys.modules`), missing boto3 error
- `make_store` returns correct backend, raises on missing env vars

**Test result:** 194 Python tests pass (up from 182).

---

### Transcript Request

**User:** Need to submit the conversation as transcript.md file so create it.

**Claude:** Created this file.

---

## Key Technical Decisions Made

| Decision | Rationale |
|---|---|
| `useFocusEffect` for mutuals tab | `useEffect` keyed on `matches.data` didn't re-run when returning to a tab; `useFocusEffect` re-runs on every focus event |
| Release APK from `C:\m` worktree | 294-char Ninja object path → 253 chars; subst drives and junctions both canonicalise back via Java's `getCanonicalPath()` |
| Smart App Control turned off | No per-file exception possible; `hermesc.exe` is unsigned; one-way door but unavoidable for release builds |
| `clearAll()` spares the server URL override | Wiping on logout would point the device at a dead address after an IP change |
| `MediaStore` Protocol + two backends | Keeps disk behaviour unchanged for dev/self-hosted; R2 is opt-in via config |
| `Response(content=bytes)` over `FileResponse` | `FileResponse` requires a local file path; streaming bytes works identically for both disk and R2 |
| boto3 import guarded with `try/except` | Server starts and runs normally without boto3 installed, as long as `media.r2` is not set |
| R2 env vars validated at startup, not at request time | Fail fast — a missing key should crash startup, not fail the first upload silently |

---

## Privacy Invariants — Status

All 13 invariants from `CLAUDE.md §5` remain in force. No change in this work touches any invariant. Specifically:

- **Invariant 1** (no attention-dependent traffic): unaffected — media serving is unchanged in semantics, only in where bytes are read from
- **Invariant 3** (no location): unaffected
- **Invariant 5** (minimal identity storage): unaffected — no new data stored, R2 keys are in env vars not the database
- **Invariant 9** (no real-user data without approval): unaffected — all development uses synthetic accounts
- **Invariant 11** (dev routes never ship): unaffected — `isDev()` gate unchanged

---

## Test Counts

| Suite | Before | After |
|---|---|---|
| Python (protocol_py + server + sim) | 325 | 337 (+12 new media store tests) |
| TypeScript (app) | 220 | 220 |
| Protocol-ts | 29 | 29 |
