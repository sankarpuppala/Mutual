# SPEC.md — Mutual

Status: **v1.1 — the contract.** (v1.1, 2026-10-05: adds the approved visual
reference, §13.9 and D19.) Every implementation decision is checked
against this file. When the code and this file disagree, this file wins until
the human approves a change to it. Section numbers are referenced from
`CLAUDE.md` and `PLAN.md`; do not renumber without updating both.

---

## 1. Goal

Build and evaluate a campus connection system in which **an honest-but-curious
server operator learns nothing about one-sided interest**, discovery is based
on real co-presence rather than an open directory, and photos are never the
basis of first selection — and measure, by simulation and (if approved) by a
small field pilot, how photo-reveal timing affects how unequally attention and
matches are distributed.

---

## 2. Premise and product promise

On a campus the problem is rarely a shortage of people; it is that you see
someone you would like to talk to and never do. Dating apps make this worse for
shy students in two ways: installing one is a public statement, and being
ranked on photographs is exactly the fear that keeps people away.

Mutual's promise to a user, which every section below exists to keep:

1. **Having Mutual says nothing about you.** Dating is one of five intents
   (study, project, fitness, friend, date). Intents are private and per-signal.
2. **You only see people you were actually near** — the next morning, never
   live, never where.
3. **A signal is costless to send.** If it is not returned for the same
   intent, nobody ever learns it existed — not the other person, not the
   server.
4. **Faces come after mutual interest.** Photos are never shown while
   browsing.
5. **It is calm.** One morning letter a day. No swiping, no streaks, no
   counts, no urgency.

---

## 3. Research questions

- **RQ1 — Protocol.** Can co-presence discovery and mutual matching be built
  so that the server's stored data and observed traffic are independent of
  one-sided interest, and at what cost in bandwidth, latency and battery?
  *Evidence:* security claims C1–C5 (§7) each backed by a passing test or a
  written argument; measured costs (§19 AC-T1-8, AC-T2-6).
- **RQ2 — Simulation.** Under an explicit model of visual attraction and
  personality compatibility, how do three reveal policies — photo at discovery
  (P), photo at match (M), photo after conversation (C) — affect the
  concentration of interest received (Gini), concentration of matches,
  compatibility of matched pairs, conversation survival at reveal, and churn?
  How sensitive are the conclusions to the assumed weight of appearance?
  *Evidence:* `sim/results/report.md` with bootstrap CIs and a sensitivity
  sweep. Results are explicitly model-dependent and stated as such.
- **RQ3 — Field pilot (gated, Tier 3).** Between policies M and C only, do
  observable outcomes differ: match concentration, conversation depth,
  unmatch within 24 h of reveal, weekly retention, and self-reported
  frustration? *Evidence:* pre-registered switchback pilot (§16).
- **RQ4 — The price of privacy (qualitative).** Which standard features become
  impossible by design — interest-trained recommendation, direct measurement
  of one-sided attention, real-time discovery — and what replaces them?
  *Evidence:* a written section in `docs/SECURITY_ARGUMENT.md`.

Note on RQ2 vs RQ3: one-sided attention is **deliberately unobservable** in the
real system. Its Gini is therefore measured only in simulation (where ground
truth exists). The field pilot uses observable proxies (match Gini etc.). This
gap is a finding (RQ4), not a defect.

---

## 4. Scope and tiers

| Tier | Contents | Needs phones? | Needs users? | Status |
|------|----------|---------------|--------------|--------|
| **1 — Must** | Protocol in Python + TypeScript with cross-language vectors; server (auth, profiles, presence resolution, digest, signals, matching, reveal gating, chat, safety); privacy leak tests; simulation + report; threat model and security argument | No | No | A complete research result on its own |
| **2 — Should** | Android app with full design system; native BLE module; fake BLE adapter; end-to-end flow on emulators; real two-phone BLE spike with measurements | Two Android 12+ phones for Phase 9 only | Synthetic only | Demonstrable product |
| **3 — Gated** | Field pilot: pre-registration, consent materials, study mode, analysis scripts | Yes | Yes, consenting adults | Only after written ethics approval |

**Out of scope:** iOS; group or event matching; payments; end-to-end
encrypted chat (decision D10); images, links or voice in chat; web client;
real-time location of any kind; recommendation trained on interest data
(impossible by design); multi-campus federation; key backup/recovery;
malicious-server security (§7.2); production hosting and app-store release.

Mutual is **standalone**. It does not depend on any other project (including
Bazaar). Identity is verified by college email OTP.

---

## 5. User journeys

**J1 — Onboarding (≈3 minutes).** Welcome → "How it works" (3 panels) → enter
college email → 6-digit code → date of birth (must be 18+; not stored, only
`age_verified_at`) → first name and year → choose and answer 3 prompts
(text required, voice optional, one must be the `looking_for` prompt) →
photos (optional, up to 4, with a plain explanation of exactly when they are
shown) → permissions (Bluetooth, notifications, the foreground-service
notification explained) → research consent screen **only if study mode is on**
→ done.

**J2 — A normal day.** The phone runs quietly with a small persistent
notification ("Mutual is on · tap to pause"). The user does nothing.

