# Deploying Mutual

How to put the server on the internet and get the app onto real phones, at zero cost
(CLAUDE.md §2). Mutual is an **unaudited research prototype**. Deploying it does not make
it production-ready, and nothing here changes that. Read §6 before you invite anyone.

What you end up with:

```
 phones (release APK) ──HTTPS──▶ Caddy (free Let's Encrypt certificate)
                                   └──▶ mutual server (Docker) ──▶ SQLite + media on a volume
 college officials ──▶ https://<your-host>/colleges      operators ──▶ https://<your-host>/admin
```

Everything below is in `server/deploy/`:

| File | What it is |
|---|---|
| `Dockerfile` | The server image. Build context is the repository root. |
| `start.py` | Entry point: validates the config, runs `alembic upgrade head`, starts uvicorn with the access log **off** and proxy headers trusted only from the proxy. |
| `docker-compose.yml` | The server plus Caddy for HTTPS (options A/B). |
| `docker-compose.selfhost.yml` | The server alone, for a tunnel to terminate HTTPS instead (option C, no card needed). |
| `Caddyfile` | Caddy config. No `log` directive, so no access log and no IP addresses (invariant 5). |
| `config.prod.example.yaml` | Production config: SMTP email, data under `/data`, no pre-approved colleges. |
| `env.example` | The secrets the server reads from the environment. |

---

## 1. Pick a host (all free)

| Option | Cost | Needs a card? | Good for | Catch |
|---|---|---|---|---|
| **A. Oracle Cloud "Always Free" VM** + a free **DuckDNS** hostname | 0 | **Yes**, to verify identity (never charged) | A pilot that stays up for weeks, on a machine built for it | Choose the Always Free shape and region carefully, or the VM is not actually free |
| **B. Your laptop** + `cloudflared` quick tunnel | 0 | No | A demo for an afternoon | The `*.trycloudflare.com` URL changes every time the tunnel restarts, and the server is down whenever the laptop sleeps |
| **C. Your own computer** + a free **ngrok** static domain | 0 | No | A real pilot, if the machine can stay on | Uptime depends on your own power and internet, not a data centre; see §3a |
| **D. Render free Web Service** + free **Neon** Postgres | 0 | Sometimes — Render's anti-fraud system occasionally asks for one even on the free tier, unpredictably | A real pilot hosted in an actual data centre, no machine of your own to keep on | **Uploaded photos and voice notes do not survive a restart** on Render's free tier (ephemeral disk) — see §3b |

Any other Linux machine with a public IP and Docker works the same way as option A. **No
credit card at all:** try option D first; fall back to option C if Render asks for one.

## 2. Option A: a server that stays up

### 2.1 Machine and hostname

1. Create an Always Free VM (Ubuntu, the Ampere A1 shape is enough). In its network
   security list, open TCP ports **80** and **443**.
