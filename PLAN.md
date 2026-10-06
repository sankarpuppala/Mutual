# PLAN.md — Mutual

Status: **APPROVED — 2026-10-05** (approved by the human in chat: "proceed
the plan … do the changes at last". PROMPT.md Prompts 1–3 were not run; see
"Deferred improvements" below.)

This plan was drafted alongside `SPEC.md` so that Claude Code starts from a
strong position instead of a blank page. It is **not** pre-approved. Following
the spec-driven workflow, Claude Code must first review this plan critically
against `SPEC.md` (PROMPT.md, Prompt 3), propose changes, and the human must
approve the final version before Phase 0 begins. Once approved, change the
status line above to `APPROVED — <date>`.

Implements: `SPEC.md` v1.0. Governed by `CLAUDE.md`.

---

## How phases work

- One phase per session. One phase per approval. Each phase ends with its
  **Done when** checks passing, the **Human review checklist** completed by
  you, an entry in the **Progress log**, and a merge of the phase branch.
- Each phase starts by re-reading `CLAUDE.md`, `SPEC.md`, this file's phase
  section and the Progress log, then listing the files it will touch and any
  version-sensitive item it must verify first — and waiting for a "go".
- Within a phase, one file (or one file + its test) at a time.
- Anything marked **⚠ verify** is version-sensitive (library APIs, Android
  rules, Expo package names). Verify against the installed version's
  documentation at the start of the phase and record the result.

## Overview

| Phase | Name | Tier | Needs | Rough effort* |
|---|---|---|---|---|
| 0 | Environment and scaffold | 1 | Q5 answered | 1–2 days |
| 1 | Protocol — Python reference + vectors | 1 | — | 3–4 days |
| 2 | Protocol — TypeScript + cross-language vectors | 1 | 1 | 2–3 days |
| 3 | Server core: config, clock, ids, DB, auth, account, profile, media, study gate | 1 | 1, Q1, Q2 | 5–7 days |
| 4 | Server presence: uploads, resolution, crossings, digest, retention | 1 | 3 | 4–5 days |
| 5 | Server signals, matching, reveal, chat, safety + the two privacy tests | 1 | 4 | 6–8 days |
| 6 | Simulation and report | 1 | — (parallel-safe) | 5–7 days |
| 7 | Tier 1 documents: threat model, security argument, costs | 1 | 5, 6 | 2–3 days |
| — | **Tier 1 gate: complete research result. Show your professor.** | | | |
| 8 | App foundation: Expo, workspaces, design system, API client, lint, scripts, fake BLE | 2 | 2, 7 | 5–7 days |
| 9a | BLE spike on two phones | 2 | 8, Q3 | 3–4 days |
| 9b | Native BLE module (full) | 2 | 9a approved | 4–6 days |
| 10 | Onboarding and profile | 2 | 8 | 5–7 days |
| 11 | Core loop: presence, digest, signals, matches, reveal, chat, safety, settings; E2E | 2 | 9b (or fake), 10, Q6 | 10–14 days |
| 12 | Field pilot package — gated | 3 | 11, Q4, **written approval** | depends on approval |
| 13 | Close the loop: design-decision walkthrough, interview questions | 1–3 | after 7 and after 11 | 1 day each |

\* Rough part-time estimates for one student working with Claude Code. They
are planning aids, not commitments; record actual durations in the Progress
log.

Phase 6 depends only on `SPEC.md` §15 and can run in parallel with Phases 3–5
in a separate git worktree (`claude --worktree sim`), if you want.

---

## Phase 0 — Environment and scaffold

**Goal.** A repository where every later phase's tooling already works.

**Tasks.**
1. Verify installed tools and record versions: Git, Python 3.11, Node LTS,
   npm. (Android Studio + JDK are not needed until Phase 8.)
2. Create the folder structure from `SPEC.md` §20 (empty packages only).
3. Root `package.json` with npm workspaces `packages/protocol-ts` and `app`
   (the app folder is created in Phase 8; add it to workspaces then).
4. `.gitignore`: `.venv/`, `node_modules/`, `__pycache__/`, `*.db`,
   `server/config.yaml`, `server/media/`, `.env*`, `*.keystore`, `android/`
   and `ios/` build output under `app/` if using prebuild, `sim/results/cache/`.
5. Root `.venv`; `pyproject.toml` stubs for `protocol_py`, `server`, `sim`
   with `[dev]` extras (`pytest`, `ruff`, `httpx`).
6. `packages/protocol-spec/constants.json` exactly as `SPEC.md` §6.2.
7. `.pre-commit-config.yaml`: ruff (lint + format), a local hook running
   `pytest packages/protocol_py -q` (fast), and placeholders for app hooks
   added in Phase 8.
8. `README.md`: one paragraph, setup commands from `CLAUDE.md` §4.
9. Create the `git-commit` skill (PROMPT.md, Prompt 4).

**Done when.** `pre-commit run --all-files` passes; `pytest` runs and
collects zero tests without error; `npm install` succeeds at the root;
`constants.json` matches §6.2 byte-for-byte in content.

**Human review checklist.**
- [ ] `.gitignore` covers secrets, venv, node_modules, databases and media.
- [ ] `constants.json` intents match what you confirmed for Q5.
- [ ] No code beyond scaffolding was written.

---

## Phase 1 — Protocol: Python reference implementation + vectors

**Goal.** `mutual_protocol` implementing `SPEC.md` §6 exactly, with tests and
a deterministic vector generator.

**Files.** `packages/protocol_py/mutual_protocol/{constants,encoding,keys,
tokens,eid,encounter,vectors}.py`, `tests/test_*.py`.

**Tasks (in order, each with its test).**
1. `constants.py` — load `constants.json` (via `importlib.resources` or a
   path relative to the repo; document which); assert every personalization
   string is exactly 16 ASCII bytes at import time.
2. `encoding.py` — base64url without padding (encode/decode, reject padding
   and invalid characters); epoch/day string validation (`YYYY-MM-DD`, 10
   bytes); `uint16_be`.
3. `keys.py` — generate identity key pair; `pair_key(sk_self, pk_self,
   uid_self, pk_peer, uid_peer)` with both uids bound in (§6.5); reject
   all-zero shared secret; reject identical public keys or uids; sort public
   keys **as raw bytes** and order the uids with them;
   `is_valid_public_key(pk)` (32 bytes, canonical, not low-order).
4. `tokens.py` — `interest_token(pair_key, epoch, intent)`; `padded_set(real,
   rng=secrets)` with exact size, CSPRNG dummies and CSPRNG Fisher–Yates
   shuffle; error on > `signal_set_size` real tokens.
5. `eid.py` — `new_daily_key()`; `ephemeral_private_key(daily_key,
   interval)` and `eid(daily_key, interval)` (the X25519 public key, §6.8);
   `interval_for(local_time)`; `eid_schedule(daily_key) -> list of 96`.
6. `encounter.py` — `encounter_token(day, esk_own, eid_own, eid_heard)`
   keyed by the X25519 shared secret (§6.13, symmetric); the midnight rule;
   `padded_encounter_set(real, rng=secrets)` (dummies to a multiple of 256,
   at most 1024, CSPRNG shuffle).
7. `vectors.py` — CLI that generates ≥ 100 vectors from **deterministic**
   inputs (e.g. private keys = BLAKE2b of a fixed seed and index — never the
   CSPRNG), covering every function, plus negative cases (all-zero shared
   secret input, identical keys). Writes `packages/protocol-spec/vectors.json`
   with a `protocol_version` field.

**Done when.** AC-T1-1 and AC-T1-2 pass; `vectors.json` committed.

**Human review checklist.**
- [ ] No use of the `random` module anywhere; only `secrets` / `os.urandom`.
- [ ] Constants come from `constants.json`, not literals.
- [ ] Public keys are sorted as bytes, not as base64 strings.
- [ ] The token message is exactly `epoch(10 bytes) || intent(1 byte)`.
- [ ] The pair key hashes `ss || lo_pk || hi_pk || uid(lo) || uid(hi)`, and
      each uid stays with its own key after sorting.
- [ ] `encounter_token(d, a, b) == encounter_token(d, b, a)` (there is a test).
- [ ] You can explain, in one sentence each, what a pair key, a token and an
      EID are. (If not, ask Claude to explain before approving.)

**⚠ verify.** `cryptography` X25519 behaviour on low-order public keys
(whether it raises itself); keep the explicit all-zero check regardless.

---

## Phase 2 — Protocol: TypeScript + cross-language vectors

**Goal.** `@mutual/protocol` byte-identical to the Python reference, runnable
under Hermes (React Native) — so no Node-only APIs.

**Files.** `packages/protocol-ts/src/*.ts`, `test/*.test.ts`, config files.

**Tasks.**
1. Package setup: TypeScript strict, `vitest`, ESM build consumable by Metro.
2. `constants.ts` imports `constants.json`; same 16-byte assertion.
3. `encoding.ts` — base64url on `Uint8Array` **without `Buffer`** (Buffer is
   unavailable in Hermes).
4. `random.ts` — a single `randomBytes(n)` wrapper that throws a clear error
   if `crypto.getRandomValues` is missing.
5. `keys.ts`, `tokens.ts`, `eid.ts`, `encounter.ts` mirroring Python names
   and semantics.
6. `vectors.test.ts` — reproduce every vector in `vectors.json`.
7. `properties.test.ts` — the same property tests as Python.

**Done when.** AC-T1-3 passes.

**Human review checklist.**
- [ ] No `Buffer`, `fs`, `crypto` (Node module) or other Node-only imports in
      `src/`.
- [ ] Byte comparisons and sorting use `Uint8Array` values, not strings.
- [ ] Every vector passes; none skipped.

**⚠ verify.** `@noble/curves` and `@noble/hashes` current major version,
import paths, and whether `blake2b` personalization must be exactly 16 bytes
(ours always is). Pin exact versions.

---

## Phase 3 — Server core

**Goal.** A FastAPI server with configuration, injectable clock and id
generator, database, migrations, authentication, accounts, profiles, media,
and the study-mode gate.

**Files.** `server/mutual_server/{main,config,clock,db,models,security,
schemas,admin}.py`, `routers/{auth,account,profile,config_route,dev}.py`,
`services/{email,media}.py`, `data/prompts.json`, `migrations/`,
`config.example.yaml`, tests `conftest`, `test_auth`, `test_account`,
`test_profile`, `test_study_gate`.

**Tasks.**
1. `config.py` — load YAML + environment; validate with Pydantic (including
   the `campuses` list and `academic_suffixes`, and a timezone without
   daylight saving); **refuse to start** if `study.enabled` and
   `approval_reference` is empty or `study.campuses` names no open campus
   (`test_study_gate.py`).
2. `clock.py` — injectable clock with a dev-only offset; helpers for "local
   day", "current epoch", "is before time-of-day in local tz".
3. Injectable id factory (UUIDv4 in production, deterministic sequence in
   tests) — required later by the leak test.
4. `models.py` per `SPEC.md` §12 (all tables, even those used later, so the
   first migration is complete); Alembic initial migration.
5. `security.py` — email HMAC with pepper from env; OTP generation and
   SHA-256 hashing; constant-time compare; session tokens (32 random bytes,
   stored hashed).
6. Campus resolution (§4.1): listed domains and their subdomains, academic
   suffixes → pending campus (403 `campus_not_open`, attempt counted),
   anything else 400; `campus_id` set on the account. Tests: `test_auth.py`.
   Routers: auth (`request-otp` 204 with a silent cooldown), account (18+
   check, DOB discarded, identity-key validity and uniqueness via
   `mutual_protocol`, key-change rate limit), profile, prompts,
   voice and photo upload (EXIF stripped, image re-encoded with Pillow, size
   and duration limits), `GET /config`, dev routes mounted only in dev.
7. `admin.py` — CLI skeleton (`reports list`, `suspend <user_id>`, and now
   `campuses list|approve <key> --name|reject <key>`), filled in Phase 5.
