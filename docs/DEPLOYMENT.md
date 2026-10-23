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
| `docker-compose.yml` | The server plus Caddy for HTTPS. |
| `Caddyfile` | Caddy config. No `log` directive, so no access log and no IP addresses (invariant 5). |
| `config.prod.example.yaml` | Production config: SMTP email, data under `/data`, no pre-approved colleges. |
| `env.example` | The secrets the server reads from the environment. |

---

## 1. Pick a host (all free)

| Option | Cost | Good for | Catch |
|---|---|---|---|
| **A. Oracle Cloud "Always Free" VM** + a free **DuckDNS** hostname | 0 | A pilot that stays up for weeks | Sign-up asks for a card to verify identity. Always Free resources are not charged, but choose the Always Free shape and region carefully. |
| **B. Your laptop** + `cloudflared` quick tunnel | 0 | A demo for an afternoon | The `*.trycloudflare.com` URL changes every time the tunnel restarts, and the server is down whenever the laptop sleeps. |

Any other Linux machine with a public IP and Docker works the same way as option A.

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

## 4. Building the app for real phones

The app reads two build-time variables (`app/app.config.ts`):
`EXPO_PUBLIC_MUTUAL_ENV` (`dev` or `prod`, default `prod`) and `EXPO_PUBLIC_SERVER_URL`.
A release build refuses plain `http://`, so it needs the HTTPS host from §2.

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