**J3 — The morning letter.** After `digest.release_time` (08:00) the Today
tab shows yesterday's crossings: a short greeting, then cards. Each card shows
the person's strongest prompt answer large, their first name and year small,
an optional voice-note player, and a coarse time chip ("Yesterday ·
evening"). An "Earlier this week" section, collapsed, holds crossings from the
previous 6 days. No photos. No counts of how often you crossed.

**J4 — Sending a signal.** Tap "Send a signal" → bottom sheet with the five
intents (multi-select) and one line: "They'll only know if they signal you
back — for the same thing." Confirm → gentle haptic → the card shows "Signal
sent". The Signals tab shows "14 of 20 signals free" as a row of 20 dots, and
each active signal with an expiry ("until Sunday"). A signal can be withdrawn
any time.

**J5 — A mutual.** The next morning, the Mutuals tab shows the new match with
the shared intent(s). Depending on the active reveal policy, photos reveal
immediately (M) or after a conversation (C), through the Reveal moment. Chat
is text-only.

**J6 — Safety.** From any card or chat: block (immediate, both directions,
silent to the other person) and report (reason + optional selected messages).
Settings: pause discovery, the "What Mutual can and can never see" explainer,
delete account.

---

## 6. Protocol (normative)

The protocol is the core contribution. Both implementations
(`packages/protocol_py`, `packages/protocol-ts`) must produce byte-identical
outputs for every vector in `packages/protocol-spec/vectors.json`.

### 6.1 Primitives
- X25519 Diffie–Hellman (RFC 7748). Python: `cryptography`
  `X25519PrivateKey`. TypeScript: `@noble/curves` `x25519`.
- BLAKE2b (RFC 7693) with `digest_size=32`, optional `key`, and a
  **personalization of exactly 16 ASCII bytes**. Python: `hashlib.blake2b(...,
  person=...)`. TypeScript: `@noble/hashes` `blake2b(..., {dkLen: 32, key,
  personalization})`. Check the installed `@noble/*` README for the current
  import paths; pin exact versions.
- CSPRNG only. Python `secrets.token_bytes`; TypeScript the CSPRNG used by
  `@noble/hashes` `randomBytes`, which requires `crypto.getRandomValues` —
  in React Native provide it via `expo-crypto` or
  `react-native-get-random-values`, imported before any protocol code.

### 6.2 Constants (`packages/protocol-spec/constants.json`)
```json
{
  "protocol_version": 1,
  "signal_set_size": 20,
  "token_bytes": 32,
  "pair_key_bytes": 32,
  "daily_key_bytes": 32,
  "eid_bytes": 16,
  "eid_interval_minutes": 15,
  "eid_intervals_per_day": 96,
  "personalization": {
    "pair_key": "mutual-pairkey01",
    "interest": "mutual-interest1",
    "eid": "mutual-eid-v0001"
  },
  "intents": { "study": 1, "project": 2, "fitness": 3, "friend": 4, "date": 5 },
  "ble": { "company_id": 65535, "magic_hex": "4d55", "payload_version": 1 }
}
```
Both implementations load this file (Python via the package's data path;
TypeScript via JSON import). No constant is duplicated in code.

### 6.3 Encodings
- Wire encoding of all bytes: base64url, no padding.
- `epoch` and `day`: the calendar date in the deployment timezone
  (`server/config.yaml` `timezone`, default `Asia/Kolkata`) as ASCII
  `YYYY-MM-DD` — exactly 10 bytes.
- Intent: one byte, value from `constants.intents`.
- EID interval index `i`: unsigned 16-bit big-endian, `0 ≤ i < 96`,
  `i = floor(minutes_since_local_midnight / 15)`.

### 6.4 Identity keys
At account creation the device generates an X25519 key pair. The private key
never leaves the device (stored with `expo-secure-store`). The public key
`pk` (32 bytes) is registered with the server and served to peers inside the
digest.

### 6.5 Pair key
For users A and B:
```
ss = X25519(sk_A, pk_B)                     # 32 bytes; MUST reject all-zero
(lo, hi) = sort_bytes_lexicographic(pk_A, pk_B)
K_AB = BLAKE2b(data = ss || lo || hi, digest_size = 32,
               person = "mutual-pairkey01")
```
`K_AB == K_BA`. Computing a pair key where `pk_A == pk_B` is an error.

### 6.6 Interest token
```
T(A, B, epoch, intent) = BLAKE2b(data = epoch_ascii(10) || intent(1),
                                 key = K_AB, digest_size = 32,
                                 person = "mutual-interest1")
```

### 6.7 Padded signal set
For epoch `e`, a client builds `S_e`:
1. For every active signal `(peer, intent)` (§6.10), compute `T(self, peer,
   e, intent)`. Duplicate `(peer, intent)` pairs are impossible by
   construction (the UI and local DB enforce uniqueness).
2. If there are more than `signal_set_size` real tokens, that is an error
   (the UI caps active signals at `signal_set_size`).
3. Add `signal_set_size − |real|` dummy tokens, each 32 bytes from the CSPRNG.
4. Shuffle all `signal_set_size` tokens with a CSPRNG-driven Fisher–Yates.

The server stores the tokens sorted, so order carries no information either
way.

### 6.8 Daily key and ephemeral IDs (EIDs)
Each device generates a fresh random 32-byte daily key `DK_d` for each local
day `d`, at least 2 days in advance.
```
EID(d, i) = first 16 bytes of BLAKE2b(data = uint16_be(i), key = DK_d,
                                     digest_size = 32,
                                     person = "mutual-eid-v0001")
```
EIDs are computed in TypeScript and handed to the native module as a
schedule (§14). `DK_d` is uploaded only **after** day `d` has ended (§6.11).

### 6.9 Server matching rule
For epoch `e`, users U ≠ V match iff some token `t ∈ S_U(e) ∩ S_V(e)`. The
server records the unordered pair, the matching token(s) and the epoch. It
does **not** know the intent. If a block exists in either direction, the match
is suppressed (deleted, never notified). If U and V already have an active
match, additional matching tokens are appended to it (a new shared intent).

### 6.10 Client-side rules
- A signal is active from creation until `interest_ttl_days` (7) after the
  most recent crossing with that peer, or until withdrawn, or until matched.
- A user can only signal peers present in their digest window (the client has
  their `pk` only then). Signalling oneself is rejected.
- On receiving a match, the client recomputes `T` for each of its active
  signals for that epoch and maps each matching token to `(peer, intent)`
  locally. The server never sends intents.
- The client stores each peer's `pk` for the digest window. If a peer
  re-registers a new key, pending signals for them silently stop matching
  until the next crossing delivers the new key (documented limitation).

### 6.11 Upload discipline (this is a privacy property, not a convenience)
- **Signals:** exactly one `S_e` per user per epoch. The client picks a
  uniformly random time inside `[signal_upload_window_start,
  signal_upload_window_end]` (18:00–23:30 local) and uploads then, containing
  all signals active at that moment. If the device was off or offline, it
  uploads at the next opportunity **before the epoch ends**; otherwise that
  epoch is skipped. Never upload a set for a past epoch. The server rejects
  uploads before the window start (HTTP 425) and duplicates (HTTP 409). The
  client uses the server's current epoch from `GET /v1/config`, never its own
  clock.
- **Presence:** for each past day `d`, the client uploads `DK_d` and its
  aggregated sightings once, at a random time between 00:05 and 06:00 local
  on day `d+1`, or at next app open before the cutoff (start of day `d+2`).
- **Digest media:** after fetching a digest, the client downloads **every**
  media item it lists that is not already cached, in a fixed order (sorted by
  media id), whether or not the user ever opens the card.

### 6.12 Versioning
Any change to §6 bumps `protocol_version`, changes the personalization
strings' trailing digits, regenerates vectors, and requires approval.

---

## 7. Threat model and security claims

### 7.1 Assets (most sensitive first)
1. One-sided interest (who signalled whom, for what).
2. The intent of any signal or match.
3. Location and routine (where someone is, when, how often).
4. Pre-reveal photos.
5. Messages.
6. The fact that a person uses Mutual at all.

### 7.2 Adversaries
| Adversary | In scope? | Notes |
|---|---|---|
| **Honest-but-curious server operator** with full DB and log access, following the protocol | **Yes — primary** | Claims C1–C5 are against this adversary |
| Other student using the normal app (curious, probing, harassing, stalking) | Yes | Mitigated by protocol, K cap, next-day digest, coarse time, block/report |
| Passive BLE sniffer (generic scanner app) | Partly | Sees rotating EIDs and that *some* Mutual device is nearby; cannot link EIDs to accounts without daily keys, which are never distributed. App presence leaks — accepted |
| Relay attacker forwarding EIDs between two places in both directions | Accepted risk | Could create a false crossing between two real users; low impact |
| Sybil accounts | Mitigated | One account per verified college email |
| Network attacker | TLS only | Dev runs on localhost HTTP; pilot must use TLS |
| **Malicious (active) server** — substituting public keys, forging digests | **Out of scope** | Stated limitation. A key-fingerprint display is a possible future mitigation |
| Server operator colluding with a user account | Out of scope | That account can test one-sided interest *toward itself*; inherent to any scheme where the operator can also be a user |
| Compromised or lost device | Out of scope | Secure storage reduces impact |

### 7.3 What the server learns (by design) and never learns

| Server learns | Server never learns |
|---|---|
| Verified accounts, first names, profile text and media | Plaintext email, date of birth |
| Crossing pairs at **day** granularity, retained 7 days | GPS location or any place |
| That a user uploaded a signal set (always exactly 20 tokens) | Whom a signal targets, or whether any real signal exists |
| Mutual matches (pairs) | The intent of any signal or match |
| Messages within matches; message counts | Which digest cards a user opened or played |
| Blocks and reports (explicit user disclosures) | Crossing times finer than the day after resolution |

Raw sightings are processed transiently during resolution (which reveals the
15-minute interval of each sighting to the resolving process) and deleted at
the cutoff; only the day is stored.

### 7.4 Security claims (each must map to a test or a written argument)

- **C1 — Independence.** For any user U, the server's stored rows and the
  request log produced by U (method, path, query, body length, status, ordered
  by time with a mocked clock) are identical whether or not U holds a real
  signal for any particular peer — except for the random contents of
  `epoch_tokens.token`. *Test:* `server/tests/test_leak_two_worlds.py`.
  *Argument:* pseudorandomness of keyed BLAKE2b under a key derived from
  X25519 (`docs/SECURITY_ARGUMENT.md`).
- **C2 — Only mutual same-intent interest is ever revealed**, and only to the
  two parties. *Tests:* protocol property tests (different intent ⇒ different
  token); server tests (cross-intent signals never match).
- **C3 — The server never learns intents.** *Argument + test:* no API field
  carries an intent; `test_route_audit.py` scans request/response schemas for
  any field named or typed as an intent.
- **C4 — No location.** *Test:* `app/scripts/check-privacy-invariants.ts`
  asserts the merged Android manifest contains no location permissions and
  `BLUETOOTH_SCAN` carries `neverForLocation`. *Argument:* the server stores
  only day-granularity crossing pairs with 7-day retention
  (`test_retention.py`).
- **C5 — No real-time proximity.** *Test:* a crossing for day `d` is never
  returned by `GET /v1/digest` before `release_time` on day `d+1`
  (`test_digest.py`, using the injected clock).

---

## 8. Safety requirements

- **S1** 18+ only. Date of birth is checked at account creation and discarded;
  under-18 is rejected with a kind message.
- **S2** One account per verified college email (allowlisted domains).
- **S3** No messaging before a mutual match. Text only; max 1000 characters;
  30 messages per minute rate limit; no links rendered as links.
- **S4** Block: immediate, both directions, silent. Removes the peer from all
  future digests, deletes shared crossings, suppresses and deletes any match,
  and hides the conversation.
- **S5** Report: reason (harassment, fake profile, inappropriate content,
  underage, safety concern, other) plus up to 10 selected messages, copied
  into the report so they survive an unmatch. Reports go to a moderation queue
  handled by `python -m mutual_server.admin`.
- **S6** Pause discovery: stops advertising and scanning immediately and
  excludes the user from digests until resumed. Matches and chats remain.
- **S7** No real-time proximity, no places, no crossing counts, coarse time
  blocks only, next-morning visibility (§7 C5).
- **S8** Minimum dwell: a passing glance never creates a crossing (§14.4).
- **S9** Notifications never contain names or content — only "Your morning
  letter is here."
- **S10** Revealed photos are shown on screens that set Android
  `FLAG_SECURE` (blocks screenshots and screen recording of those screens).
- **S11** Account deletion: sessions revoked immediately; all rows and media
  hard-deleted within 24 hours; matched partners see "This person has left."
- **S12** A plain-language "What Mutual can and can never see" screen,
  consistent with §7.3, reachable from onboarding and settings.

---

## 9. Data handling and retention

| Data | Where | Retention |
|---|---|---|
| Email | Never stored; HMAC-SHA256 with server secret `email_pepper` | Account lifetime. (This prevents casual exposure in a DB dump, not a determined operator.) |
| Date of birth | Never stored; `age_verified_at` only | — |
| OTP codes | SHA-256 hash, 10-minute TTL, 5 attempts | Deleted on use/expiry |
| Session tokens | SHA-256 hash | 30 days |
| Presence uploads (daily key + sightings) | Server | Until cutoff (start of `d+2`), then deleted |
| Crossings (`day`, user pair) | Server | 7 days |
| Epoch tokens | Server | Deleted 2 days after the epoch |
| Matches | Server | Until unmatch, block or account deletion |
| Messages | Server | Deleted on unmatch/block/deletion (report excerpts retained) |
| Reports | Server | Until resolved + 90 days |
| Signals, peer keys, sightings, own daily keys | Device (`expo-sqlite`, keys in `expo-secure-store`) | Signals: TTL; sightings: until uploaded; daily keys: until uploaded |

A retention job (`mutual_server.services.retention`) runs at startup and every
hour. Request-path logging is off unless `MUTUAL_ENV=dev`. India's Digital
Personal Data Protection Act, 2023 applies to any real deployment; consult the
institution before Tier 3. This spec is not legal advice.

---

## 10. Architecture

```
 ┌─────────────────────────── Android phone ───────────────────────────┐
 │  Expo app (TypeScript)                                               │
 │   ├─ @mutual/protocol (protocol-ts)  ← keys, tokens, EIDs            │
 │   ├─ signals/ (queue + scheduled padded upload)                      │
 │   ├─ presence/ (EID schedule → native; drain sightings → upload)     │
 │   ├─ digest/prefetch (eager media fetch)                             │
 │   ├─ api/client.ts  ← the ONLY network boundary                      │
 │   └─ modules/mutual-ble (Kotlin): advertise · scan · FG service      │
 └───────────────────────────────┬─────────────────────────────────────┘
                                 │ HTTPS (localhost HTTP in dev)
 ┌───────────────────────────────▼─────────────────────────────────────┐
 │  FastAPI server (Python) — mutual_server                             │
 │   routers: auth · account · profile · presence · digest · signals ·  │
 │            matches · messages · safety · config · dev(dev only)      │
 │   services: resolution · matching · ranking · arms · retention ·     │
 │             email · clock                                            │
 │   SQLite (dev) via SQLAlchemy 2 + Alembic; media on local disk       │
 │   uses mutual_protocol (protocol_py) for EID resolution              │
 └──────────────────────────────────────────────────────────────────────┘
 sim/ (mutual_sim) — standalone; no dependency on server or app
```

---

## 11. Server API (`/v1`, JSON, bearer session token)

Errors: `400` malformed/semantic, `401` no session, `403` forbidden,
`404` not found, `409` duplicate, `422` validation, `425` too early,
`429` rate limited. Error body `{ "error": "<code>", "message": "<text>" }`.

### Auth and account
| Method & path | Body → response | Rules |
|---|---|---|
| `POST /auth/request-otp` | `{email}` → 204 | Domain in `auth.allowed_email_domains`; 60 s resend cooldown; in dev the code is printed to the console |
| `POST /auth/verify-otp` | `{email, code}` → `{session_token, account_exists}` | Constant-time compare; 5 attempts |
| `POST /auth/logout` | → 204 | Revokes session |
| `POST /account` | `{date_of_birth, identity_pk, first_name, year_of_study?, consent_version?}` → `{user_id}` | 18+ (S1); DOB discarded; `consent_version` required only in study mode |
| `GET /account/me` | → account summary | |
| `PUT /account/identity-key` | `{identity_pk}` → 204 | For reinstall; documented limitation §6.10 |
| `DELETE /account` | → 202 | S11 |

### Profile
| Method & path | Notes |
|---|---|
| `GET /prompts` | The prompt library (`mutual_server/data/prompts.json`) |
| `PUT /profile` | `{first_name, year_of_study?, prompts:[{prompt_id, text}] (exactly 3, one is looking_for), tags?}` |
| `POST /profile/voice/{prompt_id}` | multipart: audio (≤30 s, m4a/aac) + `waveform` (48 ints 0–100) |
| `DELETE /profile/voice/{prompt_id}` | |
| `POST /profile/photos` | multipart image; max 4; server strips EXIF and re-encodes |
| `DELETE /profile/photos/{index}` | |

### Presence and digest
| Method & path | Notes |
|---|---|
| `POST /presence/{day}` | `{daily_key, sightings:[{eid, windows, rssi_median}]}` → 201. `day` must be before today and not past cutoff (400); once per day (409) |
| `GET /digest` | → `{release_day, days:[{day, peers:[PeerCard]}], media:[{media_id, bytes, sha256}]}`. Only crossings whose day ≤ yesterday, and only after `release_time` for yesterday's. Excludes blocked, paused, deleted, suspended and already-matched peers. At most `display_cap` peers per day, ordered by ranking (§11.1) |
| `GET /media/{media_id}` | Voice notes of peers in the viewer's digest window. 403 otherwise |

`PeerCard = {peer_id, first_name, year_of_study?, identity_pk, prompts:[{prompt_id, text, voice_media_id?, waveform?}]}` — never photos, never counts, never times.

### Signals and matches
| Method & path | Notes |
|---|---|
| `PUT /signals/{epoch}` | `{tokens:[base64url × 20]}` → 201. 400 if `epoch ≠` current; 425 before window start; 409 if exists; 422 if count ≠ 20 or any token ≠ 32 bytes. Runs matching (§6.9) |
| `GET /matches` | Matches with `notify_after ≤ now`: `[{match_id, peer: PeerCard, matched_tokens:[base64url], created_epoch, reveal:{state, policy, messages_needed_each?}, unread}]` |
| `GET /matches/{match_id}/photos/{index}` | Only if revealed under the active policy (§11.2) |
| `POST /matches/{match_id}/reveal-consent` | Policy C only |
| `GET /matches/{match_id}/messages?after=` | |
| `POST /matches/{match_id}/messages` | `{body}`; S3 |
| `DELETE /matches/{match_id}` | Unmatch; deletes messages |

### Safety, config, dev
| Method & path | Notes |
|---|---|
| `POST /blocks` | `{peer_id}` (allowed pre-match; explicit user disclosure) |
| `POST /reports` | `{peer_id, reason, message_ids?}` |
| `POST /discovery/pause`, `POST /discovery/resume` | S6 |
| `GET /config` | `{server_time, epoch, protocol_version, reveal_policy, next_policy_change?, signal_upload_window, presence_upload_window, digest_release_time, interest_ttl_days, ble:{...}, study_enabled}` |
| `POST /dev/clock` | `{offset_seconds}` — **dev only** |
| `POST /dev/crossing` | `{user_a, user_b, day}` — **dev only**, creates a confirmed crossing |
| `POST /dev/seed` | Creates N synthetic users with profiles — **dev only** |

### 11.1 Digest ranking
`ranking.method: reciprocal_content` (Tier 2) or `random` (Tier 1 default).
Reciprocal content score for viewer A and peer B: embed A's `looking_for`
answer and B's other answers (and vice versa) with
`sentence-transformers/all-MiniLM-L6-v2` on CPU; `s_AB = cos(lf_A, about_B)`,
`s_BA = cos(lf_B, about_A)`; score = harmonic mean of the two (clipped to
[0, 1]). `random` is a stable per-(viewer, day) shuffle seeded by HMAC of the
pair. **Ranking may never use signal, match or attention data** — and is
identical across reveal policies.

### 11.2 Reveal policies
- **M (default):** photos available to both parties as soon as the match is
  notified.
- **C:** photos available when each party has sent at least
  `reveal.conversation_messages_each` (8) messages, or both have posted
  reveal-consent, whichever comes first.
- The active policy is chosen by date from `reveal.policy_schedule`; a match
  keeps the policy active when it was created.
- **P** (photo at discovery) exists **only in the simulation**. The server does
  not implement it (decision D9).

---

## 12. Data model (SQLAlchemy 2, SQLite in dev)

All ids are UUIDv4 strings. All timestamps UTC; "day" and "epoch" are local
date strings.

- `users(id, email_hmac UNIQUE, first_name, year_of_study, identity_pk,
  age_verified_at, discovery_paused, suspended_at, deleted_at, created_at,
  consent_version)`
- `otp_codes(email_hmac, code_hash, expires_at, attempts, last_sent_at)`
- `sessions(token_hash PK, user_id NULL until account exists, email_hmac,
  expires_at)`
- `profiles(user_id PK, prompts JSON, tags JSON, updated_at)`
- `media(id, user_id, kind[voice|photo], prompt_id NULL, photo_index NULL,
  path, bytes, sha256, waveform JSON NULL, created_at)`
- `presence_uploads(user_id, day, daily_key, sightings JSON, uploaded_at)`,
  PK `(user_id, day)`
- `presence_eids(day, eid PK-part, user_id)` — derived lookup, deleted with
  uploads
- `directional_sightings(day, observer_id, observed_id, qualified_windows,
  rssi_median)` — transient, deleted at cutoff
- `crossings(day, user_lo, user_hi, created_at)`, PK `(day, user_lo, user_hi)`
- `epoch_tokens(epoch, user_id, token)`, index on `(epoch, token)`; unique
  `(epoch, user_id, token)`; one set per `(epoch, user_id)` enforced via
  `signal_uploads(epoch, user_id PK, uploaded_at)`
- `matches(id, user_lo, user_hi, tokens JSON, created_epoch, policy,
  notify_after, revealed_at NULL, unmatched_at NULL)`; unique active pair
- `reveal_consents(match_id, user_id)`
- `messages(id, match_id, sender_id, body, created_at)`
- `blocks(blocker_id, blocked_id, created_at)`
- `reports(id, reporter_id, reported_id, reason, excerpt JSON, status,
  created_at, resolved_at)`

---

## 13. App — screens, behaviour and design system

### 13.1 Stack
Expo (current stable SDK) with a development build (not Expo Go — the BLE
module is native), TypeScript strict, `expo-router`, `react-native-reanimated`,
`react-native-svg`, `expo-secure-store`, `expo-sqlite`, `expo-haptics`,
`expo-font` (Google Fonts, OFL licensed), `expo-image-picker`, the current
Expo audio-recording package, and the current Expo background-task package.
**Package names for audio and background tasks have changed across Expo SDK
versions — check the docs for the installed SDK and record the choice in the
Progress log.** TanStack Query for server state; Zustand for local UI state.
npm workspaces link `@mutual/protocol`; follow the Expo monorepo guide.

### 13.2 Navigation
```
app/app/
  _layout.tsx
  (onboarding)/ welcome · how-it-works · email · code · age · basics ·
                prompts · photos · permissions · consent(study only)
  (tabs)/ _layout · today · signals · mutuals · you
  profile/[id].tsx      # full profile of a digest peer (§13.9)
  match/[id].tsx        # chat
  reveal/[id].tsx       # the Reveal moment (modal)
  privacy.tsx           # "What Mutual can and can never see"
  dev.tsx               # dev panel, only when MUTUAL_ENV=dev
```

### 13.3 Design concept: "a morning letter, not a slot machine"
Calm, warm, literate, unhurried. Paper and ink, one warm colour for the act of
signalling, one cool colour reserved for mutual moments. Generous whitespace.
Type does the expressive work; decoration is minimal.

### 13.4 Tokens (`app/src/design/tokens.ts`) — starting values
| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#F7F3EE` | `#121016` | Screen background (warm paper / ink night) |
| `surface` | `#FFFFFF` | `#1B1820` | Cards |
| `surfaceSunk` | `#EFE9E1` | `#16131B` | Inputs, sheets |
| `ink` | `#1D1A22` | `#F2EEF6` | Primary text |
| `inkMuted` | `#5F5868` | `#A49DAE` | Secondary text |
| `hairline` | `#E3DCD2` | `#2C2733` | Borders |
| `signal` | `#B5523F` | `#F08A72` | Send-a-signal actions (terracotta) |
| `signalSoft` | `#F6E3DD` | `#3A2420` | Signal backgrounds |
| `mutual` | `#4F4FC4` | `#9A9AF2` | Mutual moments only (indigo) |
| `mutualSoft` | `#E6E6FA` | `#25244A` | Mutual backgrounds |
| `danger` | `#A3333D` | `#F2808A` | Block/report/delete |
| `onSignal` | `#FFFFFF` | `#1D1A22` | Text on `signal` fills |
| `onMutual` | `#FFFFFF` | `#121016` | Text on `mutual` fills |
| `scrim` | `rgba(20,16,26,.36)` | `rgba(0,0,0,.55)` | Behind sheets |

These are starting values. `npm run check:contrast -w app` must confirm every
text/background pair used ≥ 4.5:1 (body) and ≥ 3:1 (≥ 18 pt or bold 14 pt)
in both themes; adjust tokens (and this table) until it passes.

Type: **Fraunces** (display — names, prompt answers, headings; italic for
prompt questions) and **Inter** (UI). Scale (pt): 12, 14, 16, 18, 22, 28, 36.
Line height 1.35 for display, 1.5 for body. Spacing scale 4, 8, 12, 16, 24,
32, 48. Radii: cards 20, sheets 28, pills 999. Shadows: one soft level only.
Motion: 180 ms (micro), 320 ms (sheet), 900 ms (reveal); standard ease-out;
all motion disabled or reduced when the OS reduce-motion setting is on.

### 13.5 Key components
- **GenerativeAvatar** — deterministic from `identity_pk`: BLAKE2b of the key
  selects 2–3 colours from a curated palette and the control points of a soft
  blob (SVG). Used everywhere before reveal. Never a silhouette or a blurred
  photo.
- **CrossingCard** — time chip ("Yesterday · evening", computed on-device
  from local sighting logs), prompt question in Fraunces italic 14, answer in
  Fraunces 22–28, first name + year in Inter 14 muted, optional
  **VoicePlayer** (waveform bars from the stored 48-value waveform, play/pause,
  elapsed time), and the **Send a signal** button.
- **SignalSheet** — five intent chips, multi-select, the reassurance line,
  confirm button in `signal`. Shows remaining signals.
- **SignalDots** — 20 dots, filled for used signals.
- **RevealMoment** — full-screen: the GenerativeAvatar dissolves into the
  photo (crossfade + blur 20→0 + scale 1.04→1 over 900 ms), shared intents
  shown beneath, success haptic. Instant when reduce-motion is on.
  `FLAG_SECURE` on.
- **ChatBubble**, **IntentChip**, **EmptyState**, **PrivacyRow**.

### 13.6 Copy voice
Plain, warm, honest, never pushy. No emoji in system copy. Examples:
- Today empty: "No crossings yesterday. Mutual notices people you spend a little time near — keep it on during your day."
- Before release: "Your morning letter arrives at 8."
- Signal sent: "Signal sent. If they send one back, you'll both know tomorrow morning."
- Signals full: "All 20 signals are out. Withdraw one to send another."
- Privacy screen headings: "Mutual can see" / "Mutual can never see".

### 13.7 Accessibility
Touch targets ≥ 44×44 pt. Support OS font scaling to 200 % without
truncating names or prompt answers. Every interactive element has an
accessibility label. Colour is never the only signal. Voice prompts always
have their required text answer (decision D8).

### 13.8 App architecture rules
- Network only via `src/api/client.ts` (ESLint `no-restricted-globals` for
  `fetch`, `no-restricted-syntax` for `XMLHttpRequest`).
- `src/digest/prefetch.ts` is the only code that fetches media.
- `src/signals/` owns the local signal DB, TTL logic, the padded-set builder
  (calls protocol-ts), and the upload scheduler.
- `src/presence/` owns daily-key generation (2 days ahead), the EID schedule
  handed to native, draining sightings and the nightly upload.
- `src/presence/bleAdapter.ts` defines the interface; `nativeBle.ts` wraps
  `modules/mutual-ble`; `fakeBle.ts` generates synthetic sightings for
  emulators and tests.
- `src/matches/resolve.ts` maps matched tokens → `(peer, intent)` locally.

### 13.9 Visual reference (approved by the human, 2026-10-05)
`docs/design/prototype.html` is the approved visual reference for every
screen. Open it in a browser. The Android app must match it **exactly**:
layout, spacing, type, colour, copy, states and motion, in both themes. Where
§13.1–13.8 and the prototype disagree on look and feel, the prototype wins.
On behaviour, privacy and safety, §6–§9 and `CLAUDE.md` §5 always win.

The prototype adds these elements, which are now part of this spec:
- **Profile screen** (`profile/[id].tsx`): avatar, name, year, time chip,
  tags, every prompt as a large card with its voice player, the note "Photos
  appear only if you both signal each other for the same thing", and a sticky
  "Send a signal" button.
- **"Not for me"** on the profile: hides that peer's cards on this device
  only. It makes no network request and is never uploaded (invariant 1).
- **Signal sent state** on cards and the profile shows the chosen intents to
  the sender only. Tapping it reopens the SignalSheet to change or withdraw.
- **SignalSheet** meter: the 20 dots show signals already in use and, in
  `signal`, the ones about to be added.
- **Mutuals**: a "New this morning" card for each unrevealed match.
  Conversation rows show the last message, "Your turn" when the last message
  is the peer's, and, under policy C, "Photos after N more messages each".
- **Chat** opens with the peer's first prompt as context, and has a safety
  menu (report, unmatch, block).
- **You tab**: profile preview, discovery switch, photos row, privacy row,
  notifications row, and delete account with an inline confirmation.
- **Welcome and How it works**: copy and three-panel structure as in the
  prototype. In the app, How it works continues to the email step (J1).
- Tokens `onSignal`, `onMutual` and `scrim` (§13.4).

Not taken from the prototype: its avatar uses an FNV hash and its photos are
placeholders painted in the browser. The app's GenerativeAvatar hashes
`identity_pk` with BLAKE2b (§13.5) but keeps the prototype's palette and blob
construction. Real photos come from the server after reveal (§11.2).

---

## 14. BLE subsystem (`app/modules/mutual-ble`, Kotlin, Expo Modules API)

### 14.1 Permissions (merged manifest)
`BLUETOOTH_SCAN` with `usesPermissionFlags="neverForLocation"`,
`BLUETOOTH_ADVERTISE`, `FOREGROUND_SERVICE`, the foreground-service type
permission required for a `connectedDevice` foreground service on Android 14+,
`POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `RECORD_AUDIO`. Location
permissions are blocked via the Expo config (`android.blockedPermissions`).
Verify exact names against current Android documentation for the installed
target SDK and record them in the Progress log.

### 14.2 Advertisement
Legacy, non-connectable advertisement with manufacturer-specific data:
company id `0xFFFF` (Bluetooth SIG test id — **not for shipping products**;
acceptable for a research prototype, decision D17), payload =
`magic(0x4D 0x55) || payload_version(1) || EID(16)` = 19 bytes. Total
advertisement 26 of 31 bytes (flags 3 + manufacturer AD 23). Low-power
advertise mode; TX power from config. On each 15-minute EID rotation the
module stops and restarts advertising (to encourage a new random device
address; whether this happens is verified in the spike).

### 14.3 Scanning
Duty-cycled inside the foreground service: scan `ble.scan_window_seconds` (8)
every `ble.scan_period_seconds` (60). A `ScanFilter` on manufacturer id
`0xFFFF` with the magic+version prefix is mandatory (Android pauses
unfiltered scans when the screen is off). Own EIDs are dropped.

### 14.4 Sighting aggregation and dwell
Per EID the module keeps `windows` (number of scan windows in which it was
heard with RSSI ≥ `ble.rssi_threshold_dbm`) and the median RSSI. On
resolution the server sums qualified windows across all of a peer's EIDs for
the day; a **directional sighting** qualifies if the sum ≥
`presence.min_qualified_windows` (4). A **crossing** requires qualified
directional sightings in **both** directions.

### 14.5 Schedule and service lifecycle
JS hands native a schedule of `(day, interval, eid)` for today and tomorrow.
If the schedule runs out, native stops advertising and posts a notification
asking the user to open Mutual (fail-safe; it never invents EIDs). The
foreground service shows "Mutual is on · tap to pause", restarts after reboot
if discovery was on, and stops entirely on pause.

### 14.6 Known risk to verify first (spike, Phase 9a)
Android documentation states that with `neverForLocation`, **some BLE beacons
are filtered from scan results**. The spike must confirm that Mutual's
advertisement is detected with `neverForLocation` set. If it is filtered, try
alternative payload formats (e.g. 16-bit service data, or a scan-response
layout) — **never** add a location permission (CLAUDE.md invariant 3). If no
format works, stop and escalate to the human as a spec decision.

---

## 15. Simulation (`sim/`, package `mutual_sim`)

Purpose: answer RQ2 with ground truth that the real system deliberately
cannot observe. **All conclusions are conditional on the model's
assumptions**; the report must say so in its first paragraph.

### 15.1 Population (defaults in `sim/config.yaml`)
`N = 600` agents across 6 hostels and 8 departments. Each agent has:
visual attractiveness `a ~ N(0, 1)`; compatibility vector `c` uniform on the
unit sphere in ℝ⁸; daily activity probability `o ~ Beta(2, 2)`; date-openness
with probability 0.6 (other intents always open).

### 15.2 Co-presence
Each simulated day, active agents cross others drawn from a stochastic block
model: probability weights for same hostel, same department, and otherwise
(config). Crossings are symmetric.

### 15.3 Discovery and signalling
On day `t+1`, agent `i` sees up to `display_cap` of day `t`'s crossings. For
each visible `j`:
`u_ij = β_a · a_j · 𝟙[photo visible] + β_c · cos(c_i, c_j) + ε`,
`ε ~ Logistic(0, 1)`. Agent `i` signals the visible peers with
`u_ij > τ`, best first, subject to `K` active signals and the 7-day TTL.
Photos are visible at discovery only under policy P.

### 15.4 Matching, conversation and reveal
Mutual same-intent signals within TTL ⇒ match. Conversations proceed in
message rounds. At reveal (immediately under M; at match under P since photos
were already seen; after `n_reveal` rounds under C), each side continues with
probability `σ(γ_a · a_other · (1 − δ · progress) + γ_c · cos + γ_0)`, where
`progress` is the fraction of `n_reveal` rounds completed (so investment can
dampen the appearance check under C). Under C, each pre-reveal round adds
`φ` to the agent's frustration (models "irritated by not seeing faces").

### 15.5 Churn
Daily churn probability
`h = clip(h_0 + h_f · frustration − h_m · recent_matches, 0, 1)`.
Churned agents stop being active.

### 15.6 Outputs per run (T = 56 days)
Gini of interest received (among agents active ≥ 1 day); Gini of matches;
matches per active agent-day; mean compatibility `cos(c_i, c_j)` of matched
pairs; share of conversations ending at reveal; share of matches captured by
the top decile of `a`; retention at days 28 and 56.

Gini: `G = Σ_i Σ_j |x_i − x_j| / (2 n² μ)`, with `G = 0` when `μ = 0`.
Test values: `[1,1,1,1] → 0`, `[0,0,0,1] → 0.75`, `[1,2,3,4] → 0.25`.

### 15.7 Experiment
Policies P, M, C × 30 seeds at default parameters, plus a sweep over
`β_a/β_c ∈ {0, 0.5, 1, 2, 4}`, `φ ∈ {0, 0.02, 0.08}`, `K ∈ {5, 10, 20}`
(30 seeds per cell). 95 % percentile bootstrap CIs (10 000 resamples, seeded)
over seeds. Seeds 0–29 for the main experiment; the sweep uses seeds
1000+. Runtime: full main experiment < 15 minutes on one CPU core; the sweep
may take longer and its runtime is recorded.

Parameter values are literature-*informed* assumptions, not measurements.
The report lists every parameter with its value and states which conclusions
reverse anywhere in the sweep.

---

## 16. Field pilot (Tier 3 — gated)

**Gate (mechanically enforced).** `study.enabled: true` requires
`study.approval_reference` to be non-empty; otherwise the server refuses to
start (`test_study_gate.py`). `study/APPROVAL.md` must record the approving
body, reference number, date and conditions. Permission from the relevant
institutional authority is also required before recruitment.

**Design.** Switchback ABAB over four 2-week blocks: M, C, M, C (order fixed
in `study/PREREGISTRATION.md` before the first study day and committed to
git). Participants: consenting adults with verified college email. Users are
told the active policy in-app. Participants can withdraw at any time from
settings, which deletes their data.

**Outcomes (observable server-side, per block).** Gini of matches received
among active users; matches per active user-week; messages per match; share
of matches reaching ≥ 10 messages; unmatch within 24 h of reveal; weekly
retention. **Survey** at the end of each block (in-app, optional, 3 Likert
items: comfort, frustration at not seeing faces, overall satisfaction).

**Analysis.** Block-level comparisons with bootstrap CIs; mixed-effects
logistic regression for unmatch-after-reveal with a user random effect.
Framed as a pilot: low statistical power is expected and reported.

**De-identification.** `study/analysis/export.py` exports counts only: no
names, prompts, messages or media; user ids replaced with HMAC under a study
salt; no crossing pairs exported.

---

## 17. Constraints and stack

- Python 3.11; FastAPI; Uvicorn; SQLAlchemy 2.x; Alembic; Pydantic v2;
  `cryptography`; `httpx` + `pytest` for tests; `ruff`.
- Optional (Tier 2 ranking): `sentence-transformers` CPU, model
  `all-MiniLM-L6-v2`.
- Simulation: `numpy`, `pandas`, `matplotlib`, `pyyaml`.
- Node current LTS; TypeScript; `vitest` for protocol-ts; `jest` (Expo
  preset) for the app; ESLint.
- Android Studio, Android SDK and the JDK version required by the installed
  Expo SDK; physical Android 12+ phones for Phase 9 only.
- `pre-commit` framework for git hooks (cross-platform).
- Everything free. Versions pinned in `pyproject.toml` / `package.json`
  lockfiles; pins recorded in the Progress log when first chosen.

---

## 18. Configuration

### `server/config.example.yaml` (copied to `server/config.yaml`, which is gitignored)
```yaml
timezone: Asia/Kolkata
secrets:                      # set via environment variables in practice
  email_pepper_env: MUTUAL_EMAIL_PEPPER
auth:
  allowed_email_domains: ["example.edu"]     # OPEN QUESTION Q1
  otp_ttl_seconds: 600
  otp_max_attempts: 5
  otp_resend_cooldown_seconds: 60
  session_ttl_days: 30
  min_age_years: 18
presence:
  min_qualified_windows: 4
  crossing_retention_days: 7
  upload_window_start: "00:05"
  upload_window_end: "06:00"
digest:
  release_time: "08:00"
  lookback_days: 7
  display_cap: 40
  media_prefetch_cap_mb: 25
signals:
  upload_window_start: "18:00"
  upload_window_end: "23:30"
  interest_ttl_days: 7
  token_retention_days: 2
reveal:
  default_policy: M
  policy_schedule: []         # [{start: YYYY-MM-DD, end: YYYY-MM-DD, policy: M|C}]
  conversation_messages_each: 8
messages:
  max_length: 1000
  rate_limit_per_minute: 30
media:
  storage_dir: server/media
  voice_max_seconds: 30
  photos_max: 4
ranking:
  method: random              # random | reciprocal_content
ble:
  scan_window_seconds: 8
  scan_period_seconds: 60
  rssi_threshold_dbm: -80
  advertise_tx_power: medium
study:
  enabled: false
  approval_reference: ""
```

### `sim/config.yaml`
Holds every parameter in §15 with its default, including `beta_a`, `beta_c`,
`tau`, `gamma_a`, `gamma_c`, `gamma_0`, `delta`, `phi`, `n_reveal`, `h_0`,
`h_f`, `h_m`, SBM weights, `N`, `T`, `K`, `display_cap`, seeds and sweep
grids. Each parameter has a comment saying whether it is an assumption or a
literature-informed range.

---

## 19. Acceptance criteria

Every criterion is pass/fail. "Recorded" criteria pass when the measurement
exists in the named file, whatever its value.

### Tier 1
- **AC-T1-1 Protocol (Python).** `pytest packages/protocol_py` passes,
  including: pair-key symmetry over 1 000 random key pairs; all-zero shared
  secret rejected; identical keys rejected; tokens differ when pair, epoch or
  intent differ (≥ 5 000 tokens, zero collisions); padded set has exactly 20
  entries of 32 bytes, contains every real token, and raises on > 20 real
  tokens; 96 distinct EIDs per daily key; all constants loaded from
  `constants.json`.
- **AC-T1-2 Vectors.** `python -m mutual_protocol.vectors --out
  packages/protocol-spec/vectors.json` generates ≥ 100 deterministic cases
  covering pair key, token, EID and base64url; the committed file equals a
  fresh regeneration.
- **AC-T1-3 Protocol (TypeScript).** `npm test -w packages/protocol-ts`
  reproduces every vector byte-for-byte and passes the same property tests.
- **AC-T1-4 Server functional.** `pytest server` passes, covering: OTP flow
  (domain allowlist, TTL, attempts, cooldown, constant-time compare); under-18
  rejected and DOB not persisted; presence upload rules (past day only,
  cutoff, once per day); resolution requires both directions and
  `min_qualified_windows`; digest excludes blocked, paused, deleted,
  suspended and matched peers and respects `display_cap`; signal upload
  rules (400/409/422/425); matching on shared token, no match across intents,
  match suppressed by block, new shared intent appended to existing match;
  `notify_after` = next release time; photo gating under M and C; reveal
  consent; message limits; unmatch deletes messages; report copies excerpts;
  account deletion cascades.
- **AC-T1-5 Leak test (C1).** `server/tests/test_leak_two_worlds.py` passes:
  worlds A (U signals V for `date`) and B (U signals no one) produce
  identical row counts, identical rows except `epoch_tokens.token` bytes,
  identical request logs (method, path, query, body length, status), and
  identical API views for V. A third world C (V signals U back) produces a
  detectable match, proving the test is not vacuous.
- **AC-T1-6 Route audit (invariant 10, C3).** `test_route_audit.py`
  enumerates every route; every route with a user, peer or match id is either
  on the block/report allowlist or returns non-2xx without a qualifying match;
  no request or response schema contains a field named or typed as an intent;
  `/v1/dev/*` routes are absent when `MUTUAL_ENV` ≠ `dev`.
- **AC-T1-7 Retention and time (C4, C5).** `test_retention.py` and
  `test_digest.py` pass using the injected clock.
- **AC-T1-8 Costs recorded.** Bytes per daily signal upload, bytes per
  presence upload for 50 and 500 sightings, and worst-case match latency in
  hours are computed and recorded in `docs/SECURITY_ARGUMENT.md`.
- **AC-T1-9 Simulation.** `pytest sim` passes (Gini test values from §15.6,
  determinism: identical seed ⇒ identical output hash, policy P is the only
  policy where `β_a` affects discovery). `python -m mutual_sim.run --config
  sim/config.yaml --seeds 30` completes in < 15 minutes on one CPU core and
  writes `sim/results/report.md` with every §15.6 metric per policy, 95 %
  bootstrap CIs, the assumption caveat in the first paragraph, and figures in
  `sim/results/figures/`. `python -m mutual_sim.sweep` writes the sweep table
  and names any conclusion that reverses within the grid.
- **AC-T1-10 Documents.** `docs/THREAT_MODEL.md` and
  `docs/SECURITY_ARGUMENT.md` exist; the latter maps each of C1–C5 to the test
  file(s) and/or argument that supports it, and includes the RQ4 section.

### Tier 2
- **AC-T2-1 Build.** `npx expo run:android` produces a working dev build;
  `npm run lint -w app` passes, including the fetch restriction and the
  no-hex-literal rule.
- **AC-T2-2 App unit tests.** `npm test -w app` passes, covering: signal TTL
  and cap; padded set built through protocol-ts; upload scheduler never
  uploads before the window, never twice per epoch, never for a past epoch;
  match resolution token → (peer, intent); prefetch fetches every listed media
  item in sorted order regardless of UI state; rendering `CrossingCard` and
  `VoicePlayer` performs no network call.
- **AC-T2-3 Privacy invariants.** `npm run check:privacy -w app` passes: the
  merged Android manifest has no location permissions and `BLUETOOTH_SCAN`
  has `neverForLocation`; no denylisted SDK in any `package.json`; no
  `fetch`/`XMLHttpRequest` outside `src/api/client.ts`.
- **AC-T2-4 Contrast.** `npm run check:contrast -w app` passes for both
  themes.
- **AC-T2-5 End-to-end (emulators, fake BLE).** Every item in
  `docs/E2E_CHECKLIST.md` is ticked with a date: onboarding, dev crossing,
  digest after release, signals both ways, match next morning, reveal under M
  and under C, chat, block, report, pause, account deletion.
- **AC-T2-6 BLE spike recorded.** `docs/BLE_SPIKE.md` records, on two
  physical Android 12+ phones: whether detection works with
  `neverForLocation`; detection rate at 1 m, 3 m and 10 m; false-crossing rate
  for a 30-second walk-past; whether the device address rotates with the EID;
  and battery drain over 8 hours with the screen off versus a control day.
  If drain exceeds 10 % per 8 hours, the duty cycle is revised through a spec
  change.

### Tier 3 (only after approval)
- **AC-T3-1** `test_study_gate.py` passes (server refuses study mode without
  `approval_reference`).
- **AC-T3-2** `study/PREREGISTRATION.md`, `study/CONSENT.md`,
  `study/PARTICIPANT_INFO.md` exist and the pre-registration commit predates
  the first study day.
- **AC-T3-3** `python study/analysis/analyze.py --input
  study/analysis/synthetic_export.csv` runs on a synthetic export and produces
  every pre-registered table.

---

## 20. Output files

```
CLAUDE.md  SPEC.md  PLAN.md  README.md  .gitignore  .pre-commit-config.yaml  package.json
packages/protocol-spec/constants.json
packages/protocol-spec/vectors.json                     (generated, committed)
packages/protocol_py/pyproject.toml
packages/protocol_py/mutual_protocol/{__init__,constants,encoding,keys,tokens,eid,vectors}.py
packages/protocol_py/tests/{test_keys,test_tokens,test_eid,test_encoding,test_vectors}.py
packages/protocol-ts/{package.json,tsconfig.json,vitest.config.ts}
packages/protocol-ts/src/{index,constants,encoding,keys,tokens,eid,random}.ts
packages/protocol-ts/test/{vectors,properties}.test.ts
server/{pyproject.toml,config.example.yaml,alembic.ini}
server/migrations/                                       (Alembic)
server/mutual_server/{__init__,main,config,clock,db,models,security,schemas,admin}.py
server/mutual_server/data/prompts.json
server/mutual_server/routers/{auth,account,profile,presence,digest,signals,matches,messages,safety,config_route,dev}.py
server/mutual_server/services/{resolution,matching,ranking,arms,retention,email,media}.py
server/tests/{conftest,test_auth,test_account,test_profile,test_presence,test_digest,test_signals,test_matches,test_reveal,test_messages,test_safety,test_retention,test_leak_two_worlds,test_route_audit,test_study_gate}.py
sim/{pyproject.toml,config.yaml}
sim/mutual_sim/{__init__,population,copresence,policies,behaviour,metrics,run,sweep,report}.py
sim/tests/{test_metrics,test_determinism,test_policies}.py
sim/results/report.md  sim/results/figures/            (generated)
app/{package.json,app.config.ts,tsconfig.json,eslint.config.js,jest.config.js,babel.config.js,metro.config.js}
app/app/...                                              (routes listed in §13.2)
app/src/api/client.ts
app/src/design/{tokens,typography,motion,theme}.ts(x)
app/src/components/{CrossingCard,VoicePlayer,VoiceRecorder,SignalSheet,SignalDots,GenerativeAvatar,RevealMoment,ChatBubble,IntentChip,EmptyState,PrivacyRow}.tsx
app/src/signals/{db,ttl,setBuilder,scheduler,upload}.ts
app/src/presence/{bleAdapter,nativeBle,fakeBle,dailyKeys,schedule,drain,upload}.ts
app/src/digest/{prefetch,cache}.ts
app/src/matches/resolve.ts
app/src/storage/{secure,localDb}.ts
app/modules/mutual-ble/                                  (Expo local module: index.ts, expo-module.config.json, android/…Kotlin)
app/scripts/{check-privacy-invariants,check-contrast}.ts
app/__tests__/                                           (jest tests for AC-T2-2)
docs/{THREAT_MODEL,SECURITY_ARGUMENT,E2E_CHECKLIST,BLE_SPIKE,INTERVIEW_QUESTIONS}.md
docs/design/prototype.html                               (approved visual reference, §13.9)
docs/design-decisions/                                   (generated walkthrough, Phase 13)
study/{PREREGISTRATION,CONSENT,PARTICIPANT_INFO,ETHICS_APPLICATION_DRAFT}.md       (Tier 3)
study/APPROVAL.md                                        (written by the human, only after approval)
study/analysis/{export,analyze,make_synthetic_export}.py  study/analysis/synthetic_export.csv
```

---

## 21. Decisions log (pre-resolved — change only via approval)

| # | Decision | Rationale |
|---|---|---|
| D1 | Android only, minSdk 31 | iOS background BLE advertising is too restricted for reliable phone-to-phone discovery without special entitlements; Android 12+ lets BLE scanning avoid location permission |
| D2 | No GPS, BLE only | Location is the most dangerous asset; BLE proximity is enough for "people you were near" |
| D3 | Next-morning digest, never live | Kills real-time tracking and "who is that person right now" harassment |
| D4 | Fixed-size padded signal set, once per epoch, random time in window | Makes volume and timing independent of interest (C1) |
| D5 | Server resolves crossings and learns the day-granularity crossing graph | The alternative — distributing daily keys so clients resolve locally — lets any user track anyone in real time with a BLE scanner. A bounded, time-limited graph on the server is the lesser risk |
| D6 | Intents are private and per-signal; never shown on profiles | Showing "open to dating" would reintroduce the signalling stigma the product removes |
| D7 | No swipe UI; prompt-first cards | Swiping rewards snap visual judgement — the behaviour that concentrates attention |
| D8 | Text answer required; voice optional | Accessibility (deaf and hard-of-hearing users) and lower barrier |
| D9 | Field pilot compares M vs C only; P is simulation-only | Showing photos at discovery to real users would break the product promise for everyone in that arm |
| D10 | No end-to-end encrypted chat in v1 | Reports need verifiable excerpts; E2E would need a separate reporting design. Stated limitation |
| D11 | Whole app 18+ | Removes the risk of minors in a co-presence app with a date intent |
| D12 | Emails stored only as HMAC | Data minimisation; honest about its limits (§9) |
| D13 | Matches delivered at the next release time | Removes timing correlation between an upload and a notification |
| D14 | 20-signal cap | Bounds the padded set, limits probing ("signal everyone to see who likes me") and discourages volume behaviour |
| D15 | Unmatch deletes the conversation (report excerpts kept) | Gives users a clean exit; preserves evidence when it matters |
| D16 | One account per verified college email | Sybil resistance without collecting ID documents |
| D17 | BLE company id 0xFFFF (SIG test id) | Free and acceptable for a prototype; must change before any public release |
| D18 | Ranking never uses signal, match or attention data | Impossible by design and must stay identical across reveal policies |
| D19 | The app's interface matches `docs/design/prototype.html` exactly (§13.9) | Interface quality is the human's top priority; approved 2026-10-05 |

---

## 22. Open questions for the human

Answer these by editing this section (and the config) before the phase that
needs them. The agent must not guess them.

- **Q1 (before Phase 3)** Which college email domain(s) are allowed?
- **Q2 (before Phase 3)** Confirm the timezone (`Asia/Kolkata`).
- **Q7 (resolved 2026-10-05)** Python version: 3.11 is used. On the
  development laptop it is provided by uv (`uv venv --seed --python 3.11`),
  because `py -3.11` does not find uv-managed interpreters.
- **Q3 (before Phase 9)** Do you have access to two physical Android 12+
  phones for the BLE spike? If not, Tier 2 ships with the fake adapter only and
  AC-T2-6 is deferred.
- **Q4 (before Phase 12)** Will you pursue the field pilot? Which ethics body
  approves research with students at your institution, and what is its
  timeline?
- **Q5 (before Phase 1)** Confirm the five intents and their names. They are
  protocol constants (§6.2); changing them later means a protocol version bump.
- **Q6 (before Phase 11)** Where will the server run for any demo with more
  than one phone (laptop on the same Wi-Fi is the default)?