8. Dev OTP: printed to the console only when `MUTUAL_ENV=dev`; an SMTP
   sender behind the same interface for later.

**Done when.** The auth, account, profile and study-gate parts of AC-T1-4
and AC-T3-1 pass; `alembic upgrade head` creates the schema from scratch.

**Human review checklist.**
- [ ] Search the code for `date_of_birth`: it appears only in the request
      schema and the age check, never in a model or a log line.
- [ ] No plaintext email column exists.
- [ ] OTP comparison uses `hmac.compare_digest`.
- [ ] Nothing calls `datetime.now()` outside `clock.py`.
- [ ] Dev routes are not mounted when `MUTUAL_ENV` is unset.
- [ ] Uvicorn runs without its access log; no IP address is logged or
      stored anywhere (search for `client.host`).

**⚠ verify.** Current Pillow method for stripping EXIF; current FastAPI
lifespan API.

---

## Phase 4 — Server presence, resolution, crossings, digest, retention

**Goal.** Turn nightly presence uploads into day-granularity crossings and a
morning digest, deleting raw data on schedule.

**Files.** `routers/{presence,digest}.py`, `services/{resolution,ranking,
retention}.py`, tests `test_presence`, `test_digest`, `test_retention`.

**Tasks.**
1. `POST /presence/{day}` per `SPEC.md` §11 (past day only, cutoff, once,
   size a multiple of 256 and at most 1024, encounter tokens only, no
   repeats).
2. Resolution (incremental, §6.13): on each upload, insert its entries into
   `encounters`. Every token held by exactly two uploaders **of the same
   campus** for the day creates a `crossings` row for that pair (a
   cross-campus token is ignored and nothing is stored), keeping only the byte-wise
   smallest shared token. Tokens held by three or more uploaders are
   ignored.
3. Cutoff job: at the start of `d+2`, delete `presence_uploads` and
   `encounters` for day `d`.
4. Digest per §11: a snapshot computed at release time; one entry per peer
   with `last_day` and the canonical encounter token; exclusions with their
   timing; display cap; PeerCard shape; full media list. Ranking `random`
   (stable per viewer and day); `reciprocal_content` deferred to Phase 11
   (optional).
5. `GET /media/{media_id}` authorization (digest window or match), with a
   uniform 404.
6. Retention job for crossings (7 days), OTP codes, expired sessions.
7. Dev route `POST /dev/crossing`.

**Done when.** Presence, digest and retention parts of AC-T1-4 pass; AC-T1-7
passes.

**Human review checklist.**
- [ ] A token uploaded by only one user never creates a crossing (there is a
      test).
- [ ] The presence schema has no daily key, EID, RSSI or time field.
- [ ] A crossing for day d is invisible before 08:00 on d+1, and the digest
      is byte-identical between two releases (tests using the injected clock).
- [ ] PeerCard contains no photos, counts or times.
- [ ] Raw uploads really are deleted at the cutoff (there is a test).

---

## Phase 5 — Server signals, matching, reveal, chat, safety, privacy tests

**Goal.** The heart of the system, built **test-first** for the two privacy
tests.

**Files.** `routers/{signals,matches,messages,safety}.py`,
`services/{matching,arms}.py`, `admin.py` completed, tests `test_signals`,
`test_matches`, `test_reveal`, `test_messages`, `test_safety`,
`test_leak_two_worlds`, `test_route_audit`.

**Tasks (order matters).**
1. **Write `test_leak_two_worlds.py` first** (it must fail): a request-log
   capturing middleware/fixture recording (method, path, query, body length,
   status); deterministic ids and mocked clock; worlds A, B and C as in
   AC-T1-5; clients use the real `mutual_protocol` to build padded sets.
2. **Write `test_route_audit.py` first** (it must fail or be partially
   satisfied): route enumeration, allowlist for block/report and own-resource
   routes (`/profile/voice/{prompt_id}`, `/profile/photos/{index}`), schema
   scan for intent fields, dev-route absence outside dev.
3. `PUT /signals/{epoch}` with all status codes; it stores only. The nightly
   matching batch at `match_batch_time` (§6.9) handles block suppression,
   appends new shared tokens (with epoch) to an existing match, sets
   `notify_after` = next release time, and deletes non-matching tokens.
   Fair delivery (§6.9): the batch only inserts pending rows into
   `match_tokens`; the release step drops pending tokens blindly after a
   block, unmatch or account deletion; after `notify_after`, these leave an
   `ended` match with a frozen card for the other party.
4. `GET /matches`; reveal policy selection by date (`services/arms.py`);
   photo gating for M and C; reveal consent.
5. Messages (length, rate limit), unmatch (deletes messages).
6. Blocks (both directions, removes crossings, deletes match), reports
   (excerpt copy), pause/resume, account deletion cascade and media deletion.
7. Token retention: non-matching tokens deleted by the batch. Ended matches
   are deleted once fetched by the other party, or after 7 days. Block and
   report act only on known ids, with a uniform 204.
8. `admin.py`: list reports, view excerpt, resolve, suspend.

**Done when.** All of AC-T1-4, AC-T1-5, AC-T1-6 pass.

**Human review checklist.**
- [ ] The leak test was committed before the implementation (check the git
      log order) and fails if you deliberately add a per-profile request.
      (Ask Claude to demonstrate this with a temporary throwaway change.)
- [ ] No request or response schema has an intent field.
- [ ] A cross-intent pair (study vs date) never matches (there is a test).
- [ ] Blocking after a match deletes the messages, and the other party sees
      "ended" (there is a test).