2. At [duckdns.org](https://www.duckdns.org) sign in, create a subdomain such as
   `mutual-pilot`, and point it at the VM's public IP. Your host is now
   `mutual-pilot.duckdns.org`.
3. On the VM, install Docker (`curl -fsSL https://get.docker.com | sh`) and clone the
   repository.

### 2.2 Email for login codes

Students sign in with a 6-digit code sent to their college email, so the server needs an
SMTP account. Free options:

- **Brevo** (free plan, about 300 emails a day): create an SMTP key, then use
  `smtp_host: smtp-relay.brevo.com`, port 587, and its login and key as user and password.
  Verify the sender address you put in `from_address`.
- **Gmail** (about 500 a day): turn on 2-step verification, create an *app password*, and
  use `smtp_host: smtp.gmail.com`, port 587, your address as user and the app password as
  password.

College IT departments sometimes quarantine mail from new senders. Ask your partner college
(§5) to allow-list your `from_address` before launch.

### 2.3 Configure and start

```bash
cd server/deploy
cp env.example .env                       # gitignored
cp config.prod.example.yaml config.yaml   # gitignored
python3 -c "import secrets; print(secrets.token_urlsafe(48))"   # paste as MUTUAL_EMAIL_PEPPER
nano .env          # MUTUAL_DOMAIN, MUTUAL_EMAIL_PEPPER, SMTP user/password, MUTUAL_ADMIN_*
nano config.yaml   # email.smtp_host and email.from_address
docker compose up -d --build
docker compose logs -f mutual             # "Application startup complete", then Ctrl+C
```

**Back up `MUTUAL_EMAIL_PEPPER` somewhere safe.** Every account is found by an HMAC of its
email under that secret. Lose or change it and every student is locked out of their
account for good. There is no recovery, by design.

Check `https://<your-host>/healthz` returns `{"status":"ok"}` and `https://<your-host>/colleges`
shows the college page. `/v1/dev/*` must return 404. It does, because `MUTUAL_ENV=prod` is
baked into the image (invariant 11).

### 2.4 The central admin

Put `MUTUAL_ADMIN_USERNAME` and `MUTUAL_ADMIN_PASSWORD` in `.env` before the first start.
The server creates that **owner** account the first time it starts: one login that sees
every college's reports and feedback. Sign in at `https://<your-host>/admin`, then change
the password under **Account**. After that the environment value is ignored, so it can
never overwrite the new password.

You can also add an owner from the command line at any time:

```bash
docker compose exec mutual python -m mutual_server.admin operators add <your-username>
``` Add the supervisor as a second owner from the **Operators**
page. Neither of you may hold a participant account on this deployment (SPEC §19, Q8).

### 2.5 Backups

Everything lives in the `mutual-data` volume: `mutual.db` and `media/`. A consistent copy
of the database while it is running:

```bash
docker compose exec mutual python -c "import sqlite3; s=sqlite3.connect('/data/mutual.db'); d=sqlite3.connect('/data/backup.db'); s.backup(d); d.close()"
docker compose cp mutual:/data/backup.db ./mutual-$(date +%F).db
```

Keep backups as private as the server itself. They hold profiles, messages and report
excerpts.

### 2.6 Updating

```bash
git pull
docker compose up -d --build     # start.py applies any new migration before serving
```

## 3. Option B: a demo from the laptop

```powershell
# Terminal 1: the server in prod mode needs SMTP. For a demo with synthetic accounts, use dev mode:
$env:MUTUAL_ENV="dev"; uvicorn mutual_server.main:create_app --factory --no-access-log --app-dir server
# Terminal 2: seed demo data (synthetic accounts only, invariant 9)
python -m mutual_server.demo_seed
# Terminal 3: a free temporary HTTPS URL (winget install Cloudflare.cloudflared)
cloudflared tunnel --url http://localhost:8000
```

Start Metro with `EXPO_PUBLIC_SERVER_URL` set to the printed `https://….trycloudflare.com`
URL and a dev build of the app will use it. **Never** use dev mode for real students:
it prints login codes to the console and lets anyone move the server clock.

## 3a. Option C: your own computer, no credit card anywhere

Oracle (option A) asks for a card to prove you're a real person, even though the VM
itself is never charged. If you don't have one, this option needs none at all: a
computer you own stays switched on and connected to the internet, running the real
production server (not dev mode, real SMTP, real students), and a free **ngrok** tunnel
gives it a stable `https://` address with its own certificate — no router
configuration, no port forwarding.

The trade-off, stated plainly: the service is only as reliable as your machine's power
and internet connection. That's a real difference from a data centre, and it's worth
saying so to your partner college (`docs/COLLEGE_ONBOARDING.md` §2).

### 3a.1 Get a free, stable address

1. Create a free account at [ngrok.com](https://ngrok.com) — email only, no card.
2. Install the agent (`winget install ngrok.ngrok` on Windows, or download from their
   site), then authenticate it once:
   ```powershell
   ngrok config add-authtoken <your-token-from-the-ngrok-dashboard>
   ```
3. On the ngrok dashboard, under **Domains**, claim your one free static domain —
   something like `your-name.ngrok-free.app`. Unlike a quick tunnel, this address never
   changes.

### 3a.2 Configure and start the server

Same as §2.2 for email, then:

```powershell
cd server/deploy
cp env.example .env                       # gitignored
cp config.prod.example.yaml config.yaml   # gitignored
python3 -c "import secrets; print(secrets.token_urlsafe(48))"   # paste as MUTUAL_EMAIL_PEPPER
notepad .env          # MUTUAL_EMAIL_PEPPER, SMTP user/password, MUTUAL_ADMIN_* (MUTUAL_DOMAIN is not used here)
notepad config.yaml   # email.smtp_host and email.from_address
docker compose -f docker-compose.selfhost.yml up -d --build
```

This uses `docker-compose.selfhost.yml`, not the usual `docker-compose.yml`: it skips
Caddy and publishes the server on `127.0.0.1:8000` only, since ngrok terminates HTTPS
and talks to it over plain HTTP on the same machine. Nothing outside this computer can
reach that port, which is why it's safe for the server to trust the tunnel the same way
it trusts Caddy in option A.

In a second terminal, start the tunnel and leave it running:

```powershell
ngrok http --url=your-name.ngrok-free.app 8000
```

Check `https://your-name.ngrok-free.app/healthz` returns `{"status":"ok"}` from another
device. **Back up `MUTUAL_EMAIL_PEPPER`** exactly as in §2.3 — losing it locks every
student out for good, with no recovery.

### 3a.3 Keep it running

Both the server and the tunnel need to survive a reboot and stay running unattended:

- **Docker Desktop:** Settings → General → "Start Docker Desktop when you log in."
- **Power:** Settings → System → Power & battery → set sleep to *Never*, and if it's a
  laptop, set "When I close the lid, plugged in" to *Do nothing* (`powercfg` does the
  same from PowerShell). Leave it plugged in.
- **Autostart ngrok and the compose stack at login:** Task Scheduler → Create Task →
  trigger *At log on*, action `ngrok http --url=your-name.ngrok-free.app 8000`, with
  "Run whether user is logged on or not." Point a second task at
  `docker compose -f server/deploy/docker-compose.selfhost.yml up -d` the same way, or
  simply run that command once — containers restart on their own
  (`restart: unless-stopped`) as long as Docker Desktop itself comes back up.

Updating and backups work exactly as in §2.5–§2.6, with
`-f docker-compose.selfhost.yml` added to every `docker compose` command.

## 3b. Option D: Render (free Web Service) + Neon (free Postgres)

No machine of your own needed — the server runs in Render's data centre. Render's free
Web Services have no persistent disk of their own, so the database has to live
somewhere else: Neon's free Postgres (forever-free tier, no card) takes that job.
`docker-compose.yml`/`.selfhost.yml` are not used here — Render runs the code directly,
not the Docker image.

**Two mistakes worth naming up front, because they're easy to copy from an AI's answer
and easy not to notice went wrong:**

- **`MUTUAL_ENV` must be `prod`, never `dev`.** Dev mode prints every student's login
  code to the logs in plain text and exposes `/v1/dev/*` (clock travel, a route that
  fabricates crossings) to anyone on the internet — that's invariant 5 and invariant 11,
  not a style choice.
- **The environment variable must be named exactly `MUTUAL_DATABASE_URL`.** The server
  only ever reads that name (`server/mutual_server/config.py`). A variable called
  `DATABASE_URL` — the name Render's own Postgres add-on would use, and an easy guess —
  is silently ignored, and the app falls back to local SQLite, which Render then wipes on
  the next restart along with every account created in the meantime.

### 3b.1 The database

1. Create a free project at [neon.tech](https://neon.tech) (email only, no card) and
   copy its connection string from the dashboard.
2. Rewrite its scheme from `postgresql://` to `postgresql+psycopg2://` — SQLAlchemy
   needs the driver named explicitly — and keep `?sslmode=require` at the end. You'll
   paste this as `MUTUAL_DATABASE_URL` in step 3b.3.

### 3b.2 The config file

Render has no shell to `cp`/`nano` a gitignored file onto, so use its **Secret Files**
feature instead: in the Render dashboard, add a secret file, paste in the contents of
`server/deploy/config.prod.example.yaml` (filling in `email.smtp_host` and
`email.from_address` as in §2.2), and note the path Render mounts it at (shown in the
dashboard, typically under `/etc/secrets/`). `database.url` in that file is never read —
`MUTUAL_DATABASE_URL` always wins (`config.py`'s `database_url` property) — so leave it
as the placeholder.

### 3b.3 The web service

New Web Service → connect this repository → **Runtime: Python 3**.

- **Build Command:**
  ```bash
  pip install -e packages/protocol_py -e "server[postgres,r2]" && alembic -c server/alembic.ini upgrade head
  ```
  (the `postgres` and `r2` extras pull in the Postgres driver and boto3 for Cloudflare R2; plain `-e server` does not)
- **Start Command:**
  ```bash
  MUTUAL_PORT=$PORT python server/deploy/start.py
  ```
  (`start.py` re-runs the migration as a safety net, then serves with the access log
  off and proxy headers trusted — see §3b.4 for why `"*"` is correct here)
- **Environment variables:**

  | Key | Value |
  |---|---|
  | `PYTHON_VERSION` | `3.11.10` |
  | `MUTUAL_ENV` | `prod` |
  | `MUTUAL_CONFIG` | the secret file's mounted path from §3b.2 |
  | `MUTUAL_DATABASE_URL` | the Neon connection string from §3b.1, exactly this name |
  | `MUTUAL_EMAIL_PEPPER` | `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` — back it up, same as §2.3 |
  | `MUTUAL_FORWARDED_ALLOW_IPS` | `*` (§3b.4) |
  | `MUTUAL_ADMIN_USERNAME`, `MUTUAL_ADMIN_PASSWORD` | your central admin, as in §2.4 |
  | `MUTUAL_SMTP_USER`, `MUTUAL_SMTP_PASSWORD` | your SMTP account, as in §2.2 |

Deploy, then check Render's logs for `Application startup complete`, and
`https://your-app.onrender.com/healthz` returns `{"status":"ok"}`.

### 3b.4 Why `MUTUAL_FORWARDED_ALLOW_IPS=*` is correct here

Render's own router is the only thing that can reach your service — there is no public
port of yours to protect — so trusting whatever it says about the client's IP for the
per-IP rate limits is the same reasoning `docker-compose.yml` already uses to trust
Caddy, and `docker-compose.selfhost.yml` uses to trust a loopback-only tunnel. It is
**not** safe to set this on a host anyone else could also reach directly.

### 3b.5 Persistent media: Cloudflare R2 (free tier, no card)

Render's free Web Services have **no persistent disk** — anything written to
`media.storage_dir` is gone the next time the service restarts or redeploys, which
happens often on the free tier (every ~15 minutes of inactivity, or any new deploy).
Profiles, messages, matches and reports are safe (they're in Neon's Postgres); media is
not. For a pilot that depends on revealed photos, fix this with Cloudflare R2 (free tier:
10 GB storage, 1 million operations per month, no card needed).

#### Step 1: create the R2 bucket

1. Sign up at [cloudflare.com](https://cloudflare.com) (email only, no card for R2's free
   tier).
2. In the Cloudflare dashboard → **R2 Object Storage** → **Create bucket**, name it
   `mutual-media` (or anything you like).
3. Note your **Account ID** from the dashboard's right sidebar — a 32-character hex string.
4. Under **R2 → Manage R2 API tokens** → **Create API token**, give it
   **Object Read & Write** on your bucket. Copy the **Access Key ID** and
   **Secret Access Key** — they are shown once.

#### Step 2: configure R2 in Render

You can configure R2 in either of two ways:

**Option A (Recommended — purely via Environment Variables):**
In Render's **Environment** tab, add:

| Key | Value |
|---|---|
| `MUTUAL_R2_BUCKET` | `mutual-media` (your bucket name) |
| `MUTUAL_R2_ACCOUNT_ID` | your Cloudflare account ID |
| `MUTUAL_R2_ACCESS_KEY_ID` | your R2 Access Key ID |
| `MUTUAL_R2_SECRET_ACCESS_KEY` | your R2 Secret Access Key |
| `MUTUAL_R2_ENDPOINT` | *(optional)* `https://<account_id>.r2.cloudflarestorage.com` |

**Option B (via Secret File):**
Add the `r2` block to your `/etc/secrets/config.yaml` secret file:
```yaml
media:
  storage_dir: /data/media   # ignored when r2 is present
  r2:
    bucket: mutual-media
    account_id: <your 32-char account id>
    access_key_id_env: MUTUAL_R2_ACCESS_KEY_ID
    secret_access_key_env: MUTUAL_R2_SECRET_ACCESS_KEY
```
And add `MUTUAL_R2_ACCESS_KEY_ID` and `MUTUAL_R2_SECRET_ACCESS_KEY` to Render's Environment variables.

#### Step 4: add the R2 extra to the build command

Edit the **Build Command** to include `[postgres,r2]`:

```bash
pip install -e packages/protocol_py -e "server[postgres,r2]" && alembic -c server/alembic.ini upgrade head
```

Redeploy. Photos and voice notes are now written to R2 and survive every restart and
redeploy. The database (Neon) and media (R2) are both durable; nothing user-visible is
stored on Render's ephemeral disk.

### 3b.6 Keeping it warm

Render's free tier sleeps a service after about 15 minutes of no requests, and Neon
similarly suspends an idle database; waking either back up costs a few seconds on the
next request. [cron-job.org](https://cron-job.org) (free, no card) can ping
`https://your-app.onrender.com/healthz` every 10–14 minutes to keep both warm — this
trades a little bit of relentless traffic for avoiding that delay, and does not
conflict with anything above.

## 4. Building the app for real phones

The app reads two build-time variables (`app/app.config.ts`):
`EXPO_PUBLIC_MUTUAL_ENV` (`dev` or `prod`, default `prod`) and `EXPO_PUBLIC_SERVER_URL`.
A release build refuses plain `http://`, so it needs the HTTPS host from §2, §3a or §3b.

Edit `app/eas.json`, replacing `https://REPLACE-WITH-YOUR-SERVER` in the `preview` and
`production` profiles. `__tests__/release-profiles.test.ts` fails if a release profile is
not `prod` or not `https`.

**With EAS Build (free tier, a limited number of builds a month):**

```powershell
cd app
npx eas-cli login
npx eas-cli build -p android --profile preview      # an installable .apk for the pilot
```

**Locally (no account needed):**

```powershell
cd app
$env:EXPO_PUBLIC_MUTUAL_ENV="prod"; $env:EXPO_PUBLIC_SERVER_URL="https://<your-host>"
npx expo prebuild --platform android
cd android; .\gradlew.bat assembleRelease
```

The Expo template signs local release builds with the debug key. That is fine for a pilot
installed by hand. For anything longer-lived, create your own upload keystore
(`keytool -genkeypair …`) and keep it out of git (`*.keystore` and `*.jks` are ignored).
Then run `npm run check:privacy -w app`. With `android/` present, it checks the merged
manifest for location permissions (invariant 3).

Share the APK with participants directly. Play Store release is out of scope (SPEC §4).

## 5. Opening a college

See `docs/COLLEGE_ONBOARDING.md`. In short: a college official applies at `/colleges`
and proves an address at the college's domain. You talk to them, then open the campus from
**Admin → Applications**. A college never opens by itself.

## 6. Before real students use it

- [ ] Run it as a **product, not a study**, unless `study/APPROVAL.md` and
      `study.approval_reference` exist (invariant 9). The server refuses to start in study
      mode without them. Do not export or analyse real users' data.
- [ ] Tell students plainly that it is an unaudited research prototype. The `/colleges`
      page and the app's You tab already say so.
- [ ] The `MUTUAL_EMAIL_PEPPER` is backed up, and `.env` is not in git.
- [ ] The partner college has named a safety contact, and they have a moderator login
      (Admin → Operators → scope: their campus).
- [ ] Someone checks **Admin → Reports** every day.
- [ ] Backups (§2.5) run, and you have restored one once to prove it works.
- [ ] Two real phones have completed the BLE spike (`docs/BLE_SPIKE.md`). Until then,
      discovery on real hardware is unmeasured.
