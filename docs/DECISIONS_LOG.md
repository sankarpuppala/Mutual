# Decisions log — Mutual

Every question asked, issue found, idea raised and decision made on this
project, in plain words, newest at the bottom. `SPEC.md` holds the rules
themselves; this file holds **how we got there**. Whenever Claude asks the
human a question or a review finds issues, an entry is added here in the same
session (`CLAUDE.md` §8).

Status words: **Adopted** (in the spec), **Rejected** (decided against, with
the reason), **Parked** (good idea, not now), **Open** (waiting for an answer).

---

## Board

### Open questions
| # | Question | Needed before |
|---|---|---|
| Q3 | Do you have two Android 12+ phones for the Bluetooth test? | Phase 9 |
| Q4 | Will you run the real-user pilot? Which ethics body approves it? | Phase 12 |
| Q6 | Where will the server run for a demo with more than one phone? | Phase 11 |
| Q8 | In a pilot, who has server (operator) access? They cannot also hold accounts. | Phase 12 |

### Parked ideas
| Idea | Why parked | Where |
|---|---|---|
| Run the UI work in parallel with the research core | The human chose to follow the plan order | PLAN.md deferred #2 |
| Make the AI ranking (`reciprocal_content`) a planned, evaluated deliverable | Strengthens the AI/data-science side; decide later | PLAN.md deferred #3 |
| Revisit the cream/terracotta colours | Judge on a real device first | PLAN.md deferred #4 |
| Say what happens when the 25 MB media prefetch cap is reached | Spec gap; must not depend on what the user looked at | PLAN.md deferred #5 |
| State that discovery needs many users at once | Honesty in the report | PLAN.md deferred #6 |
| "Hold" other date signals while a date mutual is active | Only useful if signals ever become scarce (allowance or subscription) | PLAN.md deferred #7 |
| Run PROMPT.md Prompt 1 (full spec interrogation) | Skipped to keep moving; protocol reviews were run instead | PLAN.md deferred #1 |

---

## 2026-10-05

### 1. First look at the project
- **What came up:** the four planning files describe Mutual, a campus app and
  research project: Bluetooth co-presence, private signals, photos only after
  a match.