- [ ] Nothing in any response changes between the batch and `notify_after`
      (the leak test's world C proves it).

Then run **Prompt 7 (independent security review)** before merging.

---

## Phase 6 — Simulation and report

**Goal.** Answer RQ2 honestly, with ground truth the real system cannot see.

**Files.** `sim/mutual_sim/*.py`, `sim/tests/*.py`, `sim/config.yaml`,
generated `sim/results/`.

**Tasks.**
1. `metrics.py` + tests first (Gini values from `SPEC.md` §15.6; bootstrap
   with fixed seed).
2. `population.py`, `copresence.py` (SBM), `policies.py` (P, M, C),
   `behaviour.py` (signalling, matching, conversation, reveal, churn), all
   vectorised with numpy and driven by a single seeded
   `numpy.random.Generator` per run.
3. `run.py` — main experiment; `sweep.py` — grid; both write CSV results.
4. `report.py` — `report.md` with the assumption caveat first, a parameter
   table, per-policy metrics with 95 % CIs, figures, and a "conclusions that
   reverse within the sweep" section generated from the data.
5. Determinism test (hash of outputs for a fixed seed); a test that `β_a`
   changes discovery outcomes only under P.

**Rule.** The full pipeline (including the report template) is finished and
tested before the main experiment is run for real. Parameters are not changed
after results are seen unless the change and its reason are recorded in the
Progress log.

**Done when.** AC-T1-9 passes; runtimes recorded.

**Human review checklist.**
- [ ] Every parameter in `config.yaml` has a comment: assumption or
      literature-informed range.
- [ ] The report's first paragraph states the results are model-dependent.
- [ ] You can explain what P, M and C mean and what the Gini of "interest
      received" measures.

---

## Phase 7 — Tier 1 documents

**Goal.** Make the research result defensible in writing.

**Files.** `docs/THREAT_MODEL.md`, `docs/SECURITY_ARGUMENT.md`.

**Tasks.** Threat model expanded from `SPEC.md` §7 (assets, adversaries,
in/out of scope, residual risks). Security argument: each claim C1–C5 →
evidence (test file and what it checks) and/or argument; the costs required
by AC-T1-8 (compute them from real uploads in a test or script, not by hand);
the RQ4 section on what privacy makes impossible.

**Done when.** AC-T1-8 and AC-T1-10 pass, and the full Tier 1 verification
(Prompt 6) shows every Tier 1 criterion passing.

**Tier 1 gate.** Stop here, run Prompt 9 (close the loop) for Tier 1, and
show the result to your professor before investing in Tier 2.

---

## Phase 8 — App foundation

**Goal.** A dev build that runs on an emulator with the design system,
navigation skeleton, API client, protocol running under Hermes, lint rules,
check scripts and a fake BLE adapter.

**Tasks.**
1. ⚠ verify: current Expo SDK, its monorepo guidance, required JDK; Android
   Studio emulator (API 31+).
2. Create the Expo app in `app/` (TypeScript), add to workspaces, configure
   Metro for the monorepo; link `@mutual/protocol`.
3. CSPRNG polyfill imported first in the entry file; a dev screen that runs
   10 vectors from `vectors.json` inside the app and shows "protocol OK" —
   proves the TypeScript protocol works under Hermes.
4. Design system: `tokens.ts` (SPEC §13.4), `typography.ts` (Fraunces +
   Inter via `expo-font`), `motion.ts`, `theme.tsx` (system light/dark,
   reduce-motion). Every value is taken from `docs/design/prototype.html`
   (SPEC §13.9): sizes, weights, radii, paddings, shadows, durations.
5. Navigation skeleton per §13.2 with placeholder screens.
6. `api/client.ts` + TanStack Query provider; server base URL from config.
7. ESLint: restricted `fetch`/`XMLHttpRequest`, no hex literals in
   components/routes.
8. Scripts: `check-privacy-invariants.ts` (manifest permissions after
   `expo prebuild`, SDK denylist, network boundary) and `check-contrast.ts`.
9. `presence/bleAdapter.ts` interface and `fakeBle.ts`.
10. Add app hooks to `.pre-commit-config.yaml` (lint, check scripts).

**Done when.** The dev build runs on an emulator in both themes; AC-T2-1,
AC-T2-3, AC-T2-4 pass (AC-T2-3's manifest check may be against the prebuild
output).

**Human review checklist.**
- [ ] The in-app protocol self-test shows OK on the emulator.
- [ ] The merged manifest has no location permissions.
- [ ] Screens look calm and on-brand in both light and dark (take
      screenshots; see Prompt 8 for a design critique).
- [ ] Placeholder screens, tab bar and tokens match
      `docs/design/prototype.html` side by side in both themes.

---

## Phase 9a — BLE spike (two physical phones)

**Goal.** Find out — with measurements — whether the advertisement design in
`SPEC.md` §14 works, before building the full module.

**Tasks.**
1. Minimal local Expo module (Kotlin): advertise a fixed **35-byte** test
   payload with company id 0xFFFF. Try layout 1 (extended advertising)
   first, then layout 2 (advertisement plus scan response, active scanning)
   from SPEC §14.2 / D23. Record which works on each phone, in pockets and
   with the screen off. Scan with a manufacturer-data filter; log sightings
   with RSSI to a file; a bare debug screen with start/stop and export.
2. `BLUETOOTH_SCAN` with `neverForLocation`, no location permission.
3. Measurements on two Android 12+ phones, recorded in `docs/BLE_SPIKE.md`:
   detection with `neverForLocation` (yes/no); detection rate at 1 m, 3 m,
   10 m (phones in pockets and on a desk); walk-past false-crossing rate;
   screen-off scanning; whether restarting advertising rotates the device
   address; 8-hour battery drain versus a control day.
4. Recommend thresholds (`rssi_threshold_dbm`, `min_qualified_windows`, duty
   cycle) **as a proposed spec change**, not a silent config edit.

**Done when.** AC-T2-6 recorded; payload format confirmed or an alternative
proposed through a spec change; human approves before 9b.

**Escalation rule.** If detection requires a location permission, stop and
escalate (CLAUDE.md invariant 3).

---

## Phase 9b — Native BLE module (full)

**Goal.** The production-shape module from `SPEC.md` §14: EID schedule from
JS, rotation every 15 minutes with advertising restart, duty-cycled filtered
scanning in a foreground service, own-EID filtering, per-(own EID, heard
EID) window counts above the RSSI threshold persisted on device, drain API, boot restart, pause,
fail-safe when the schedule runs out; `nativeBle.ts` wrapper implementing the
same interface as `fakeBle.ts`.

**Done when.** On two phones, a 1-hour session near each other produces
aggregated sightings on both; drain returns them and clears them; pausing
stops advertising and scanning (verified with the other phone);
`npm test -w app` covers the TypeScript wrapper.

**⚠ verify.** Android 14+ foreground-service type and permission
requirements for `connectedDevice`; notification permission flow on
Android 13+.

---

## Phase 10 — Onboarding and profile

**Goal.** J1 end to end against the local server, in the design language.

**Tasks.** Onboarding screens (§13.2), OTP flow, age screen (DOB sent once,
never stored on device), basics, prompt picker with required `looking_for`,
**VoiceRecorder** (≤ 30 s, captures 48 waveform values from metering) and
**VoicePlayer**, photo picker and upload with the plain explanation of when
photos are shown, permissions screen explaining the persistent notification,
identity key generation into secure storage, **GenerativeAvatar**, the You tab
profile editor, and the privacy screen (`privacy.tsx`, S12).

**Done when.** A new synthetic user can onboard on an emulator in under
3 minutes; jest tests cover form validation and key generation; screenshots
of every onboarding screen in both themes reviewed (Prompt 8) and matching
`docs/design/prototype.html` (Welcome, How it works, You, Privacy).

**⚠ verify.** Current Expo audio-recording package and its metering API.

---

## Phase 11 — Core loop and end-to-end

**Goal.** J2–J6 working on emulators with the fake adapter, and on phones
with the native module.

**Tasks (scheduler logic before UI).**
1. `presence/`: daily keys 2 days ahead, schedule to adapter, drain,
   `encounters.ts` (encounter tokens and the local token → time-block map),
   padded nightly upload at a random time in the window via the
   background-task package (⚠ verify), and on next open before the cutoff.
   Daily keys are deleted after upload.
2. `signals/`: local DB, TTL, 20-cap, withdrawal that frees the slot
   instantly with no network request (after-upload copy, §13.6),
   match verification, `setBuilder` via protocol-ts,
   `scheduler` (random time in window, once per epoch, never for a past epoch,
   never at or after `match_batch_time`, uses the server epoch), `upload` —
   **with unit tests before any UI**.
3. `digest/`: fetch, eager prefetch of every media item in sorted order,
   cache; Today screen with the morning letter, CrossingCards, "Earlier this
   week", empty and before-release states; time chips computed from local
   sighting logs.
4. SignalSheet, SignalDots, Signals tab with withdraw.
5. `matches/resolve.ts`; Mutuals tab; RevealMoment (with `FLAG_SECURE`,
   e.g. via `expo-screen-capture` ⚠ verify); chat with polling.
6. Block and report sheets; pause/resume; account deletion; notifications
   with generic text only (optional).
7. Dev panel: clock offset, simulate crossing, show current epoch and policy.
8. Optional: `reciprocal_content` ranking on the server (§11.1).
9. Write `docs/E2E_CHECKLIST.md` from the items in AC-T2-5 (one line per
   step, each with the expected result and a blank date), then run it on two
   emulators with the fake adapter and dev routes; then on two phones if
   available.
10. Accessibility pass (font scaling 200 %, screen-reader labels).

**Done when.** AC-T2-2 and AC-T2-5 pass; AC-T2-1, AC-T2-3, AC-T2-4 still
pass.

**Human review checklist.**
- [ ] Open a card, play its voice note, and confirm with the server's dev
      request log that no request was made at that moment.
- [ ] Send a signal in the morning and confirm nothing is uploaded until the
      evening window.
- [ ] The RevealMoment cannot be screenshotted.
- [ ] Today, Profile (incl. "Not for me", device-local only), SignalSheet,
      Signals, Mutuals, RevealMoment and Chat match
      `docs/design/prototype.html` side by side, in both themes.
- [ ] Run Prompt 7 (security review) on the app code before merging.

---

## Phase 12 — Field pilot package (gated)

**Precondition.** Q4 answered, written ethics approval obtained, institutional
permission obtained, `study/APPROVAL.md` written **by you**.

**Tasks.** `PREREGISTRATION.md` (hypotheses, outcomes, analysis, block
schedule, stopping rules) committed before day one; `CONSENT.md`,
`PARTICIPANT_INFO.md` (plain language, withdrawal, data use, contact);
`ETHICS_APPLICATION_DRAFT.md` (may be drafted before approval to support
the application); consent screen in the app (study mode only); `export.py`
(counts only, HMAC ids), `make_synthetic_export.py`, `analyze.py`.

**Done when.** AC-T3-2 and AC-T3-3 pass. Actual recruitment starts only after
you have re-read the approval conditions.

Note: the ethics application draft and synthetic analysis pipeline may be
prepared before approval. Anything that touches real participants may not.

---

## Phase 13 — Close the loop

Run Prompt 9 after Phase 7 (Tier 1) and again after Phase 11 (Tier 2):
a design-decision walkthrough in `docs/design-decisions/` built from
`SPEC.md`, `PLAN.md` and the git history, and `docs/INTERVIEW_QUESTIONS.md`.
Check the walkthrough against the spec — an agent's explanation of its own
choices can be fluent and wrong.

---

## Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Mutual's BLE advertisement is filtered under `neverForLocation` | Medium | High (Tier 2) | Spike first (9a); alternative payload formats; escalate rather than add location |
| R2 | Android background limits kill scanning on some phone brands (aggressive battery managers) | High | Medium | Foreground service; measure in spike; document affected brands; Tier 1 unaffected |
| R3 | Expo monorepo + local package linking issues | Medium | Medium | Follow Expo monorepo guide; protocol self-test screen in Phase 8 |
| R4 | `crypto.getRandomValues` missing under Hermes | Medium | High | Polyfill imported first; `random.ts` throws loudly; self-test |
| R5 | Cross-language byte mismatch | Low (with vectors) | High | Vectors are the contract; no implementation merges without them |
| R6 | Leak test is vacuous (passes even when leaking) | Medium | High | World C must detect a match; deliberate-leak demonstration in Phase 5 review |
| R7 | Simulation conclusions driven by chosen parameters | High | Medium | Sweep; report reversals; caveat first; no post-hoc tuning |
| R8 | Ethics approval slow or refused | Medium | Medium (Tier 3 only) | Tier 1 and 2 are complete without it |
| R9 | Battery drain unacceptable | Medium | Medium | Duty cycle in config; measured; spec change if > 10 % per 8 h |
| R10 | Scope creep (it is a big project) | High | High | Tiers; Tier 1 gate; one phase per session; CLAUDE.md rule 5 |
| R11 | Version drift (Expo packages, noble APIs, Android rules) | High | Low–Medium | ⚠ verify items; pins recorded in the Progress log |
| R12 | 35-byte BLE payload (D23) unsupported or unreliable on some phones | Medium | High (Tier 2) | Spike tests both layouts in 9a; Tier 1 unaffected; fallback to v1.0 server-side resolution is a human decision |

---

## Deferred improvements (the human chose to do these at the end)

Proposed on 2026-10-05 and parked until the plan is complete. None is
approved yet; each needs a spec change when picked up.

1. **Spec review.** PROMPT.md Prompt 1 (spec interrogation) was skipped.
   Prompt 2 (adversarial protocol review) **was run on 2026-10-05**, and its
   fixes are in SPEC v1.2.
2. **Parallel UI track.** Build Phase 8/10/11 screens against the fake BLE
   adapter and a mock API alongside Tier 1, instead of after it.
3. **Stronger AI/DS component.** Promote `reciprocal_content` ranking
   (§11.1) from optional to a planned, offline-evaluated deliverable on
   synthetic profiles. Present the simulation as the main data-science
   result.
4. **Colour tokens.** Revisit the cream/terracotta palette once screens exist
   on a device.
5. **Spec gap.** §6.11 / §18 `media_prefetch_cap_mb`: say what happens when
   the cap is reached. The answer must not depend on attention, e.g. skip in
   fixed media-id order.
6. **Cold-start honesty.** State in the report that discovery needs many
   users with the app running; demos rely on the fake adapter and `/dev/seed`.
7. **"Hold" other date signals during a date mutual** (the human's idea,
   2026-10-05). Only worth it if signals ever become scarce, for example
   through a daily allowance or a subscription; payments are out of scope
   (§4). It is privacy-safe if done entirely on the device: held signals are
   simply left out of the nightly upload, and the server cannot tell them
   from decoys. Open questions: whether the 7-day expiry pauses while held,
   and what happens when two date matches arrive on the same night.
8. **A fully atomic message rate limit.** Phase 5's security review found
   the 30/minute check is check-then-insert, so a true race could let a
   couple of extra messages through. Not a privacy issue (S3 is an
   abuse-surface limit), and fixing it needs a dedicated per-minute counter
   row with its own unique constraint — more machinery than the benefit
   justifies for a single-process research prototype. Revisit only if
   chat abuse is ever actually observed.

---

## Measured values (fill in as they are produced)

| Quantity | Value | Where measured | Date |
|---|---|---|---|
| Signal upload size (bytes) | 932 (fixed, any number of real signals) | AC-T1-8 (`server/tests/test_costs.py`) | 2026-10-06 |
| Presence upload size, 50 / 500 sightings (bytes) | 11,792 / 23,568 (1 sighting = same as 50) | AC-T1-8 (`server/tests/test_costs.py`) | 2026-10-06 |
| Worst-case match latency (hours) | 38 tap→both told; 24 digest→told; 56 crossing→told | AC-T1-8 (`server/tests/test_costs.py`) | 2026-10-06 |
| Simulation main-experiment runtime (min, one core) | 0.17 min (10.2 s), 3 policies × 30 seeds | Phase 6 | 2026-10-06 |
| Sweep runtime (min) | 7.7 min (460.8 s), 4050 runs | Phase 6 | 2026-10-06 |
| BLE detection with neverForLocation | | Phase 9a | |
| Detection rate 1 m / 3 m / 10 m | | Phase 9a | |
| Walk-past false-crossing rate | | Phase 9a | |
| Battery drain per 8 h (vs control) | | Phase 9a | |

---

## Progress log

Add an entry at the end of every session. Newest at the bottom.

```
### YYYY-MM-DD — Phase N — <in progress | done | blocked>
- Done:
- Tests: <command> → <result>
- Measured:
- Version pins chosen:
- Spec changes (approved by human on <date>):
- Deviations from this plan and why:
- Next session starts with:
```

### 2026-10-05 — Phase 0 — done (awaiting human review; nothing committed)
- Done: git repo (`main`, no commits yet); `.gitignore`, `.gitattributes`
  (LF line endings); root `package.json` with workspace
  `packages/protocol-ts` (stub `package.json`); `.venv` on Python 3.11;
  `pyproject.toml` stubs with `[dev]` extras for `protocol_py`, `server`,
  `sim` (empty `__init__.py` only); `constants.json` from §6.2;
  `.pre-commit-config.yaml` (ruff check + format, pytest protocol hook);
  `README.md`; `git-commit` skill in `.claude/skills/`. Approved prototype
  saved as `docs/design/prototype.html`.
- Tests:
  - `pre-commit run --all-files` → ruff check Passed, ruff format Passed,
    pytest protocol Passed.
  - `pytest packages/protocol_py server sim -q` → "no tests ran", exit 5
    (expected: zero tests collected).
  - `npm install` → exit 0, 0 vulnerabilities.
  - `constants.json` parsed and compared with the SPEC §6.2 block → MATCH.
- Measured: —
- Version pins chosen: Git 2.55.0.windows.2; Python 3.11.15 (uv-managed);
  Node 24.19.0 LTS (installed via winget this session); npm 11.17.0;
  pytest 9.1.1; ruff 0.16.10 (pre-commit rev v0.16.10); httpx 0.28.1;
  pre-commit 4.6.2; setuptools 84.0.0.
- Spec changes (approved by human on 2026-10-05): SPEC v1.1. Adds §13.9
  visual reference (`docs/design/prototype.html`, the app must match it
  exactly), `profile/[id].tsx` route, tokens `onSignal`/`onMutual`/`scrim`,
  D19, Q7 (Python via uv). CLAUDE.md §4 venv command and UI principles
  updated to match.
- Deviations from this plan and why:
  - The repo root is the existing project folder rather than a new
    `mutual/` folder.
  - `claude.md` renamed to `CLAUDE.md`.
  - `prompt.md` is git-ignored instead of moved.
  - The pytest hook treats exit code 5 (no tests) as a pass, otherwise
    pre-commit fails until Phase 1.
  - `.gitattributes` was added (not in §20) to keep `vectors.json`
    byte-stable.
  - The `git-commit` skill was created in Phase 0 as task 9 says.
- Open before Phase 1: **Q5** (confirm the five intents; the prototype
  shows the §6.2 five, but say so explicitly). Strongly recommended:
  PROMPT.md Prompt 2 (protocol review).
- Next session starts with: human reviews the Phase 0 diff, commits it
  (`/git-commit` or by hand), then Phase 1 — Protocol, Python reference +
  vectors.

### 2026-10-05 — Spec v1.2 after protocol review — done (awaiting commit)
- Done:
  - Phase 0 committed by the human (`923a42a`).
  - Q5 confirmed.
  - PROMPT.md Prompt 2 run: an independent subagent saw only SPEC §6, §7,
    §9, §11 and CLAUDE.md §5. It reported 15 findings: 1 critical, 3 high,
    the rest medium or low.
  - The human accepted the presence redesign (1a). For F2 the human first
    chose "date is one person at a time". Later the same day, after
    considering a "hold" variant, they agreed to remove per-intent limits
    entirely for simplicity (D20). The hold idea is parked as deferred
    improvement 7. Prototype changes are applied now ("do what is best").
- Spec changes (approved by human on 2026-10-05), by finding:
  - F1: batch matching and fair delivery (§6.9, D13, invariant 12).
  - F3, F6, F7: encounter tokens; daily keys never leave the device (§6.13,
    §6.8, §6.11, §12, §14.4, D5).
  - F4: no IP logging (§9, D22).
  - F5: uids bound into the pair key, plus identity key validity (§6.5,
    D21).
  - F2: once fair delivery (F1) is in place, choosing several intents
    reveals only what both chose. No per-intent limit (§6.10, D20).
  - F8: C1 restated across every account and response body (AC-T1-5).
  - F9: C3 narrowed.
  - F10: digest snapshot, one entry per peer, exclusion timing (§11).
  - F11: operator governance and token deletion after the batch (§7.2, Q8).
  - F12: withdrawal semantics and copy (§6.10, §13.6).
  - F13: timezone without daylight saving, server-corrected clock, address
    rotation (§6.3, §14.2).
  - F14: uniform 204 / 404 and silent OTP cooldown (§11).
  - F15: epoch stored with each matched token; "until matched" scoped per
    intent.
  - `constants.json` updated to §6.2. No `protocol_version` bump, because no
    protocol code exists yet (§6.12).
- Not adopted: end-to-end encrypted chat (F9), which conflicts with D10.
  Disclosing the counterparty's full set (F2) was rejected because it would
  leak one-sided intents.
- Prototype: the date-slot rule was added, then removed again with D20. The
  prototype is back to its approved behaviour. `docs/design/prototype.html`
  and the published artifact are in sync.
- Next session starts with: human commits "Spec v1.2 after protocol review",
  then Phase 1 in a new session.

### 2026-10-05 — Phase 1 — done (awaiting human review; nothing committed)
- Done:
  - Spec v1.2 committed by the human (`503b347`); branch
    `phase-1-protocol-py`.
  - A second independent review covered §6.13, §6.5 and §6.9. It found 12
    issues, N1 critical. All were applied as **SPEC v1.3 under the human's
    standing delegation for security fixes** (DECISIONS_LOG entries 8–9).
  - `mutual_protocol`: `constants`, `encoding`, `keys`, `tokens`, `eid`,
    `encounter`, `vectors`, each with tests.
  - `packages/protocol-spec/vectors.json`: 135 deterministic cases.
  - New `docs/DECISIONS_LOG.md`, plus CLAUDE.md §8 rule 8 to keep it
    current.
- Tests:
  - `pytest packages/protocol_py -q` → 130 passed in 0.64 s.
  - `pytest packages/protocol_py server sim -q` → 130 passed.
  - `python -m mutual_protocol.vectors --out …` → 135 cases. A second
    regeneration is byte-identical (SHA-256 equal), and `test_vectors.py`
    asserts it.
  - `pre-commit run --all-files` → ruff check, ruff format and pytest all
    Passed.
  - `constants.json` vs SPEC §6.2 → MATCH.
- Independent check: three vectors (pair key, interest token, encounter
  token) were recomputed with only `hashlib` + `cryptography` → all True.
- ⚠ verify results:
  - `cryptography` 50.0.2 raises `ValueError` for all 5 canonical low-order
    points and 4 non-canonical encodings; the explicit check is kept anyway.
  - A top-bit-set key is an alias with the same shared secret, so the
    canonical rule is required.
  - BLAKE2b zero-pads a short `person`, so exactly 16 bytes is enforced.
  - `uuid.bytes` is in RFC 4122 order.
- Measured: —
- Version pins chosen: cryptography 50.0.2.
- Spec changes:
  - SPEC v1.3 (§6.2, §6.8, §6.9, §6.10, §6.13, §7.2, §7.3, §9, §11, §12,
    §14.2, §14.4, §18, §19, D5, D23; `constants.json`: `eid_bytes` 32,
    `encounter_pad_block`, `encounter_max_entries`).
  - CLAUDE.md invariants 3 and 10, and §8 rule 8.
  - PLAN Phases 1, 4, 5 and 9a; risk R12.
- Deviations from this plan and why:
  - Phase 1 ran in the same session as Phase 0 and the reviews, at the
    human's request ("start").
  - `tests/test_constants.py` was added (§20 updated).
  - `ProtocolError` lives in `encoding.py`, so no extra module was needed.
  - Vectors are hex, not base64url, for readability; base64url has its own
    vector group.
  - EIDs became 32-byte keys (v1.3), so `eid.py` also exports
    `ephemeral_private_key`.
- Human review checklist (Phase 1):
  - No `random` module anywhere, checked with a search.
  - Constants come only from `constants.json`.
  - Public keys are sorted as bytes, with uids bound to their own key (there
    is a test).
  - The token message is `epoch(10) || intent(1)`, recomputed by hand in
    `test_token_message_layout`.
  - `encounter_token(d, a, b)` is symmetric (there is a test).
  - Still for the human: be able to say in one sentence each what a pair key,
    a token, an EID and an encounter token are.
- Next session starts with:
  - the human reviews the diff and commits ("Phase 1 (protocol-py) …"), then
    merges `phase-1-protocol-py` into `main`;
  - then Phase 2 (TypeScript protocol + cross-language vectors) in a new
    session. Its ⚠ verify items are the `@noble/curves` and `@noble/hashes`
    versions and import paths, and whether noble's x25519 rejects low-order
    points.

### 2026-10-05 — Phase 2 — done (awaiting human review; nothing committed)
- Done:
  - Phase 1 committed by the human (`39e7d21`, not yet merged into `main`).
    Branch `phase-2-protocol-ts` was created from `phase-1-protocol-py`.
  - `@mutual/protocol`: `src/{constants,encoding,random,keys,tokens,eid,
    encounter,index}.ts`, `test/{vectors,properties}.test.ts`, and
    `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts`.
  - New pre-commit hook `protocol-ts`.
  - DECISIONS_LOG entry 11.
- Tests:
  - `npm test -w packages/protocol-ts` → 2 files, 29 tests passed (~10 s).
    This covers all 135 vectors, from both sides where applicable, and the
    error cases.
  - `npm run typecheck -w packages/protocol-ts` → exit 0 (strict,
    `noUncheckedIndexedAccess`).
  - `pre-commit run --all-files` → ruff check, ruff format, pytest and
    protocol-ts all Passed.
  - `pytest packages/protocol_py server sim -q` → 130 passed.
- ⚠ verify results:
  - Import paths are `@noble/curves/ed25519.js` (`x25519`),
    `@noble/hashes/blake2.js` (`blake2b`) and `@noble/hashes/utils.js`. Both
    packages are ESM-only.
  - noble `getSharedSecret` throws on all 5 low-order points and on u = p,
    p+1 and 2^255.
  - noble **accepts** non-canonical 2^256−1 and top-bit aliases (Python
    refuses). Our `isValidPublicKey` therefore runs before every exchange.
  - noble **rejects** a personalization that is not exactly 16 bytes (Python
    zero-pads).
  - `getPublicKey` clamps identically to Python, matching the EID vectors.
  - `crypto.getRandomValues` exists in Node 24. React Native needs the
    polyfill (Phase 8).
- Version pins chosen: @noble/curves 2.4.0, @noble/hashes 2.4.0, vitest
  5.0.3, typescript 7.0.2, @types/node 24.19.1.
- Spec changes: none. CLAUDE.md §4 gained the typecheck command.
- Deviations from this plan and why:
  - The package exports TypeScript source instead of an "ESM build". Metro
    compiles workspace TypeScript, so a build step adds nothing; revisit in
    Phase 8 if Metro disagrees.
  - Hermes-safety checks live inside `properties.test.ts`, so no new test
    file was needed.
  - Phase 2 ran in the same session as Phases 0–1, at the human's request.
- Human review checklist (Phase 2):
  - No `Buffer`, `fs`, Node `crypto` or other Node-only import in `src/`
    (enforced by a test).
  - Byte comparisons and sorting use `Uint8Array` (`compareBytes`), never
    strings.
  - Every vector passes; none are skipped.
- Next session starts with:
  - the human reviews and commits Phase 2, then merges phases 1 and 2 into
    `main`;
  - then Phase 3 (server core). Phase 3 **needs Q1** (college email domain)
    and **Q2** (confirm Asia/Kolkata) answered first.

### 2026-10-05 — Phase 3 — done (awaiting human review; nothing committed)
- Done:
  - Q1/Q2 answered; SPEC v1.4 (§4.1 campuses, D24) committed by the human
    (`5a842fe`).
  - `main` fast-forwarded to `5a842fe` by Claude at the human's request (not
    pushed). Branch `phase-3-server-core`.
- Server package `mutual_server`:
  - `config` (Pydantic, YAML + env, no-DST timezone check, study gate,
    console email refused in prod);
  - `clock` (injectable, dev offset), `ids` (UUIDv4 / deterministic), `db`
    (UTC-aware datetimes, SQLite foreign keys), `models` (all 17 tables of
    §12);
  - `security`, `errors`, `deps`, `schemas`;
  - services `campus`, `email`, `media`;
  - routers `auth`, `account`, `profile`, `config_route`, `dev`;
  - `admin` CLI; `data/prompts.json` (18 prompts);
  - Alembic `alembic.ini`, `migrations/env.py`,
    `versions/0001_initial_schema.py`;
  - `config.example.yaml`.
- Tests:
  - `pytest server -q` → 46 passed. Files: `test_auth`, `test_account`,
    `test_profile`, `test_study_gate`, `test_app`.
  - `pytest packages/protocol_py server sim -q` → 176 passed (8.3 s).
  - `pre-commit run --all-files` → ruff check, ruff format, pytest protocol,
    pytest server and protocol-ts all Passed.
  - `alembic upgrade head` on a fresh SQLite file → exit 0.
  - `alembic check` → "No new upgrade operations detected".
  - `downgrade base` then `upgrade head` → exit 0. 18 tables, including
    `alembic_version`, and both partial unique indexes present.