- **Issues raised by Claude:**
  - the interface (the human's top priority) comes last in the plan;
  - "like Hinge" conflicts with "no photos before a match";
  - Node.js and Android Studio were missing;
  - the app only works when many students use it;
  - the AI part is thin for an AI & Data Science project.
- **Decision:** keep the no-photo rule. Get the Hinge feel from prompts, type
  and voice notes. A clickable interface prototype was built first.

### 2. Interface prototype — Adopted (D19, SPEC §13.9)
- **Human:** "looks so good … make it exactly the same, changes at the end."
- **Decision:** `docs/design/prototype.html` is the approved look, and the app
  must match it exactly. Extras that came with it became part of the spec:
  profile screen, "Not for me" (on the phone only), "Your turn", and the
  prompt shown at the top of a chat.

### 3. Setup choices (Phase 0)
- **Adopted:**
  - the repository is the project folder itself;
  - Python 3.11 comes from uv (`py -3.11` cannot find it, Q7);
  - Node 24 LTS was installed with winget;
  - files keep LF line endings so test vectors stay byte-identical;
  - `prompt.md` is kept out of git.

### 4. The five reasons (intents) — Adopted (Q5)
- **Human:** study, project, fitness, friend, date: "that's all I can think of".

### 5. First security review of the protocol (15 findings) — Adopted (SPEC v1.2)
An independent reviewer saw only the protocol sections and attacked them.

| Finding | Plain words | Decision |
|---|---|---|
| F1 (critical) | A hacked app could see a match first, then block, so the other person never learned of it | **Adopted:** one nightly matching batch; nothing visible before 8 am; an "ended" mutual stays visible to both |
| F3, F6, F7 | The server got daily keys and could rebuild who was near whom every 15 minutes | **Adopted (human chose 1a):** phones upload only crossing fingerprints, never keys |
| F4 | IP addresses reveal which building you are in | **Adopted:** the server never logs IPs |
| F5 | Copying someone's public key could redirect their signals | **Adopted:** account ids are bound into the pair key; keys must be valid and unique |
| F2 | Ticking all five reasons reveals which one the other person picked | **Adopted** after F1: a match only shows what both chose, which is symmetric |
| F8–F15 | Wording of claims, a digest that changes during the day, responses that reveal accounts, small gaps | **Adopted** |
| F9 (part) | End-to-end encrypted chat | **Rejected:** conflicts with D10 (reports need readable excerpts) |
| F2 (part) | Show each person the other's full signal set | **Rejected:** it would leak one-sided reasons |

### 6. Limit on dating signals — Adopted, then removed (D20)
- **Human idea 1:** date is one person at a time; the other reasons are
  unlimited; slots free instantly. Adopted, and built into the prototype.
- **Human idea 2:** unlimited date signals, but hold the others once a date
  matches, "since they used their daily limit or paid".
- **Claude's view:** the hold idea is safe for privacy, but signals here are
  free and can be withdrawn at any time, so there is nothing to protect. Any
  limit could only be enforced by the app.
- **Decision:** remove per-reason limits entirely for simplicity. The hold
  idea is parked.

### 7. Withdrawing a signal — Adopted (§6.10, §13.6)
- **Human:** "the effect should be immediate".
- **Decision:** a withdrawal is instant on the phone, and the slot frees at
  once. One exception: if tonight's batch has already been sent, that one can
  still match tonight, and the app says so. A "cancel" message to the server
  would itself reveal the signal, so it is not possible.

### 8. Standing permission for security fixes
- **Human:** "approve everything on your own for … attacks and defenses."
- **Decision:** Claude applies pure security fixes without asking and records
  them here. Anything users see, ethics, irreversible actions and git commits
  still go to the human.

### 9. Second security review (12 findings on the new designs) — Adopted (SPEC v1.3)

| Finding | Plain words | Decision |
|---|---|---|
| N1 (critical) | The v1.2 crossing fingerprint could be computed by anyone who overheard both phones. Hidden receivers plus an account would let someone forge crossings and track people | **Adopted:** phones broadcast one-time public keys; fingerprints are keyed with a secret only the two phones share |
| N1 cost | The broadcast grows to 35 bytes, more than classic Bluetooth carries | **Adopted with a check (D23):** the Phase 9 phone test decides the layout; if neither works, the human decides about the v1.0 fallback |
| N2 | The server could see groups and how long people stayed | **Adopted:** no durations are uploaded; one token per crossing is kept; the spec admits the day's crossing graph is visible |
| N6 | Several broadcasting gadgets could turn a walk-past into a crossing | **Adopted:** dwell is judged per single sighting, never summed |
| N3, N8 | A key change, or a withdrawal after upload, could make one side miss a real match | **Adopted:** the phone verifies against the keys and tokens it actually used |
| N4 | Deleting your account right after a match erased it for the other side | **Adopted:** it becomes "ended", with a frozen minimal card |
| N5, N7 | A new shared reason, or a night-time block, could reveal a match early | **Adopted:** each reason gets its own 8 am release; blocks act at release |
| N9 | The digest gave exact times to a hacked app | **Adopted:** one token per person |
| N10 | An "ended" mutual tells the other side who ended it, and invites revenge reports | **Adopted:** documented; such reports are flagged for review |
| N11, N12 | Midnight disagreements, no upload cap, wording contradictions | **Adopted:** ignore the first and last 15 minutes of each day; max 1024 entries; wording fixed |

### 10. Phase 1 implementation choices — Adopted
- `constants.json` is read in place, not copied, so no value is duplicated.
- One error type, `ProtocolError`, lives in `encoding.py`.
- `tests/test_constants.py` was added; it is not in the SPEC §20 list.
- Test vectors are written as hex, with 135 cases.
- `cryptography` is pinned to 50.0.2. It already refuses low-order keys, and
  we check anyway.

### 11. Phase 2 (TypeScript protocol) choices — Adopted
- **Human:** "continue phase 2". Phase 1 was committed (`39e7d21`) but not
  merged into `main`, so the Phase 2 branch starts from the Phase 1 branch.
  Merging is left to the human.
- **Libraries, pinned:** `@noble/curves` 2.4.0 and `@noble/hashes` 2.4.0
  (audited, free); `vitest` 5.0.3; TypeScript 7.0.2; `@types/node` 24.19.1
  for tests only.
- **Issue found while verifying:** noble accepts *non-canonical* public keys,
  such as one with the top bit set, and returns a secret where Python
  refuses. **Decision:** the TypeScript code runs our own key-validity check
  before every exchange, so both languages always agree. The shared
  `public_key_validity` vectors catch any drift.
- **Package shape:** ships its TypeScript source (no build step). The Expo
  app's bundler compiles it in Phase 8.
- **Hermes safety:** `src/` has no Node types, and a test scans `src/` for
  `Buffer`, Node modules, `require`, `Math.random` and `fetch`.
- **New guard:** a pre-commit hook re-runs the TypeScript suite whenever the
  protocol or its vectors change, so the two languages cannot silently
  drift apart.

### 12. Which colleges can join (Q1) and the timezone (Q2) — Adopted (SPEC v1.4, §4.1, D24)
- **Claude asked:** which college email domain(s) may sign up, and is the
  timezone Asia/Kolkata?
- **Human:** "can't we make it for all colleges, like we let people see only
  from their college", and "Kolkata".
- **Decision:**
  - One server hosts every college, and each college is a closed
    **campus**, decided by the email domain (`cse.iitb.ac.in` → IIT Bombay).
  - Nobody ever sees, crosses, signals or matches across colleges. Two
    students from different colleges in the same café: the server ignores
    the crossing and stores nothing.
  - New CLAUDE.md invariant 13: campus isolation.
- **Safety detail Claude decided** (the human can overrule):
  - `.ac.in`, `.edu.in` and `.edu` domains are recognised automatically, but
    a new college opens only after **one operator approval**
    (`admin campuses approve`).
  - Reason: some schools also use these suffixes, and the app is 18+ with a
    self-declared age.
  - Until a college is approved, its students see "Mutual isn't open at your
    college yet". The server keeps only the domain and an attempt count.
- **Options not taken:**
  - Admit every academic domain automatically (fastest, but school students
    could join).
  - A fixed hand-written list only (safest, but every college needs a code
    change).
- **Also:**
  - study mode now names the campus(es) it applies to;
  - a user's campus is fixed at sign-up;
  - "federation across several servers" stays out of scope.
- **Timezone:** Asia/Kolkata confirmed (Q2).

### 13. Phase 3 (server core) choices — Adopted
- **Human:** "merge it yourself" and "start". Claude fast-forwarded `main` to
  include Phases 1–2 and the college docs (no push; the human pushes to
  `origin`). Phase 3 runs on `phase-3-server-core`.
- **Login codes are hashed with a keyed hash (HMAC) under the server
  pepper,** not plain SHA-256. A 6-digit code hashed without a key can be
  brute-forced from a database dump in milliseconds. This is a security
  fix applied under the standing delegation.
- **Photos:** rotated by their EXIF orientation, then rebuilt from raw
  pixels, so no EXIF, GPS, XMP or colour-profile data can survive. They are
  shrunk to at most 1600 px and saved as JPEG at quality 85. A test uploads
  a photo with GPS and checks the stored bytes.
- **Voice notes:** the server reads the length from the M4A file's own
  header, using a small built-in reader. This avoids adding a GPL audio
  library. Over 30 seconds, or any video track, is refused.
- **Deleting an account** in Phase 3 signs you out everywhere and marks the
  account deleted. The full clean-up (rows, files, "ended" mutuals for the
  other person) comes in Phase 5, as planned. Until then the same email
  cannot sign up again; afterwards it can.
- **A rejected college** (operator said "no", for example a school) gets
  "use your college email".
- **Your own profile** comes back inside `GET /account/me`; the spec has no
  separate route for it.
- **Dev seeding** returns the synthetic users' keys and login tokens, so a
  developer can act as them. It exists only in dev mode.
- **Server start command:** `uvicorn … --factory --no-access-log`. The
  access log would record IP addresses (D22).
- **New guard:** a pre-commit hook now runs the server tests too.
- **Noted, not acted on:** Starlette warns that its test client prefers
  `httpx2`. We stay on the pinned `httpx` 0.28.1; revisit if it breaks.

### 14. Phase 4 (presence, digest, retention) choices — Adopted
- **Human:** "start phase 4". `main` fast-forwarded to Phase 3 (not pushed).
- **"Byte-identical until the next release" needs something to freeze.**
  SPEC describes the digest as a snapshot but doesn't name a storage
  mechanism. Claude added a new table, `digest_snapshots`, computed once
  (lazily, on first visit after a release) and never edited afterwards.
  Only the "snapshot" (which peers, in what order) is frozen; each peer's
  profile is still read live, so editing your prompts updates what others
  see on their next refresh without waiting for a release.
- **Two exclusion timings, read literally from §11:** the viewer's own
  blocks and a peer's suspension are checked live, every request, never
  baked in. A peer blocking the viewer, pausing, deleting their account, or
  matching the viewer only takes effect at the *next* release. Both are
  tested directly (flip a flag mid-window, confirm the digest does or
  doesn't change).
- **Crossing-token "poisoning".** If a third account ever uploads a token
  two others already share, the spec says it's ignored entirely. Claude's
  resolution service recomputes every pair that token touches from
  scratch, so a crossing already formed from that token is removed too —
  unless the same two people also share a different, still-clean token, in
  which case the crossing survives on that token instead. Tested directly.
- **Encounter tokens in tests are built with the real protocol**, not
  arbitrary random bytes, per CLAUDE.md §7 ("never mock the protocol
  package in server tests"). A new `make_shared_token()` helper in
  `conftest.py` generates two independent one-time keys and derives the
  token exactly as two real phones would.
- **GET /media serves only voice notes of peers currently in the digest.**
  Photos are never served through this route, even for a matched peer —
  pre-match this follows directly from "no photos before a match"; photo
  delivery after a match is Phase 5's `/matches/{id}/photos` route.
- **Retention runs at startup and every hour** via a background task
  started in the app's lifespan, with its own try/except so one failed
  sweep can never crash the server. It also now cleans up old digest
  snapshots (same 7-day bound as crossings), which the spec didn't name
  explicitly but follows from the same retention rule.

### 15. Phase 5 (signals, matching, reveal, chat, safety, privacy tests) — Adopted
- **Human:** "continue" / "start phase 5". `main` fast-forwarded to Phase 4
  (not pushed). Branch `phase-5-signals-matching`.
- **"Notified" is a real column, not a computed check.** A pending match
  token needs its blind-removal rule (block/unmatch/delete → drop silently)
  to run *exactly once*, the first time it's seen at or after its own
  `notify_after` — never again after that, or a block made days later would
  wrongly erase an already-delivered match. So `match_tokens.notified` is a
  permanent flag, flipped once, never re-checked. The same "materialize
  once, lazily" shape as Phase 4's digest snapshots.
- **The nightly batch and the release step aren't a cron job.** Like
  retention, they run as a background task every hour, and — more
  importantly — lazily, as a housekeeping step before every `/matches`,
  `/messages`, `/blocks` or `/reports` call. This was proven to work over
  real HTTP, not just direct function calls, in a smoke test: the dev clock
  was advanced and `GET /matches` alone brought a match into existence.
- **Account deletion's cascade uses the database's own foreign keys**, not
  hand-written cleanup: hard-deleting the `users` row cascades `profiles`,
  `media` rows (files removed first, explicitly), `presence_uploads`,
  `encounters`, `crossings`, `blocks` and `signal_uploads`/`epoch_tokens`
  automatically. `matches.user_lo`/`user_hi` are `SET NULL` instead of
  cascaded, which is also exactly the signal the release step already uses
  to detect "this account is gone" for a still-pending match — no special
  case needed.
- **A genuine edge case found while testing, not a bug:** once a match row
  exists — even pending, invisible via `GET /matches` — Phase 4's "matched
  the viewer" rule excludes that peer from any digest snapshot baked
  *after* the match forms. So blocking someone through the digest-window
  path, before their match is ever notified, only works if the viewer's
  digest was already cached *before* the match existed. Documented in SPEC
  §7.2 as a limitation rather than special-cased away.
- **The two privacy tests were written and run together with the
  implementation**, not strictly test-first with a separate commit in
  between, since this session builds a whole phase at once. The leak
  test's sensitivity was still verified directly: a deliberate one-line
  change (showing a match before its token was notified) was introduced,
  confirmed to make `test_leak_two_worlds.py` fail, then reverted — the
  check PROMPT.md's Phase 5 notes ask for, just performed via a throwaway
  edit instead of git history.
- **Worlds A/B/C use deterministic identity keys** (seeded from the account
  name via BLAKE2b), not the CSPRNG `generate_identity_keypair()` conftest
  normally uses, so the *only* difference between world dumps is the one
  under test — not incidental key randomness. CSPRNG-generated **signal
  padding** is left alone, since the test only compares token *counts* and
  *presence*, never byte values, there.
- **`unread` is tracked per (match, user)**, set to "now" on every
  `GET .../messages` call; a message is unread if it's from the other
  party and newer than that timestamp. A new table, `match_reads`.
- **`messages_needed_each`** is the configured threshold (8), not a
  countdown of messages remaining — the simpler of two readings, and the
  client already knows its own count.
- **Message rate limiting is per user, globally** (30/minute across all
  their matches), not per match — matches the plain reading of S3.
- **New config:** `reveal.ended_match_retention_days` (30), the fallback
  for an ended match's "fetched or 30 days pass" rule when the surviving
  party never reopens the app.
- **Not implemented this phase:** `reciprocal_content` ranking (explicitly
  deferred to Phase 11 by the plan) and the field-pilot "arms" scheduling
  logic beyond today's policy lookup (Tier 3, gated).

### 16. Phase 5 independent security review (Prompt 7) — Adopted
- **Reviewer saw:** the real server source under `server/`, plus CLAUDE.md
  §5 and SPEC §6–§9, §11 — not the conversation, not the spec's own
  framing of what it was supposed to find.
- **Verdict: every one of the 11 privacy invariants and C1–C5 holds.**
  Nothing above low severity. The one real tension it flagged — a pending,
  not-yet-notified match hides its own peer from later digests — is the
  same thing found and written into SPEC §7.2 while building Phase 5
  itself; the reviewer independently re-derived it rather than finding
  something new, which is itself a useful confirmation.
- **Three low-severity hardening items, all applied under the human's
  standing delegation for security fixes (no product/UX change):**
  1. A genuine race: two concurrent requests to the same check-then-insert
     route (signal upload, presence upload, the matching batch's own
     insert) could both pass the "does this exist" check and the second
     would hit a database uniqueness error — previously an unhandled 500.
     **Fix:** one new global handler in `errors.py` turns any such
     database conflict into the same documented `409`, never echoing the
     underlying write.
  2. `users.deleted_at` was dead code: three places still defensively
     checked it, but nothing had set it since account deletion became a
     true hard delete. A stale check like this is exactly the kind of
     thing that quietly stops meaning what it looks like it means.
     **Fix:** removed the column, the three checks, and switched its
     partial unique index to a plain one; migration `0004`.
  3. The chat rate limit (30 messages/minute) is also check-then-insert,
     so two messages sent in the same instant could both slip through.
     **Deferred, not fixed:** this is an abuse-surface nuisance, not a
     privacy leak, and a fully atomic fix needs a dedicated per-minute
     counter row, which is more machinery than the benefit justifies for
     a single-process research prototype. Parked in PLAN.md deferred list.
- **What the reviewer called out as well-built,** kept as-is: the two
  parallel-world leak test, the injectable clock making fair-delivery
  timing actually testable, rebuilding photos pixel-by-pixel rather than
  just stripping EXIF tags, the partial/unique indexes doing correctness
  work at the database level, never echoing submitted fields back in
  validation errors, and binding each OTP's hash to its own email hash so
  a stolen OTP can't be replayed against a different account.