- Smoke test (real uvicorn, dev, `--no-access-log`):
  - config, request-otp (code read from the console), verify, create
    account and `/me` → "Smoke @ Example College";
  - a pending college gets 403 `campus_not_open`; dev seed works;
  - **0 access-log lines** in the server output.
  - Admin CLI `campuses list` / `approve iitb.ac.in` worked against the same
    database.
- ⚠ verify results:
  - Pillow 12.3.0: plain re-encode and `frombytes` rebuild both drop EXIF,
    GPS and XMP; `exif_transpose` applies orientation. The rebuild is used.
  - FastAPI 0.142.2 supports `lifespan=`.
  - Windows needs `tzdata` for `zoneinfo`.
- Version pins chosen: fastapi 0.142.2, uvicorn 0.54.0, SQLAlchemy 2.1.3,
  alembic 1.20.0, pydantic 2.13.5, PyYAML 6.0.3, python-multipart 0.0.32,
  pillow 12.3.0, tzdata 2026.5.
- Spec changes:
  - §12: `users.identity_key_changed_at`, `otp_codes.campus_id`,
    `sessions.campus_id` and `created_at`, `media.duration_ms`; the partial
    unique index is documented.
  - §18 points to `config.example.yaml` as the full config (new `database`,
    `email`, `profile` and `media` keys).
  - §20: new modules and tests.
  - CLAUDE.md §4: run, migration and admin commands.
  - DECISIONS_LOG entry 13.
- Deviations from this plan and why:
  - OTP codes use HMAC rather than plain SHA-256 (security, entry 13).
  - `DELETE /account` is partial until Phase 5.
  - `ids.py`, `errors.py`, `deps.py`, `services/campus.py` and `test_app.py`
    were added (§20 updated).
  - Ruff B008 is told about FastAPI's `Depends`, `File` and `Form`.
  - Phase 3 ran in the same session as earlier phases, at the human's
    request.
- Human review checklist (Phase 3):
  - `date_of_birth` appears only in `schemas.py` (request) and the age
    check in `routers/account.py`, never in a model or a log. A test also
    searches the whole database and the 422 response for the date.
  - There is no plaintext email column. A test dumps every table and
    searches for the email, code and token.
  - OTP comparison uses `hmac.compare_digest` (`security.otp_matches`,
    asserted by a test).
  - `datetime.now` appears only in `clock.py` (asserted by a test).
  - Dev routes are absent unless `MUTUAL_ENV=dev` (404 test), and present in
    dev (test).
- Next session starts with:
  - the human reviews and commits Phase 3;
  - then Phase 4: presence uploads, crossing resolution with the campus
    filter, digest snapshots and retention. No open questions block it.

### 2026-10-05 — Phase 4 — done (awaiting human review; nothing committed)
- Done:
  - Phase 3 committed by the human (`e262ac3`); `main` fast-forwarded to it
    by Claude (not pushed). Branch `phase-4-presence-digest`.
  - `routers/{presence,digest}.py`,
    `services/{resolution,ranking,digest,retention}.py`, new model
    `DigestSnapshot` / table `digest_snapshots`, new `POST /dev/crossing`,
    retention wired into `main.py`'s lifespan (startup + hourly
    background task).
  - Migration `0002_digest_snapshots.py` (autogenerated).
- Tests:
  - `pytest server -q` → 72 passed (was 46; +26: `test_presence` 10,
    `test_digest` 11, `test_retention` 4, plus one app-level addition).
  - `pytest packages/protocol_py server sim -q` → 202 passed (8.4 s).
  - `pre-commit run --all-files` → all five hooks Passed.
  - `alembic upgrade head` on a fresh DB → exit 0; `alembic check` → no
    drift; `downgrade base` → `upgrade head` → exit 0.
  - Live smoke test (real uvicorn, dev, `--no-access-log`): dev clock
    travel, `POST /dev/crossing`, `GET /digest` showing the crossed peer,
    a second fetch byte-identical, a presence upload accepted, 0
    access-log lines, server survived the background retention task.
- Measured: —
- Version pins chosen: none new.
- Spec changes: §12 adds `digest_snapshots`; §9 adds its retention row;
  §20 services list adds `digest`. DECISIONS_LOG entry 14.
- Deviations from this plan and why:
  - `digest_snapshots` is a new table not listed in the original §12 (the
    spec describes the snapshot behaviour but names no storage mechanism;
    see DECISIONS_LOG 14).
  - `POST /dev/crossing` validates same-campus (422 otherwise), not
    specified but consistent with invariant 13.
  - Retention also prunes old `digest_snapshots`, by extension of the
    7-day crossing bound.
- Human review checklist (Phase 4):
  - A token uploaded by only one user never creates a crossing
    (`test_one_sided_upload_never_creates_a_crossing`).
  - `PresenceUploadIn` has exactly one field, `encounters`; an extra field
    (`daily_key`, `windows`) is rejected (`extra="forbid"`).
  - A crossing for day d is invisible before 08:00 on d+1, and two digest
    fetches inside the same release window are byte-identical
    (`test_crossing_invisible_until_release_the_next_day`,
    `test_digest_is_byte_identical_until_next_release_then_shows_late_crossings`).
  - `PeerCardOut` fields are exactly `peer_id, first_name, year_of_study,
    identity_pk, prompts` — no photos, no counts, no times
    (`test_peer_card_shape_has_no_photos_counts_or_times`).
  - Presence rows really are gone after the cutoff
    (`test_presence_cutoff_deletes_at_start_of_d_plus_2`).
- Next session starts with:
  - the human reviews and commits Phase 4;
  - then Phase 5: signals, matching, reveal, chat, safety, and the two
    privacy tests (`test_leak_two_worlds.py`, `test_route_audit.py`),
    written first. No open questions block it, but Q8 (who holds operator
    access in a pilot) should be answered before any real deployment.

### 2026-10-05/06 — Phase 5 — done (awaiting human review; nothing committed)
- Done:
  - Phase 4 committed by the human (`a2d9157`); `main` fast-forwarded to it
    by Claude (not pushed). Branch `phase-5-signals-matching`.
  - `routers/{signals,matches,messages,safety}.py`;
    `services/{matching,arms,cards}.py`; `admin.py` completed (reports
    list/view/resolve); model additions `MatchToken.notified`,
    `MatchRead`; config addition `reveal.ended_match_retention_days`.
  - Migration `0003_match_reads_and_notified_tokens.py`.
  - Tests (written together with the implementation, not strictly
    test-first — see DECISIONS_LOG 15): `test_leak_two_worlds.py`,
    `test_route_audit.py`, `test_signals.py`, `test_matches.py`,
    `test_reveal.py`, `test_messages.py`, `test_safety.py`; extended
    `test_account.py` (deletion cascade) and `test_retention.py`
    (30-day ended-match fallback).
- Tests:
  - `pytest server -q` → 122 passed (~38 s, the slowest suite so far due
    to multi-day clock-advance tests).
  - `pytest packages/protocol_py server sim -q` → 252 passed.
  - `pre-commit run --all-files` → all five hooks Passed.
  - `alembic upgrade head` on a fresh DB, `alembic check` (no drift),
    `downgrade base` → `upgrade head` round trip: all exit 0.
  - Leak-test sensitivity demonstrated directly (throwaway, reverted): a
    one-line change that showed a match before its token was notified made
    `test_worlds_a_and_b_are_indistinguishable_and_c_is_not_vacuous` fail;
    reverting it restored the pass.
  - Live smoke test over real HTTP, dev server, `--no-access-log`: signup
    → real signal upload for both sides → dev-clock-advance past
    `match_batch_time` (pre-release `GET /matches` empty in every world) →
    advance past next-day `release_time` → `GET /matches` now shows the
    match (batch and release triggered *lazily* by the HTTP call itself,
    never invoked directly) → message send/receive → block ends it
    silently for the other side. 0 access-log lines throughout.
- Measured: —
- Version pins chosen: none new.
- Spec changes: §7.2 (pending-match/digest-exclusion limitation, new
  row); §9 retention row already present, now implemented; §12 adds
  `notified` to `match_tokens` and the new `match_reads` table; §18 adds
  `reveal.ended_match_retention_days`; §20 services list adds `cards`.
  DECISIONS_LOG entry 15.
- Deviations from this plan and why:
  - The two privacy tests were not committed before the implementation in
    separate commits (everything lands in one phase-5 commit); their
    catching power was instead verified directly via a throwaway edit.
  - `services/cards.py` was added (not in the original Files line) to
    share `PeerCard`/frozen-card building between `digest.py` and
    `matches.py` — a plain refactor, no behaviour change.
  - `admin.py`'s report commands were not given their own test file;
    exercised only by the type checker and manual review (consistent with
    Phase 3's treatment of the campus commands).
- Human review checklist (Phase 5):
  - Leak-test sensitivity: confirmed live (see above), not just by
    inspection.
  - No request or response schema has an intent field
    (`test_no_schema_field_is_named_or_typed_as_an_intent`).
  - A cross-intent pair never matches
    (`test_cross_intent_signals_never_match`).
  - Blocking after a match deletes the messages, and the other party sees
    "ended" (`test_block_after_a_match_ends_it_for_the_other_side_silently`,
    `test_unmatch_deletes_messages_and_shows_ended_to_the_other_side`).
  - Nothing in any response changes between the batch and `notify_after`
    (the leak test's mid-point check, added specifically for this).
- **Prompt 7 (independent security review), run as required before merging
  this phase:** a background subagent reviewed the real source under
  `server/` (not the spec, not this conversation) against all 11 CLAUDE.md
  §5 invariants and C1–C5. Verdict: every one holds; nothing above low
  severity. Three low-severity hardening findings were applied under the
  human's standing delegation for security fixes (DECISIONS_LOG entry 16):
  a global `IntegrityError` → `409` handler (`errors.py`), removal of the
  vestigial `users.deleted_at` column and its now-plain unique index
  (migration `0004`), and the message-rate-limit atomicity gap was parked
  as deferred improvement #8 rather than fixed (abuse-surface only).
- Tests after the review's fixes: `pytest server -q` → 123 passed;
  `pytest packages/protocol_py server sim -q` → 253 passed; migration
  0001→0004 round-trips cleanly with no autogenerate drift.
- Next session starts with:
  - the human reviews the diff (including the review's own findings) and
    commits;
  - then Phase 6: the simulation (can run in parallel in a separate
    worktree) — no open questions block it.

### 2026-10-06 — Phase 6 — done (awaiting human review; nothing committed)
- Done:
  - Phase 5 committed by the human (`fda2372`); `main` fast-forwarded to it
    by Claude (not pushed). Branch `phase-6-simulation`.
  - `sim/mutual_sim/{metrics,population,copresence,policies,behaviour,
    run,sweep,report}.py`; `sim/tests/{test_metrics,test_determinism,
    test_policies}.py`; `sim/config.yaml` (every §15 parameter, each
    commented assumption/literature-informed); `sim/pyproject.toml`
    dependencies (numpy, pandas, matplotlib, PyYAML).
  - Generated: `sim/results/{main_experiment.csv, sweep.csv, report.md,
    figures/*.png}` (844 KB total, committed per §20).
  - New pre-commit hook `pytest-sim`.
- Tests:
  - `metrics.py` written and tested first, as instructed: `gini`'s three
    spec test values, zero-mean and single-value edge cases, agreement
    with the naive O(n²) double sum, and a seeded `bootstrap_ci`.
  - `pytest sim -q` → 15 passed. `pytest packages/protocol_py server sim
    -q` → 268 passed.
  - AC-T1-9's two specific checks: identical seed ⇒ identical output hash
    (`test_determinism.py`); `beta_a` changes `signals_received` under
    policy P only, confirmed with `beta_a∈{0,5}` under all three policies
    (`test_policies.py`) — also verified ad hoc against the real `N=150`
    config before formalizing the test.
  - Pipeline smoke-tested before any real run, per the plan's own
    instruction: a 2-seed main-experiment run producing a complete
    `report.md` with figures, then a tiny 2x2x1-cell/2-seed sweep
    appending its section correctly — both checked by eye before the real
    runs below.
  - `pre-commit run --all-files` → all six hooks Passed.
- Measured (now filled into the table below too):
  - Main experiment (3 policies × 30 seeds, T=56): **10.2 s**.
  - Sweep (3 policies × 45 cells × 30 seeds = 4050 runs): **460.8 s**
    (7.7 min).
  - Headline result (N=600, default config, bootstrap 95% CI, 30 seeds):
    policy P's Gini of interest received 0.664 [0.658, 0.669] vs. M 0.607
    [0.601, 0.614] and C 0.610 [0.604, 0.615]; share of matches touching
    the top attractiveness decile 0.312 (P) vs. ~0.18 (M, C); retention at
    day 56 0.686 (P) / 0.695 (M) / **0.394 (C)**. Full table in
    `sim/results/report.md`.
  - The sweep names 6 of 8 metrics where the main experiment's "which
    policy wins" ranking reverses in at least one cell — always traced to
    `beta_a_over_beta_c=0` (attractiveness carries no weight at all, the
    expected null case) or a low `K`. Full list in the report's own
    "Sensitivity sweep" section.
- Version pins chosen: numpy 2.4.6, pandas 3.0.6, matplotlib 3.11.2,
  PyYAML 6.0.3.
- Spec changes: none (every parameter, output file and test name already
  matched §15/§19/§20 as drafted). DECISIONS_LOG entry 17 records seven
  modelling decisions §15 left unstated (which intent the model
  represents, the same-hostel/same-department tie-break, what "progress"
  means per policy, the "recent matches" churn window, the top-decile
  metric's reference population, the reveal-ending metric's denominator,
  and the same-day mutual-signal detection fix).
- Deviations from this plan and why: none beyond the documented modelling
  decisions above — the file list, task order and smoke-test discipline
  all followed the plan exactly.
- Human review checklist (Phase 6):
  - Every parameter in `sim/config.yaml` is commented assumption or
    literature-informed — spot check a few against the report's own
    parameter table.
  - The report's first paragraph states results are model-dependent
    (`sim/results/report.md` line 3).
  - P = photo at discovery, M = photo at match, C = photo after
    conversation; the Gini of "interest received" is the inequality of
    how many real signals each agent received (ground truth only the
    simulation can see, since the real server never learns this).
- Next session starts with:
  - the human reviews the diff and commits;
  - then Phase 7: the Tier 1 documents (threat model, security argument,
    measured costs) — the Tier 1 gate. AC-T1-8's costs (signal/presence
    upload bytes, worst-case match latency) still need computing from the
    real server, not estimated by hand.


### 2026-10-06 — Phase 7 — done
- Done:
  - `docs/THREAT_MODEL.md` — assets ranked by harm, every adversary from
    SPEC §7.2 explained with its actual defence, trust assumptions stated
    *as* assumptions, and residual risks collected in one ranked list. The
    headline limitation is named plainly: an **active** server that
    substitutes a public key breaks everything, and key transparency is
    future work, not present.
  - `docs/SECURITY_ARGUMENT.md` — C1–C5 each mapped to named tests (file ::
    test function) and/or a labelled argument, with "test" and "argument"
    kept visibly distinct so a claim resting only on prose is obvious. Each
    claim also carries an "honest limits" subsection. Includes §7 measured
    costs and §8, the RQ4 section.
  - `server/tests/test_costs.py` (new; added to SPEC §20's file list) —
    measures AC-T1-8's costs from real uploads through the real app, and
    asserts the `measured-costs` block in `docs/SECURITY_ARGUMENT.md` still
    equals a fresh measurement, so the document cannot drift from the code.
- Tests: `pytest packages/protocol_py server sim -q` → **272 passed**
  (was 268; +4 from `test_costs.py`). `npm test -w packages/protocol-ts` →
  29 passed. `npm run typecheck -w packages/protocol-ts` → clean.
- Measured (AC-T1-8), all from real requests, none by hand:
  - signal upload **932 bytes**, identical for 0 or 20 real signals;
  - presence upload **11,792 bytes** (50 sightings) / **23,568 bytes**
    (500); 1 sighting costs exactly the same as 50 — padding verified by
    `test_padding_hides_how_many_sightings_a_small_night_had`;
  - worst-case match latency **38 h** (tap → both told), **24 h** (digest →
    told), **56 h** worst case (crossing → told).
- Tier 1 verification (Prompt 6) — every row from a command run this session:

  | AC | Command | Result |
  |---|---|---|
  | T1-1 | `pytest packages/protocol_py -q` | 130 passed |
  | T1-2 | `python -m mutual_protocol.vectors --out <tmp>` + byte compare | 135 cases, identical to committed |
  | T1-3 | `npm test -w packages/protocol-ts` | 29 passed (2 files) |
  | T1-4 | `pytest server -q` | 127 passed |
  | T1-5 | `pytest server/tests/test_leak_two_worlds.py -q` | 1 passed (world C non-vacuity included) |
  | T1-6 | `pytest server/tests/test_route_audit.py -q` | 6 passed |
  | T1-7 | `pytest server/tests/test_retention.py server/tests/test_digest.py -q` | 17 passed |
  | T1-8 | `pytest server/tests/test_costs.py -q` | 4 passed; numbers above |
  | T1-9 | `pytest sim -q`; `python -m mutual_sim.run --seeds 30` | 15 passed; run 8.4 s (< 15 min), `main_experiment.csv` byte-identical to the committed run — determinism confirmed a second time |
  | T1-10 | both documents exist, C1–C5 mapped, RQ4 present | pass |

  **Tier 1 is complete.** Every Tier 1 acceptance criterion passes.
- Deviations from this plan and why:
  - Prompt 9 (Phase 13 walkthrough + interview questions) is specified to
    run after Phase 7 *and* after Phase 11. Run **once at the end** instead,
    covering both tiers, because this session continues into Tier 2 and a
    mid-way walkthrough would be rewritten within hours.
  - The Tier 1 gate ("stop and show your professor") is **not** being used
    as a stop this session: the human asked for the whole project to be
    carried through in one run. The gate's artefacts all exist, so the
    review can still happen at any point.
- Human review checklist (Phase 7):
  - `docs/THREAT_MODEL.md` §5 lists the residual risks you are willing to
    stand behind in a viva. If any feels understated, say so.
  - `docs/SECURITY_ARGUMENT.md` §2 "honest limits of C1" — confirm you are
    comfortable stating the active-server limitation that prominently.
  - The RQ4 section (§8) is the written deliverable for research question 4;
    read it as your examiner would.
- Next session starts with: Phase 8 (app foundation).

### 2026-10-06 — Phase 8 — done (one item blocked: see below)
- Done:
  - Expo app created in `app/` and added to the npm workspaces; Metro
    configured for the monorepo (watch the repo root, resolve from both
    node_modules trees, `disableHierarchicalLookup`).
  - `index.ts` entry imports the CSPRNG polyfill **before**
    `expo-router/entry`, so no protocol code can run without it.
  - Design system from `docs/design/prototype.html`: `tokens.ts`,
    `typography.ts` (Fraunces + Inter via expo-font), `motion.ts` (durations
    collapse to 0 under OS reduce-motion), `theme.tsx`, plus `primitives.tsx`
    and `icons.tsx`.
  - Navigation skeleton per SPEC §13.2: onboarding group (9 screens), tabs
    group (4), `profile/[id]`, `match/[id]`, `reveal/[id]`, `privacy`, `dev`.
    The privacy screen and the dev panel are built in full; the other 17 are
    placeholders that already render in both themes.
  - `api/client.ts` as the single network boundary, `storage/secure.ts`,
    TanStack Query provider with focus/reconnect refetching off (a refetch
    caused by the user opening the app on a particular card would be
    attention-dependent traffic).
  - `presence/bleAdapter.ts` and `presence/fakeBle.ts` (deterministic,
    respects the midnight rule, produces sub-threshold brush-pasts).
  - `app/dev.tsx` runs 20 real vectors from `vectors.json` in-app and shows
    "Protocol OK" (PLAN Phase 8 task 3, risks R4/R5).
  - `scripts/check-privacy-invariants.ts` and `scripts/check-contrast.ts`.
  - Five app hooks added to `.pre-commit-config.yaml`.
- Version pins (⚠ verify, resolved): Expo SDK **57.0.26**, React Native
  **0.86.3**, React **19.2.3**, TypeScript 6.0.3 (app) / 7.0.2 (protocol-ts),
  Node 24.19.0. Audio = **`expo-audio`**; background tasks =
  **`expo-background-task`**.
- Tests: `npm test -w app` → **24 passed** (4 suites).
  `npm run typecheck -w app` → clean. `npm run lint -w app` → clean.
  `npm run check:privacy -w app` → OK. `npm run check:contrast -w app` → 20
  pairs x 2 themes, all at or above WCAG AA. Nothing else regressed:
  `pytest packages/protocol_py server sim -q` → 272 passed,
  `npm test -w packages/protocol-ts` → 29 passed.
- Security fix applied under the standing delegation:
  `BLUETOOTH_SCAN` was generated **without**
  `usesPermissionFlags="neverForLocation"` because Expo's `permissions` list
  cannot express the flag. Fixed with a local config plugin
  (`app/plugins/withBleNeverForLocation.js`), which also strips
  `SYSTEM_ALERT_WINDOW` from `expo-dev-client`. Verified in the prebuild
  manifest. Logged as DECISIONS_LOG entry 19.
- Deviations from this plan and why:
  - Three files added beyond SPEC §20 and recorded there in the same change:
    `src/design/primitives.tsx`, `src/design/icons.tsx`,
    `plugins/withBleNeverForLocation.js` (plus `src/dev/protocolSelfTest.ts`
    and `index.ts`).
  - TypeScript ~6.0.3 added as a root devDependency to stop eslint crashing on
    protocol-ts's TypeScript 7. No source change.
- **Blocked: AC-T2-1's `npx expo run:android` half.** This laptop has no JDK
  and no Android SDK, so no emulator build can be produced yet. Everything
  else in AC-T2-1 (lint, including the fetch restriction and the
  no-hex-literal rule) passes, and `expo prebuild` succeeds, which is what
  AC-T2-3 is verified against. The in-app protocol self-test is covered by a
  jest test; running it on a device still needs the toolchain.
- Human review checklist (Phase 8):
  - [ ] Install Android Studio (or the command-line tools + a JDK 17), then
        run `npx expo run:android` from `app/` and confirm the dev build
        starts and the dev panel shows "Protocol OK".
  - [ ] Open `docs/design/prototype.html` beside the emulator and compare the
        tab bar, gutters and type in both themes.
  - [ ] Confirm you are comfortable with `in.mutual.app` as the Android
        package name (it is baked into a build's identity).
- Next session starts with: Phase 9b (the native BLE module, written against
  the spike's open questions), then Phase 10.

### 2026-10-06 — Phase 9a — blocked / Phase 9b — code complete, not verified on hardware
- Phase 9a (BLE spike): **blocked.** It needs two physical Android 12+ phones
  (Q3) and an Android toolchain. Instead of guessing, `docs/BLE_SPIKE.md` is
  written as a complete measurement protocol — the gating `neverForLocation`
  question, both layouts, detection rates at 1/3/10 m on desks and in pockets,
  screen-off, the 20-pass walk-past test, device-address rotation, and the
  8-hour battery comparison — with **every results table deliberately blank**
  and a note at the top saying why a blank row is a true statement and a
  guessed one is not. AC-T2-6 is therefore **not** satisfied, and says so.
- Phase 9b (native module): done as code, unverified on hardware.
  - `app/modules/mutual-ble/`: `expo-module.config.json`, `index.ts` (typed
    native surface), `android/build.gradle`,
    `android/src/main/AndroidManifest.xml` (foreground service and boot
    receiver), and Kotlin — `Schedule.kt` (schedule, sighting and payload
    types, both layouts' byte formats as pure functions), `SightingStore.kt`
    (per-interval window counts, destructive drain, midnight rule),
    `BleRadio.kt` (extended advertising with a legacy-split fallback, filtered
    duty-cycled scanning, own-EID filtering, one count per peer per window),
    `MutualBleService.kt` (foreground service, 15-minute rotation with an
    advertising restart, fail-safe when the schedule runs out, pause from the
    notification), `BootReceiver.kt` (restart only if discovery was on),
    `MutualBleModule.kt` (the Expo surface: schedule in, counts out, nothing
    else).
  - `app/src/presence/nativeBle.ts` implements the same `BleAdapter` interface
    as `fakeBle.ts`, plus `pickAdapter()`.
- Tests: `npm test -w app` → **34 passed** (5 suites; +10 for the wrapper).
  `npm run typecheck -w app`, `npm run lint -w app`,
  `npm run check:privacy -w app` all clean.
- Verify item resolved: Android 14+ needs a declared `foregroundServiceType`;
  `connectedDevice` with `FOREGROUND_SERVICE_CONNECTED_DEVICE` is the correct
  pair for Bluetooth work. `POST_NOTIFICATIONS` is requested with the
  Bluetooth permissions (Android 13+).
- Deviations from this plan and why: 9b is specified to follow an approved 9a.
  It was written first because 9a cannot run on this hardware, and because
  implementing both layouts means the spike's answer needs no new code — only
  a decision about which fallback stays.
- **Not verified:** the Kotlin has never been compiled (no Android SDK, no
  JDK). Treat it as reviewed code, not working code, until Phase 9a runs.
- Human review checklist (Phase 9b):
  - [ ] Answer Q3: do you have two Android 12+ phones?
  - [ ] Install the Android toolchain, build, then run `docs/BLE_SPIKE.md`
        section 3 top to bottom and fill in section 4 as you go.
  - [ ] If 4.6 shows the device address does **not** rotate with the EID,
        stop: `docs/THREAT_MODEL.md` 3.3 needs weakening in writing before
        anyone relies on the rotation.
- Next session starts with: Phase 10 (onboarding and profile).

### 2026-10-06 — Phase 10 — done (emulator checks pending a toolchain)
- Done:
  - Components: `GenerativeAvatar.tsx` (BLAKE2b of `identity_pk`, the
    prototype's palette and blob construction), `VoicePlayer.tsx` (48 bars
    from the stored waveform, plays from the local cache only, structurally
    unable to reach the network), `VoiceRecorder.tsx` (<= 30 s, stops itself
    at the limit, 48 waveform values averaged from metering).
  - API layer: `src/api/types.ts` written field by field against
    `server/mutual_server/schemas.py`, and `src/api/endpoints.ts` with one
    typed function per route, collected in one readable file so the
    invariant-1 check ("nothing here can be called because a user looked at
    something") can actually be made.
  - Onboarding: `src/onboarding/store.ts` (in-memory only, plus every
    validation rule as a pure function) and `src/onboarding/identity.ts`
    (idempotent X25519 key generation into secure storage).
  - Screens built in full: welcome, how-it-works (3 panels), email, code, age,
    basics (where the account is created), prompts, photos, permissions,
    consent (study mode only), and the You tab with the profile preview,
    discovery switch, photos row, privacy row, notifications row and inline
    delete-account confirmation.
  - Primitives extended with `TextField`, `Pill`, `TimeChip`, `LockNote`,
    `BarButton`; the avatar palette moved into `tokens.ts`.
- Tests: `npm test -w app` -> **67 passed** (7 suites; +33 this phase: 26
  onboarding/identity, 7 avatar). `npm run typecheck -w app`,
  `npm run lint -w app`, `npm run check:privacy -w app`,
  `npm run check:contrast -w app` all clean.
- Verify item resolved: the current Expo audio package is **`expo-audio`**, and
  its recording metering is read through `recorder.getStatus().metering` in
  dBFS after `prepareToRecordAsync({ isMeteringEnabled: true })`. Mapped to the
  0-100 scale the server stores, averaged into 48 buckets.
- Raised, not resolved: on a study campus the server will not create an account
  without consent, so declining means not being able to use Mutual. That is an
  ethics question for the human, recorded as **Q9** on the decisions-log Board
  and stated plainly on the consent screen.
- Deviations from this plan and why:
  - The consent screen sits between the code step and the age step rather than
    at the end of onboarding, because `consent_version` is carried by
    `POST /account`, which happens on the basics screen.
  - Four files added beyond SPEC §20 and recorded there in the same change.
- **Not verified:** "a new synthetic user can onboard on an emulator in under
  3 minutes" and the both-themes screenshots. Both need an emulator, which
  needs the Android SDK and a JDK.
- Human review checklist (Phase 10):
  - [ ] Once the toolchain is installed, onboard a synthetic user end to end
        and time it.
  - [ ] Open `docs/design/prototype.html` beside the emulator for Welcome,
        How it works, You and Privacy, in both themes.
  - [ ] Answer Q9 (the study-campus consent question above) before any pilot.
  - [ ] Confirm the consent text in `app/app/(onboarding)/consent.tsx` matches
        whatever the approving body ends up requiring; it is version "1".
- Next session starts with: Phase 11 (the core loop and end to end).

### 2026-10-06 — Phase 11 — done (device verification still pending)
- Done, in the plan's order (logic and tests before UI):
  - `src/storage/localDb.ts` — the device's own database, with a table-by-table
    note of what each table holds and why the server does not have it.
  - `src/signals/{db,ttl,setBuilder,scheduler,upload}.ts` — the local signal
    store (now carrying the peer's name and key so the Signals tab needs no
    network), the TTL counted from the last crossing, the padded set built
    through protocol-ts, the random-minute once-per-epoch scheduler as pure
    functions, and the upload that claims the epoch before it sends.
  - `src/presence/{dailyKeys,encounters,drain,upload,schedule}.ts` — keys two
    days ahead and deleted after upload, the dwell rule and midnight rule, the
    destructive drain, the nightly upload that deletes raw sightings only after
    the request succeeds, and the coordinator plus the background task.
  - `src/digest/{cache,prefetch,useDigest}.ts` — the eager prefetch of every
    listed media item in the digest's own order, the hash-checked cache, and
    the hook that assembles the morning letter from the digest plus everything
    device-local.
  - `src/matches/{resolve,photo}.ts` — token to (peer, intent) locally, with
    unexplained tokens reported rather than guessed.
  - Components: `CrossingCard`, `SignalSheet`, `SignalDots`, `IntentChip`,
    `EmptyState`, `ChatBubble`, `RevealMoment` (FLAG_SECURE, instant under
    reduce-motion), `SafetySheet`.
  - Screens: Today (three states, "Earlier this week"), Signals, Mutuals,
    `profile/[id]`, `match/[id]`, `reveal/[id]`, and the dev panel with clock
    travel, a simulated crossing, fake sightings, "run the nightly work now"
    and the server-state readout.
  - `docs/E2E_CHECKLIST.md` — 60 steps across 10 sections, every date column
    blank.
- Tests: `npm test -w app` → **167 passed** (12 suites; +100 this phase).
  `npm run typecheck -w app`, `npm run lint -w app`,
  `npm run check:privacy -w app`, `npm run check:contrast -w app` all clean.
  `pytest packages/protocol_py server sim -q` → 272 passed.
  `npm test -w packages/protocol-ts` → 29 passed.
- Verify item resolved: the current Expo background-task package is
  **`expo-background-task`**, registered through `expo-task-manager` with
  `minimumInterval` in minutes (15 is the floor Android will honour).
- Security fix applied under the standing delegation: the Signals tab's first
  version would have required a per-peer profile fetch, breaching invariant 1.
  The peer's name and key are now copied from the digest into the local signal
  row. Logged as DECISIONS_LOG entry 22.
- Deviations from this plan and why:
  - Task 8 (`reciprocal_content` ranking) not done. It is marked optional in
    this plan and parked on the decisions Board; Tier 1's `random` ranking runs.
  - Three files added beyond SPEC §20 and recorded there in the same change.
  - **Prompt 7 (independent security review) did not complete**: the subagent
    hit the account's session rate limit and was terminated partway through. An
    inline review was done instead. That is weaker evidence, and re-running it
    as a fresh subagent is on the human review checklist below.
- **Not verified:** everything in `docs/E2E_CHECKLIST.md`, which needs two
  emulators. A JDK 17 and the Android command-line tools were installed during
  this session; the remaining SDK packages and a build are the next step.
- Human review checklist (Phase 11):
  - [ ] Re-run Prompt 7 as a fresh subagent on `app/src` and
        `app/modules`, and read the findings.
  - [ ] Work through `docs/E2E_CHECKLIST.md` on two emulators, filling in the
        date columns. §2.7 and §3.2 are the two rows that matter most: they are
        claim C1 observed from the client side.
  - [ ] Open `docs/design/prototype.html` beside the emulator for Today,
        Profile, SignalSheet, Signals, Mutuals, RevealMoment and Chat, in both
        themes.
  - [ ] Decide whether `reciprocal_content` ranking is wanted at all (Board).
- Next session starts with: Phase 12's preparable half (study materials and the
  synthetic analysis pipeline), then Phase 13.

### 2026-10-06 — Phase 12 — the preparable half done; the gated half not written
- Done (everything invariant 9 permits before approval):
  - `study/PREREGISTRATION.md` — the ABAB block order fixed, six outcomes with
    their definitions pinned, the analysis and the stopping rules, and a §2
    that states what a pilot of this size cannot show before any data exists.
  - `study/PARTICIPANT_INFO.md` — plain-language information sheet, including
    the three limitations most projects leave out: chat is not end-to-end
    encrypted, the design assumes an honest server, and ending a match leaves
    it visible as ended to the other person.
  - `study/CONSENT.md` — consent form, version 1, matching the in-app screen.
  - `study/ETHICS_APPLICATION_DRAFT.md` — draft application that volunteers its
    own weakest point (§4.2, the voluntariness problem) and proposes a remedy.
  - `study/analysis/make_synthetic_export.py` — the synthetic generator and the
    schema `export.py` will have to produce.
  - `study/analysis/analyze.py` — the whole pre-registered analysis: eight
    tables plus the clustered logistic model.
  - `study/analysis/synthetic_export.csv` — 525 generated rows (40
    participants, 320 user-weeks, 101 matches, 104 survey responses).
  - `study/analysis/requirements.txt` — statsmodels 0.15.0.
- **Deliberately not written:** `study/analysis/export.py`, which reads the
  real database, and `study/APPROVAL.md`. Invariant 9 forbids the first until
  approval exists; creating the second would make the server's study gate start
  passing its file-exists check, which is the mechanism that stops a study
  running unapproved. Recorded in `study/PREREGISTRATION.md` §10.
- Tests: `python study/analysis/analyze.py --input
  study/analysis/synthetic_export.csv` → **all eight pre-registered tables**,
  so **AC-T3-3 passes**. `ruff check study/` and `ruff format --check study/`
  clean. Nothing else regressed.
- Measured limitation of this laptop, recorded rather than worked around: the
  mixed-effects model cannot run here. `scipy`'s compiled `_alternative` module
  is blocked by the machine's Windows Application Control policy. `analyze.py`
  distinguishes that from a convergence failure and reports it as an
  environment problem. The eight tables are unaffected.
- Deviations from this plan and why: the plan lists `export.py` as a Phase 12
  task. Every task in that phase is gated by the phase's own precondition
  (written approval), so not writing it follows the plan rather than deviating
  from it.
- **AC-T3-1 and AC-T3-2 are not met, and cannot be yet.** T3-1's study gate
  test passes (`pytest server/tests/test_study_gate.py`), but T3-2 requires the
  pre-registration commit to predate the first study day, and there is no study.
- Human review checklist (Phase 12):
  - [ ] Answer Q4 (will the pilot run, and which body approves it?) and Q9 (the
        voluntariness question in `ETHICS_APPLICATION_DRAFT.md` §4.2).
  - [ ] Fill in every *(to be completed)* field in the information sheet and
        the ethics draft — there are 11, all names, contacts and references.
  - [ ] Read `PARTICIPANT_INFO.md` as a student would, not as its author.
  - [ ] Nothing in `study/` may be used with a real person until
        `study/APPROVAL.md` exists.

### 2026-10-06 — Phase 13 — done
- Done:
  - `docs/design-decisions/` — nine linked pages: the architecture with a
    diagram of how the four components connect, the threat model in one page,
    why twenty signals once a night at a random time, why the server resolves
    crossings and what it learns, why the digest arrives tomorrow, how the leak
    test is built and why world C is what makes it worth anything, why policy P
    exists only in the simulation, what the simulation can and cannot tell us,
    and where the code and the spec disagree.
  - `docs/INTERVIEW_QUESTIONS.md` — fifteen questions, no answers, each with a
    pointer to the section to re-read.
- Writing the walkthrough found two real spec/code divergences, both now fixed
  or named in `SPEC.md`:
  1. `GET /config` returns `match_batch_time`, which §11's prose did not list.
     The app needs it; the prose was incomplete. **Fixed.**
  2. §13.4's type scale is not the scale the app uses, because §13.9 makes the
     approved prototype authoritative on look and feel. Named in page 9 rather
     than silently accepted, since "no magic numbers in components" would
     otherwise be a fiction.
- Deviations from this plan and why: run **once at the end** covering both
  tiers, rather than after Phase 7 and again after Phase 11. Recorded in the
  Phase 7 entry when the decision was made.
- Human review checklist (Phase 13):
  - [ ] Check `docs/design-decisions/09-spec-drift.md` against the code
        yourself. The plan's own warning for this prompt is that an agent's
        explanation of its own choices can be fluent and wrong, and that page
        is the one most worth distrusting.
  - [ ] Try answering the fifteen questions out loud without the repository
        open. The ones you cannot answer are the sections to re-read.

### 2026-10-06 — Tier 2 verification (Prompt 6) and the Android toolchain
- Toolchain installed this session, so that AC-T2-1 could be attempted at all:
  **JDK 17** (`%LOCALAPPDATA%\Programs\Microsoft\jdk-17.0.10.7-hotspot` —
  winget installs to the *user* scope, not `C:\Program Files\Microsoft`), and
  the **Android SDK** at `%LOCALAPPDATA%\Android\Sdk` with cmdline-tools,
  platform-tools, platforms/android-36, build-tools/36.0.0 and the NDK.
  Licences need stdin piped through
  `cmd /c "type yes.txt | sdkmanager.bat --licenses"`; PowerShell's pipe into
  the .bat does not feed it.
- **The first real build found a blocking bug no test could have found.**
  `in` is a reserved keyword in Kotlin, and Expo's autolinking *generates* a
  Kotlin file that writes the module's package name unquoted, so
  `in.mutual.ble.MutualBleModule::class.java` is a syntax error and no build
  with an `in.mutual.*` package could ever succeed. Renamed to `app.mutual`
  and `app.mutual.ble`, with the reason recorded in `app.config.ts` and the
  module's `build.gradle`. DECISIONS_LOG entry 25.
- **The Kotlin BLE module now compiles.** All six source files
  (`BleRadio`, `BootReceiver`, `MutualBleModule`, `MutualBleService`,
  `Schedule`, `SightingStore`) produce classes under
  `app/mutual/ble/`. Up to this session the Kotlin had never been compiled at
  all; it was reviewed code, and now it is at least code that builds.
- **A second obstacle, which is the laptop and not the project:** the C++
  native build fails with
  `Filename longer than 260 characters` in `react-native-gesture-handler`'s
  codegen output. Windows `LongPathsEnabled` is already 1, but ninja/CMake do
  not honour it. The project path
  (`C:\Users\sanka\Desktop\STUDIES\AIDS\Project 2\`) is long and contains a
  space. Worked around with a directory junction: `mklink /J C:\mtl "<project>"`
  and build from `C:\mtl\app\android`. Recorded here because anyone who
  re-clones into a deep path will hit it again.

#### Tier 2 acceptance criteria, as they actually stand

| AC | What it needs | Status |
|---|---|---|
| T2-1 build | `npx expo run:android` produces a working dev build | **Partly.** `expo prebuild` succeeds, the Kotlin module compiles, and the APK builds from the short path. Installing and running it on an emulator still needs an emulator image and an AVD |
| T2-1 lint | `npm run lint -w app`, incl. the fetch restriction and the no-hex rule | **Passes** |
| T2-2 | `npm test -w app` | **Passes — 174 tests**, including the padded set through protocol-ts, the scheduler's four rules, withdrawal sending no request, match verification, encounter tokens, and "rendering a CrossingCard and a VoicePlayer performs no network call" |
| T2-3 | `npm run check:privacy -w app` | **Passes**, against the prebuild manifest: no location permission, `BLUETOOTH_SCAN` carries `neverForLocation`, no denylisted SDK anywhere in the repo, no `fetch` outside `src/api/client.ts` |
| T2-4 | `npm run check:contrast -w app` | **Passes** — 20 pairs x 2 themes at or above WCAG AA |
| T2-5 | Every item in `docs/E2E_CHECKLIST.md` ticked with a date | **Not met.** 60 steps written, every date column blank. Needs two emulators |
| T2-6 | `docs/BLE_SPIKE.md` recorded on two physical phones | **Not met.** The protocol is written, every results table blank. Needs two Android 12+ phones (Q3) |

So Tier 2 is **four of seven criteria met**, with the three gaps each blocked
on something specific and named rather than on more code.

### 2026-10-06 — end of the autonomous session — where the project stands

The human asked for the whole project to be carried through in one run, and
explicitly waived the usual stop-for-review at each phase. **Every phase of
this plan (0–13) is now implemented and on `main`.** The one-phase-per-session
rule in `CLAUDE.md` §8 is still the default; it was overridden for this session
only, by name.

#### Totals

| | |
|---|---|
| Commits on `main` | 13, one per phase plus the security-review fixes |
| Tracked files | 265 |
| Python tests (protocol_py + server + sim) | **272 passing** |
| protocol-ts tests | **29 passing** |
| App jest tests | **174 passing** |
| ruff (repo-wide), eslint, typecheck, check:privacy, check:contrast | all clean |
| `pre-commit run --all-files` | all 11 hooks pass (from an activated venv) |

#### Tier 1 — complete

Every Tier 1 acceptance criterion passes; the verification table is in the
Phase 7 entry above. Measured, not estimated: a signal upload is 932 bytes a
day whatever the real signal count, a presence upload is 11,792 / 23,568 bytes,
and the worst-case match latency is 38 hours. `server/tests/test_costs.py`
asserts that `docs/SECURITY_ARGUMENT.md` still matches the code, so the
document cannot drift.

#### Tier 2 — four of seven criteria

Code complete. The gaps are the Tier 2 verification entry above: an emulator
run-through of `docs/E2E_CHECKLIST.md` (AC-T2-5) and the two-phone BLE spike
(AC-T2-6).

#### Tier 3 — prepared as far as the gate allows

Pre-registration, information sheet, consent form, ethics draft, and the whole
analysis pipeline running on synthetic data (AC-T3-3 passes).
`study/analysis/export.py` and `study/APPROVAL.md` are **deliberately absent**
under invariant 9.

#### What a human has to do next, in order

1. **Review the diff.** Thirteen commits; `docs/DECISIONS_LOG.md` entries
   17–25 explain every judgement call made along the way, and
   `docs/design-decisions/09-spec-drift.md` lists every place the code and the
   spec disagree.
2. **Answer the Board questions**, especially the new **Q9**: on a study campus
   the server refuses an account without consent, so declining means not using
   Mutual at all. That is an ethics question and it blocks any pilot.
3. **Re-run Prompt 7** as a fresh subagent. The one launched this session was
   killed by the account's session rate limit partway through; an inline audit
   replaced it and found two real issues, but inline is weaker evidence.
4. **Create an emulator and work through `docs/E2E_CHECKLIST.md`**, filling in
   the date columns. §2.7 and §3.2 are the rows that matter most — they are
   claim C1 observed from the client side.
5. **Open `docs/design/prototype.html` beside the emulator** for every screen,
   in both themes. The interface is the human's stated first priority, and no
   screen has yet been seen rendered.
6. **Show the professor.** Tier 1 is the complete research result; the Tier 1
   gate has not been used as a stop in this session, but all of its artefacts
   exist.

#### What is NOT done, stated plainly

- Nothing in `app/` has ever been seen running. It compiles, it is tested, and
  it has never been looked at.
- `docs/BLE_SPIKE.md` and `docs/E2E_CHECKLIST.md` are empty of results, on
  purpose.
- `reciprocal_content` ranking (Phase 11 task 8, marked optional) is not built;
  Tier 1's `random` ranking runs.
- No real-user data exists, and none may be collected until the four conditions
  in invariant 9 all hold.

### 2026-10-06 — the build finished: AC-T2-1 and AC-T2-3 upgraded
Correcting and completing the Tier 2 entry above, which was written while the
build was still running.

- **`BUILD SUCCESSFUL in 12m 30s`**, 754 tasks. A 321 MB debug APK at
  `app/android/app/build/outputs/apk/debug/app-debug.apk`, package
  `app.mutual`. The Kotlin BLE module compiles — all six files.
- **AC-T2-3 is now verified against the *merged* manifest, not the prebuild
  one.** `aapt2 dump permissions` on the APK itself confirms the two things
  that matter: `BLUETOOTH_SCAN` carries
  `usesPermissionFlags='neverForLocation'`, and there is **no location
  permission of any kind**. Invariant 3 and claim C4 hold in an artefact that
  could actually be installed.
- **Two defects the build exposed, both in the checking rather than the app**
  (DECISIONS_LOG 26):
  1. `check-privacy-invariants.ts` guessed hard-coded paths under
     `merged_manifests/` and none matched this AGP version's task directory, so
     it silently fell back to the weaker prebuild manifest while printing a
     note. **A check that verifies something weaker than it claims is worse
     than one that fails.** It now searches for the merged manifest and prefers
     a debug variant.
  2. The config plugin's deletion of `SYSTEM_ALERT_WINDOW` was invisible in the
     built APK, because Gradle merges library manifests after Expo's plugins
     run. Moving it to `blockedPermissions` fixed `CAMERA` but not
     `SYSTEM_ALERT_WINDOW`: `react-android`'s **debug** AAR declares it for
     LogBox, and a library's own declaration beats an application-level
     `tools:node="remove"`. It is now reported as expected in debug and
     **asserted absent in release**, which is the build anyone would install.
- **A workaround the next person will need:** the C++ build fails with
  `Filename longer than 260 characters` from this project path. Windows
  `LongPathsEnabled` is 1 but ninja and CMake ignore it. Build via a junction:
  `mklink /J C:\mtl "<project>"`, then `C:\mtl\app\android\gradlew.bat`.
- Also smoke-tested the server live this session: `alembic upgrade head`, then
  uvicorn in dev mode. `GET /v1/config` returns exactly the shape the app's
  `ServerConfig` type expects, including the `match_batch_time` field that
  SPEC §11's prose had been missing, and `POST /v1/dev/clock` answers 204 in
  dev mode.
- Still not done, unchanged: nothing has been **run** on a device or emulator.
  AC-T2-1's "produces a working dev build" is satisfied as far as producing the
  build goes; installing and launching it needs an emulator image and an AVD.
- Revised Tier 2 tally: **five of seven** criteria met (T2-1 lint, T2-2, T2-3,
  T2-4, and T2-1's build half). T2-5 needs emulators; T2-6 needs two phones.
