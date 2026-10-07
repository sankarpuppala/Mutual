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
| Q3 | Do you have two Android 12+ phones for the Bluetooth test? | Phase 9 — **answered 2026-10-07: yes, but it is the last thing to be done** |
| Q4 | Which ethics body approves research with students at your institution, and what is its timeline? **Only you can answer this**: it names a real committee, and invariant 9 turns on `study/APPROVAL.md` recording its actual reference. Nothing in this repository may stand in for it. | Phase 12 |
| Q6 | Where will the server run for a demo with more than one phone? | Phase 11 |

### Resolved since 2026-10-07
| # | Question | How it was settled |
|---|---|---|
| Q8 | Who holds operator access in a pilot? | The student and the supervisor, and **neither holds a participant account on that deployment**. A rule, not a fix — §7.2 says why no technical fix exists. In SPEC §19 and `study/ETHICS_APPLICATION_DRAFT.md` §6. |
| Q9 | Does declining consent mean not using Mutual at all? | **No, and that is now enforced.** `POST /account` creates the account either way; the consent screen offers "Use Mutual without taking part". Consent that is the price of using a campus social app is not freely given. SPEC §16. |
| Q10 | How to fix the legacy BLE split advertisement? | **Withdrawn, not fixed** (user's call, 2026-10-07: "most people use latest phones"). BLE 5 extended advertising is the only supported layout; a device without it is told so plainly. SPEC §14.2, D23. |
| Q11 | Should a missed presence-upload window cost a whole night? | Kept as specified — a missed window loses the night. The user read the trade and did not object. Revisit if the pilot's crossing counts come out low. SPEC §6.11. |
| Q12 | Daily keys in plaintext SQLite vs. the keystore | **SPEC §9 corrected to describe what the code does**, with the reasoning: device compromise is out of scope (§7.2) and SecureStore has no enumeration, so per-day keys would need a second index. The identity key stays in the keystore because it outlives every daily key. New SPEC §9.1. |

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

### 17. Phase 6 (simulation) — Adopted
- **Human:** "start phase 6". This phase touches only `sim/`, independent
  of the server; `main` fast-forwarded to Phase 5 (not pushed). Branch
  `phase-6-simulation`.
- **§15 describes the model at a level that leaves real implementation
  gaps** — not ambiguity about what a sentence means, but places where a
  working simulation needs a rule the spec doesn't state. Each one is
  resolved here, stated plainly (also in `sim/config.yaml`'s comments and
  the report's own methodology note), rather than silently assumed:
  - **Which of the five intents the model represents.** §15 never
    mentions intents after `date_openness_prob`, and the utility/reveal
    formulas (§15.3-§15.4) have no intent parameter at all. **Decision:**
    the simulation models the *date* channel only — the one reveal timing
    is centrally about. `date_open=false` agents never signal or are
    signalled on it, but still appear as crossing partners for everyone
    else (real co-presence, just not part of the measured dynamic).
  - **A pair that is both same-hostel and same-department** (§15.2 gives
    three weights for what reads as three exclusive cases). **Decision:**
    the hostel weight wins (`copresence.py`); stated in `config.yaml`.
  - **"progress", the fraction of `n_reveal` rounds completed at reveal**
    (§15.4). Re-read closely, this describes *one* reveal event per
    conversation, happening at a different day depending on policy — not a
    value that changes round by round. **Decision:** `progress = 0` for M
    and P (reveal with zero rounds elapsed), `progress = 1` for C (all
    `n_reveal` rounds elapsed) — a per-policy constant, in `policies.py`.
  - **"recent_matches" in the churn formula** (§15.5) has no defined
    window. **Decision:** matches formed in the trailing 7 days — the
    model's other natural time horizon (`interest_ttl_days` mirrors it),
    config key `recent_matches_window_days`.
  - **"Share of matches captured by the top decile of `a`"** (§15.6).
    **Decision:** the top 10% by attractiveness across the *whole*
    population (not just active agents) is the population-level
    reference group; a match counts if either participant is in it.
  - **"Share of conversations ending at reveal"** (§15.6) — ending
    relative to what denominator? **Decision:** of matches that *reached*
    a reveal check (excludes ones that faded via ordinary churn before
    ever getting there, which is a separate phenomenon from the
    reveal-driven drop-off the metric is named for).
  - **A match formed by two agents signalling each other for the first
    time on the very same day.** A naive single forward pass over agents
    could miss it (whoever is processed first can't yet see the other
    side's same-day decision). **Fix, not a modelling assumption:**
    signalling runs as two passes — decide, then check every new signal
    for reciprocity once the whole day's decisions are final.
- **Discovery, from yesterday's crossings only** (§15.3's literal
  "agent `i` sees up to `display_cap` of day `t`'s crossings" — no 7-day
  lookback window the way the real digest has one). Kept exactly as
  written; a documented simplification versus the real system.
- **Smoke-tested before the real run, per the plan's own instruction:** a
  2-seed run of the full main-experiment pipeline, then a tiny sweep grid,
  both producing a correct `report.md` with figures, before the real
  30-seed experiment and full sweep. No parameter was touched after either
  real run — both ran once, with the config as committed.
- **A genuine finding, not a modelling artefact (checked twice):** under
  policy P, the Gini of interest received is noticeably higher (0.664 vs.
  ~0.61 for M/C) and matches captured by the top attractiveness decile
  nearly double (0.312 vs. ~0.18) — concentration of attention tracking
  photo-at-discovery, as RQ2 asks about. Retention at day 56 is much lower
  under C (0.394 vs. ~0.69), consistent with accumulated frustration from
  not seeing faces. The sweep shows these rankings are not universal: at
  `beta_a_over_beta_c=0` (attractiveness carries no weight at all), P's
  advantage disappears, which is the expected null case, not a bug.
- **Not implemented, out of this phase's scope:** the field-pilot's own
  switchback scheduling (Tier 3, gated) and `reciprocal_content` ranking
  (Phase 11) — unrelated to this simulation.

### 18. Phase 7 (Tier 1 documents) — Adopted

- **The costs in AC-T1-8 had to come from somewhere real.** The plan says
  "compute them from real uploads in a test or script, not by hand".
  **Decision:** a new test module, `server/tests/test_costs.py`, that sends
  genuine signal and presence uploads through the real app and measures the
  bytes the server received, then computes the latencies from the configured
  schedule using the same clock helpers the server uses.
- **The document could still drift from the code.** A number written into
  `docs/SECURITY_ARGUMENT.md` by hand is correct on the day it is written and
  wrong the first time anyone changes the padding or the schedule.
  **Decision:** the document carries a fenced `measured-costs` block, and
  `test_security_argument_records_the_measured_costs` asserts that the block
  equals a fresh measurement. Change the config and the test fails with the
  new numbers in the message. The acceptance criterion now enforces itself.
- **`server/tests/test_costs.py` was not in `SPEC.md` §20's file list.** §20
  enumerates test modules explicitly, and this one is new.
  **Decision:** added to §20 in the same change. This is a documentation sync
  (the plan already authorised the file), not a behavioural spec change.
- **Measured, so recorded here too:** a signal upload is 932 bytes of request
  body, every day, whether the user signalled nobody or twenty people. A
  presence upload is 11,792 bytes for a quiet day and 23,568 for a very
  social one — and 1 sighting costs *exactly* the same as 50, which is the
  padding doing its job. Worst-case match latency is 38 hours from tap to
  both sides being told; 24 hours is the typical path from digest to
  notification.
- **The 38-hour figure needed a definition.** "Worst-case match latency" is
  ambiguous between several start points. **Decision:** measured from the
  moment a user taps a signal, with the worst case being a tap that lands a
  moment after that epoch's single upload has already gone out — so the
  signal waits for the next night's upload, that night's batch and the
  following morning's release. Two companion figures are reported beside it
  (digest-to-notification, crossing-to-notification) so the number cannot be
  quoted out of context.
- **RQ4 is the section that cost the most thought.** It names what the
  privacy design makes *impossible*: interest-trained recommendation,
  measuring one-sided attention at all (including for this project's own
  research — which is exactly why the simulation exists), real-time
  discovery, the whole category of engagement mechanics, and third-party
  analytics. One distinction is drawn explicitly: friend-of-friend
  suggestions from the crossing graph are excluded by *product decision*,
  not by the protocol, so a future operator could reverse them — an argument
  for keeping crossing retention short.
- **Determinism re-checked while verifying AC-T1-9:** re-running the 30-seed
  main experiment reproduced `main_experiment.csv` with zero content
  differences (8.4 s this time versus 10.2 s before — wall-clock only). The
  committed results were restored rather than re-running the 7.7-minute
  sweep for a runtime line.
- **Deviation from the plan, recorded:** Prompt 9 (the design-decision
  walkthrough and interview questions, Phase 13) is specified to run once
  after Phase 7 and again after Phase 11. It is being run **once, at the
  end**, covering both tiers, because this session continues straight through
  Tier 2 and a mid-way walkthrough would be rewritten in full a few hours
  later.

### 19. Phase 8 (app foundation) — Adopted

- **Version pins, verified against the installed SDK** (PLAN.md's ⚠ verify item):
  Expo SDK **57.0.26**, React Native **0.86.3**, React **19.2.3**, Node 24.19.0.
  The two packages SPEC §13.1 said to check by name resolved to **`expo-audio`**
  (not the old `expo-av`) and **`expo-background-task`** (not
  `expo-background-fetch`). Also added: `expo-screen-capture` for the Reveal
  moment's `FLAG_SECURE`, `expo-system-ui` (Expo asks for it before it will
  honour `userInterfaceStyle`), and `expo-build-properties` to pin minSdk 31.
- **A real privacy bug, found and fixed, not noticed later.** Expo's
  `android.permissions` list can only name a permission; it cannot attach
  `usesPermissionFlags="neverForLocation"`. The first prebuild therefore
  produced a manifest with a bare `BLUETOOTH_SCAN` — which Android treats as a
  possible location inference and which would eventually have pushed someone
  toward adding a location permission, the one thing invariant 3 forbids
  absolutely. **Fix:** a local Expo config plugin,
  `app/plugins/withBleNeverForLocation.js`, that edits the manifest directly.
  It also strips `SYSTEM_ALERT_WINDOW`, which `expo-dev-client` adds for its
  dev menu overlay and which has no business in anything a participant
  installs. Applied without asking, per the human's standing security
  delegation (2026-10-05), and logged here as that delegation requires.
- **The privacy check was initially wrong in a way that mattered.** Expo
  implements `blockedPermissions` by *declaring* the permission with
  `tools:node="remove"`, so a naive substring search for
  `ACCESS_FINE_LOCATION` fails on a correct manifest. **Fix:**
  `check-privacy-invariants.ts` now parses each `<uses-permission>` element and
  treats a `tools:node="remove"` declaration as the removal it is; it prefers
  Gradle's merged manifest when a build has produced one, and holds it to the
  stricter rule that the name must be absent entirely.
- **A TypeScript version clash broke eslint.** `packages/protocol-ts` pins
  TypeScript 7.0.2, which npm hoisted to the repo root; `@typescript-eslint`'s
  `ts-api-utils` cannot read TypeScript 7's AST and crashed on every lint run.
  **Fix:** TypeScript ~6.0.3 is now a root devDependency (so tooling resolves
  it), leaving 7.0.2 nested under `packages/protocol-ts` for its own typecheck.
  Both suites still pass. No source change was needed.
- **`app.json` kept coming back.** `expo install` writes autolinked config
  plugins into `app.json`, and `app.config.ts` spreading `...config` then
  replacing `plugins` silently discarded them — a trap for the next person who
  runs `expo install`. **Decision:** `app.config.ts` merges the two lists, ours
  winning on configuration, and `app.json` stays in the repo as the file Expo
  maintains.
- **Two files added to SPEC §20 that the spec had not anticipated:**
  `app/src/design/primitives.tsx` (Screen, AppText, Button, Card and the rest —
  without it, each screen would re-derive the prototype's spacing and type by
  hand and drift) and `app/src/design/icons.tsx` (the prototype's icon paths
  transcribed exactly, rather than a lookalike icon library). Also
  `app/src/dev/protocolSelfTest.ts` and the config plugin above.
- **Design tokens are taken from the prototype, not re-invented.** Every value
  in `tokens.ts` traces to a CSS rule in `docs/design/prototype.html`, and the
  type styles in `typography.ts` are named after the prototype's own classes
  (`.h-title`, `.a`, `.q`, `.reassure`) so the two can be compared line by
  line. Sizes the prototype uses that fall between SPEC §13.4's scale steps
  (42, 38, 30, 27, 26, 23, 19 pt) are collected in a `displaySize` map with
  the element each one came from, rather than written inline — which keeps the
  no-magic-numbers lint rule honest instead of making it a fiction.
- **Contrast measured, not assumed:** 20 text/background pairs x 2 themes all
  pass WCAG AA. The tightest is `signal` on `bg` in light mode at 4.48:1,
  which is why that colour is only ever used for large display text (the
  italic word in the welcome title) or as a fill behind `onSignal`, never as
  body text. No token needed changing.
- **Deliberately not done in this phase:** the real screens. Phase 8's job per
  the plan is the foundation, so the 17 route files are honest placeholders
  that already use the design system; the privacy screen and the dev panel are
  the two exceptions, built in full because their content is final.
- **Blocked, and the reason recorded rather than worked around:**
  `npx expo run:android` (AC-T2-1's build half) cannot run on this laptop yet
  — there is no JDK and no Android SDK installed. Everything that does not need
  them passes: lint, typecheck, 24 jest tests, both privacy scripts, and a
  successful `expo prebuild` producing the manifest the privacy check verifies.

### 20. Phase 9b (native BLE module) — Adopted, with one honest gap

- **Phase 9a could not be run.** It needs two physical Android 12+ phones
  (open question Q3) and a working Android toolchain; this laptop has neither
  yet. **Decision:** write Phase 9b's module in full, implementing *both*
  advertisement layouts so whichever the spike turns out to support is already
  there, and write `docs/BLE_SPIKE.md` as a complete measurement protocol with
  **every results table left blank**. A guessed detection rate would be worse
  than no detection rate: it would make AC-T2-6 look satisfied when nothing
  has been measured.
- **The module reports what it achieved rather than what it attempted.**
  `BleRadio` tries BLE 5 extended advertising first, falls back to the legacy
  split (advertisement carries `EID[0:24]`, scan response carries
  `EID[24:32]`), and resolves to `UNSUPPORTED` if neither starts.
  `NativeBle.status()` then refuses to report `advertising: true` when the
  layout is `UNSUPPORTED`, even though the service is running — so the app
  cannot tell a user discovery is on when nothing is on air.
- **One count per peer per scan window, not per packet.** A phone emits many
  advertisements inside an 8-second window. Counting packets would inflate
  `windows` and let a brush-past clear the dwell threshold, which is exactly
  what the threshold exists to prevent. `BleRadio` keeps a per-window set of
  peers heard and counts each once.
- **The midnight rule lives in the store, not in the caller.**
  `SightingStore.addWindow` silently drops intervals 0 and 95 (SPEC §6.13), so
  no future caller can forget it. The alternative — checking at each call site
  — is the kind of rule that holds until someone adds a second call site.
- **`drain()` clears what it returns, as a contract rather than a convention.**
  Documented on both sides and asserted in the fake adapter's tests. A drain
  that returned without clearing would leave raw (own EID, heard EID, windows)
  rows on the device after the upload, which SPEC §14.4 forbids.
- **The wrapper refuses a location permission at runtime, not only at build
  time.** `NativeBle.requestPermissions()` compares the native module's
  requested list against the three location permissions and *throws* rather
  than requesting them. That is a third layer after `blockedPermissions` and
  the manifest check: the one that would catch a future dependency widening
  the list. Tested.
- **A stray native field cannot reach the upload path.** `drain()` copies the
  five allowed fields explicitly instead of spreading the native object, and a
  test feeds it an extra `rssi` field to prove it is dropped. Without that, a
  future native change could carry RSSI or a timestamp into
  `src/presence/upload.ts` and break invariant 3 invisibly.
- **`SYSTEM_ALERT_WINDOW` and the foreground-service type were checked against
  current Android rules**, as PLAN.md's verify item for this phase asks:
  Android 14+ requires a declared `foregroundServiceType`, and
  `connectedDevice` plus `FOREGROUND_SERVICE_CONNECTED_DEVICE` is the correct
  pair for Bluetooth work. `POST_NOTIFICATIONS` is requested alongside the
  Bluetooth permissions because the service cannot run without its
  notification on Android 13+.
- **Not verified, and recorded as not verified:** the Kotlin has never been
  compiled, because there is no Android SDK or JDK on this machine. It is
  reviewed code, not working code, until Phase 9a runs. The TypeScript wrapper
  *is* tested (10 tests).

### 21. Phase 10 (onboarding and profile) — Adopted

- **The consent screen exposed a real ethics question, which is being raised
  rather than quietly resolved.** The server refuses to create an account on a
  study campus without a `consent_version` (`POST /account` → 422
  `consent_required`), because the reveal policy being studied changes for the
  whole campus at once. So on a study campus, declining to take part means not
  being able to use Mutual at all. **Open question for the human (ethics, not
  engineering):** is that acceptable to the approving body, or does the design
  need a non-participating mode? The screen now says the position plainly and
  offers "Not now" (which creates nothing) instead of a fake opt-out link that
  would have failed with a server error. Added to the Board at the top of this file as Q9.
- **The consent step had to move.** SPEC §13.2 lists it in the onboarding
  group but not in an order, and it has to come *before* `POST /account`
  because that is the request carrying `consent_version`. **Decision:** the
  code step always routes to the consent screen, which checks
  `GET /config.study_enabled` and forwards straight to the age check when no
  study is running. That keeps the gate in one place instead of duplicating
  the study check in two screens.
- **Identity key generation is idempotent on purpose.** `ensureIdentity()`
  returns the existing key if there is one. Onboarding can be interrupted
  (a code that arrives late, a backgrounded app), and generating a second
  keypair after the first was registered would silently invalidate every token
  the device had built — a failure that produces no error, just matches that
  never happen. Tested.
- **The generated public key is validated before being stored**, even though
  X25519 generation cannot produce a low-order point. Storing first and
  discovering the server rejects it later would leave the device holding a key
  it can never use, with no way to tell.
- **The date of birth and the email live in memory only.** The onboarding store
  is plain Zustand with no persistence middleware, and the file says why: both
  are things invariant 5 forbids keeping. A future "resume where you left off"
  feature would have to persist everything *except* those two fields, so the
  reason is written next to the state rather than left to be rediscovered.
- **Validation lives in pure functions, not in the screens.**
  `src/onboarding/store.ts` exports `validateEmail`, `validateDateOfBirth`,
  `validatePrompts` and the rest, which is what let the age rule be tested at
  the boundary: someone who turns 18 today is accepted, someone who turns 18
  tomorrow is not. Calendar arithmetic, not days divided by 365.25.
- **Email validation deliberately stops at the shape of the address.** Only
  the server knows which domains map to an open campus (SPEC §4.1), so
  checking the domain here would either duplicate that list or reject valid
  addresses. The screen explains the three server answers
  (`not_a_college_email`, `campus_not_open`, and a code on its way) in plainer
  words than the API does.
- **The avatar palette moved into `tokens.ts`, because the lint rule was
  right.** Twelve hex literals in `GenerativeAvatar.tsx` tripped the
  no-raw-colours rule. They are design tokens, so they now live with the other
  tokens — annotated as deliberately theme-independent, since a person's
  avatar changing colour when the phone switches to dark mode would make it
  useless as a way to recognise someone.
- **The avatar hashes with BLAKE2b, not the prototype's FNV.** SPEC §13.5 asks
  for BLAKE2b of `identity_pk`; the prototype's 32-bit FNV hash is fine for a
  browser mock but collides often enough that two people on one campus would
  share a blob. The palette and the blob construction are the prototype's,
  unchanged. A malformed key still renders something, because a blank avatar
  would show which rows are malformed.
- **A voice answer never replaces a written one** (decision D8), so
  `VoiceRecorder` is always rendered beneath a filled text field and says so in
  its own helper text. It also stops itself at 30 seconds rather than letting
  someone record for a minute and then rejecting the file.
- **`VoicePlayer` cannot reach the network, structurally.** It takes a local
  file URI and renders nothing playable when that URI is null. A fetch at the
  moment someone pressed play would tell the server which card they were
  interested in — the exact leak invariant 1 exists to prevent — so the
  component has no way to ask for the file.
- **New files, added to SPEC §20 in the same change:**
  `app/src/api/types.ts`, `app/src/api/endpoints.ts`,
  `app/src/onboarding/store.ts`, `app/src/onboarding/identity.ts`.
  `types.ts` was written against `server/mutual_server/schemas.py` field by
  field, which caught four places where the client's first guess was wrong
  (`AccountMe.profile` is nested and nullable; the prompt library is
  `{looking_for, prompts:[{id, text, kind}]}`; a message carries `sender_id`
  and `created_at`, not `from_me`; and `ReportReason` has six values, not the
  five guessed).

### 22. Phase 11 (core loop) — Adopted

- **Logic and tests before UI, as the plan insists**, and it paid for itself:
  the signal, presence, digest and match modules were written and tested
  (105 new tests) before a single screen, which is why the screens are thin.
- **A real privacy bug caught while building the Signals tab.** The first
  version showed `peerId.slice(0, 8)` as the name, because the local signal
  store had no name in it. The obvious fix — fetch the peer's profile — would
  have been a **per-peer request triggered by opening a tab**, i.e. a direct
  breach of invariant 1, and there is no such endpoint anyway (invariant 10).
  **Fix:** the peer's first name and identity key are copied from the digest
  card at the moment the signal is made and stored beside it. The Signals tab
  now needs no network at all.
- **A test that was passing for the wrong reason.** The presence test asserted
  that the upload body did not match `/interval|window|rssi|dbm|time|minute/i`.
  It failed intermittently — because the padding is random base64url and can
  contain any letter sequence by chance. The check was unsound, not flaky.
  **Fix:** assert the structure instead (exactly one field; every entry an
  opaque 32-byte string; no nested objects), which is the real property, and
  say in the test why the substring search was wrong.
- **Two copies of React broke every rendering test.** `react@19.2.3` nested
  under `app/` and `react@19.3.0` hoisted at the root, so the test renderer
  resolved a different copy than the components did and every hook threw.
  **Fix:** `react` is a root devDependency pinned to Expo SDK 57's version, so
  one copy is hoisted and every workspace resolves it. (An `overrides` entry
  was tried first; npm refuses to have both an override and a direct
  dependency on the same package.)
- **`expo-file-system`'s API changed in SDK 54+**: `documentDirectory` and
  `writeAsStringAsync` are gone in favour of `File`/`Directory`/`Paths`. The
  media cache was rewritten against the new API, which is also better here --
  `Uint8Array` goes straight to `write()` with no base64 round trip.
- **What happens at the media prefetch cap** was a documented spec gap
  (PLAN.md deferred item 5). **Decision:** items are dropped **from the end of
  the digest's own order**, never by what the user has looked at, so the set
  fetched still depends only on the digest. Any other rule (most recent first,
  smallest first, the ones the user opened) either changes nothing or breaks
  invariant 1. Written into `prefetch.ts` with the reasoning.
- **Match resolution reports what it cannot explain.** A matched token this
  device has no record of uploading is returned as `unverified`, never
  displayed as a default intent. The honest case does happen -- a reinstall
  loses `sent_tokens` -- and showing "study" for what was really a date signal
  would be worse than showing nothing. A token recorded against a *different*
  peer is also refused.
- **`decide()` distinguishes "wait" from "skip"**, and the difference matters:
  past the batch time the epoch is gone, and a caller that treated a closed
  window as a retryable failure would keep trying -- which the server rejects
  and which is itself evidence that something was pending.
- **The background task does not aim at a minute.** Android coalesces
  background work and will not honour "at 21:47". The task wakes periodically
  and the scheduler decides on each wake whether this is the chosen minute. The
  random minute is the privacy property; the wake cadence is just how often the
  device gets a chance to notice.
- **Chat polls instead of using a socket**, and has no typing indicator or read
  receipt. A held socket's timing reflects attention; a five-second poll is
  indistinguishable from idle traffic.
- **The photo endpoint is loaded by the image pipeline, not `api/client.ts`.**
  `src/matches/photo.ts` builds an `Image` source with the bearer token as a
  header. Routing megabytes of JPEG through a JSON client would be worse on
  both memory and caching, and it does not weaken invariant 1: that invariant
  governs traffic **before a match exists**, and these requests happen only
  inside a notified, revealed match where both parties already know about each
  other. Noted in the file so the exception is explicit rather than silent.
- **Not implemented, and recorded as not implemented:** PLAN.md Phase 11 task 8
  (`reciprocal_content` ranking on the server) is marked optional there and
  parked on the decisions Board; Tier 1's default `random` ranking is what runs.
- **New files added to SPEC §20 in the same change:**
  `app/src/digest/useDigest.ts`, `app/src/matches/photo.ts`,
  `app/src/components/SafetySheet.tsx`.
- **The jest SQLite mock is a real engine.** `__tests__/support/sqliteMock.ts`
  implements expo-sqlite over Node 24's built-in `node:sqlite`, with real
  BEGIN/COMMIT/ROLLBACK. The local database's rules are written *in SQL*
  (`INSERT OR IGNORE` for the TTL anchor, `ON CONFLICT ... MAX(windows)` for
  merged drains, `PRAGMA user_version` for migrations), and a hand-written fake
  would have let every one of them be wrong while the tests passed.
- **The independent security review (Prompt 7) could not be completed.** The
  subagent hit the account's session rate limit partway through and was
  terminated. An inline review was done instead, and it is weaker evidence than
  an independent one: it should be re-run as a fresh subagent before Tier 2 is
  presented.

### 23. Phase 12 (field pilot package) — Adopted, deliberately incomplete

- **One file was not written, on purpose.** `study/analysis/export.py` reads
  the real database. `CLAUDE.md` invariant 9 forbids writing code that exports
  real-user data for analysis unless `study.approval_reference` is set and
  `study/APPROVAL.md` exists, and neither is true. PLAN.md Phase 12 lists it as
  a task, but every task in that phase is gated by the phase's own precondition
  (written approval), so **not writing it is following the plan, not deviating
  from it**. `study/PREREGISTRATION.md` §10 records what is missing and why.
  Everything the invariant permits — the synthetic generator and the full
  analysis pipeline — is built and runs.
- **`study/APPROVAL.md` was not created either.** SPEC §20 marks it "written by
  the human, only after approval". Creating even a template would make the
  server's study gate start passing its file-exists check, which is the
  mechanism that stops a study running without approval. Left absent.
- **The synthetic generator builds in an effect on purpose, and says so
  loudly.** `make_synthetic_export.py` produces data where C has lower match
  concentration and fewer unmatches-after-reveal, so the analysis has something
  to find and the code paths are exercised. Every table `analyze.py` prints
  from it is headed with "SYNTHETIC DATA. Every number below is invented." and
  footed with a reminder. The risk being managed is obvious: a pipeline test
  whose output looks like a result is one copy-paste away from being quoted.
- **The analysis prints the pre-registered outcome number beside every table.**
  Eight tables, each labelled with the numbered outcome in
  `PREREGISTRATION.md` §5 it implements. The temptation in a small pilot is to
  go looking, find something, and present it as the plan; printing the mapping
  makes an unregistered table visibly out of place.
- **No p-values anywhere, by design.** The pre-registration says intervals
  only, because a pilot of tens of participants cannot support a decision rule.
  `analyze.py` does not compute one, so there is nothing to be tempted by.
- **The mixed-effects model declines rather than overreaching.** It refuses to
  fit below 30 revealed matches and says so as a pre-registered limitation. An
  estimate from 12 matches would be worse than no estimate.
- **A real environment limitation, recorded rather than worked around.** The
  model could not run on this laptop: `scipy`'s compiled `_alternative` module
  is blocked by the machine's Windows Application Control policy
  (`DLL load failed ... An Application Control policy has blocked this file`).
  `analyze.py` now distinguishes an ImportError from a convergence failure and
  reports it as an environment problem, not a null result. The eight
  descriptive tables are unaffected, so **AC-T3-3 passes**; the model is step 3
  of the analysis, not a table.
- **`statsmodels` is declared in `study/analysis/requirements.txt`** rather than
  added to `sim`'s dependencies, because it belongs to the study and nothing
  else needs it. Added to SPEC §20.
- **A GEE with an exchangeable correlation per participant, not a full GLMM.**
  One participant contributes several matches, so the uncertainty has to
  account for clustering. On pilot-sized binary data a full random-intercept
  GLMM frequently fails to converge; a binomial GEE grouped by participant is
  the estimator that reliably fits the same question. Named in the code so the
  substitution is visible.
- **The consent form and the in-app consent screen are kept deliberately
  redundant**, and the form says which one wins: "If the two ever disagree, the
  form is what the participant agreed to and the screen is the bug."
- **The ethics draft volunteers its own weakest point.** §4.2 names the
  voluntariness problem (on a study campus, declining consent means not using
  the app at all — open question Q9), says why the design causes it, and
  proposes a concrete remedy if the committee finds it unacceptable: shorten
  the pilot to a single policy period and lose the within-campus comparison.
  Raising it rather than hoping it is not noticed is the point.
- **Housekeeping note:** the four study Markdown files were written before the
  Phase 11 commit and were swept into it by `git add -A`. The content is
  unchanged; only the commit they landed in is wrong. Not rewritten, since
  rewriting shared history is worse than an untidy attribution
  (`CLAUDE.md` §9).

### 24. Phase 13 (close the loop) — Adopted

- **Run once, at the end, covering both tiers.** PLAN.md specifies Prompt 9
  after Phase 7 and again after Phase 11. Running it twice in one continuous
  session would have meant writing a Tier 1 walkthrough and rewriting it in
  full a few hours later. Recorded as a deviation in the Phase 7 progress-log
  entry when the decision was made, not retrospectively.
- **The walkthrough has a page for disagreements, and it is not empty.**
  `docs/design-decisions/09-spec-drift.md` lists thirteen items: two fixed in
  the same commit, eight spec gaps resolved by documented decisions, two left
  deliberately open, and a short list of things that look like drift and are
  not. PLAN.md's own instruction for this prompt is that "an agent's
  explanation of its own choices can be fluent and wrong", so the page is
  written to be checkable rather than reassuring.
- **Two genuine spec/code divergences were found by writing the walkthrough,**
  which is the best argument for doing it at all:
  1. `GET /config` returns `match_batch_time`, which SPEC §11's prose did not
     list. The app needs it — hard-coding 23:45 would break when the server's
     config changed — so the code was right and the prose was incomplete.
     **Fixed in SPEC §11.**
  2. SPEC §13.4's type scale (12/14/16/18/22/28/36) is not the scale the app
     uses: the approved prototype uses eleven intermediate display sizes, and
     §13.9 makes the prototype authoritative on look and feel. So the spec
     resolves its own conflict — but it is named, because "no magic numbers in
     components" would otherwise be a fiction. The intermediate sizes live in a
     `displaySize` map, each annotated with the prototype class it came from.
- **`docs/INTERVIEW_QUESTIONS.md` contains no answers**, as the prompt
  requires, and says why: an examiner's second question goes somewhere a
  memorised answer does not reach. Each question carries a pointer to the
  section to re-read instead. Three extra questions are listed at the end as
  ones to expect — including "would anyone actually use this?", whose honest
  answer is that nobody knows and which pre-registered outcome is meant to find
  out.

### 25. Security review of the app, and the first real Android build — Adopted

**How the review was done, and why that matters.** Prompt 7 asks for an
independent subagent with no knowledge of the conversation. It was launched and
**terminated partway through** by the account's session rate limit. Rather than
claim a review that did not happen, an inline audit was run instead: targeted
searches for each specific failure mode rather than a reading of the comments,
which is the part that can be done honestly without independence. It is
**weaker evidence than an independent review**, and re-running Prompt 7 is on
the Phase 11 human review checklist.

**What the audit checked, and found clean:**

- no `console.*` anywhere in `app/src`, `app/app` or the Kotlin — so no per-user
  activity reaches a device log;
- no `Math.random()` outside comments explaining why it is forbidden;
- no bare `fetch(` outside `src/api/client.ts` (every other hit is TanStack
  Query's `refetch`);
- no daily key, ephemeral id, RSSI value, window count or interval appears
  anywhere in `src/api/`;
- no intent appears in any path, query or header in `src/api/endpoints.ts`;
- in Kotlin, RSSI is only ever compared against a threshold
  (`BleRadio.kt:238`) and never stored — `SightingStore` has no field for it,
  and no timestamp either;
- no cryptography in Kotlin at all, as invariant 7 requires;
- secure storage holds exactly four keys (session token, identity private and
  public key, user id). The onboarding store is plain Zustand with no
  persistence middleware, so the email address and date of birth live in memory
  only; `localDb` has no column for either.

**Two real findings, both fixed under the standing security delegation:**

1. **Opening a profile card could have issued a `GET /digest`.** The query
   client's `staleTime` was 60 seconds. Opening a card more than a minute after
   the digest was fetched would remount `useQuery(['digest'])` with stale data,
   and TanStack Query would refetch. The request would not say *which* card was
   opened — but its existence and timing would depend on a card having been
   opened, and invariant 1 forbids a request whose "existence, timing, size,
   order or parameters" depend on which profile a user viewed. A timing channel
   keyed to attention, created by an ordinary caching default.
   **Fix:** `staleTime: Infinity` with `refetchOnMount: false`. Nothing is lost
   — the digest is byte-identical between release times by design (claim C5),
   so an intra-day refetch cannot return anything new. Screens that need fresh
   data ask explicitly (`matches` and `messages` set `refetchInterval`).
   `__tests__/query-defaults.test.ts` pins the settings and asserts they match
   what `app/_layout.tsx` actually configures.

2. **The random upload minute was re-drawn on every app restart.** It lived in
   a module-level variable, so a device that restarted twice inside the upload
   window drew twice and used the later-arriving draw — which makes the
   effective distribution the *minimum* of several uniform draws, biased
   earlier, and makes the upload time correlate with how often the user opens
   the app. The random minute exists precisely to remove that correlation.
   **Fix:** an `epoch_plans` table. The minute is drawn once per epoch and
   persisted; `plannedMinuteFor` only calls the draw when no plan exists, and
   re-reads after an `INSERT OR IGNORE` so two racing callers agree. Four tests
   added, including one asserting the draw happens exactly once across three
   calls.

**A blocking bug that only a real compile could find.** The first Android build
failed, and the reason is worth recording:

```
ExpoModulesPackageList.kt:46:7 Syntax error: Expecting an expression.
      in.mutual.ble.MutualBleModule::class.java to null
```

`in` is a **reserved keyword in Kotlin**. The module's own sources escaped it
(`` package `in`.mutual.ble ``) and would have compiled on their own, but
Expo's autolinking **generates** a Kotlin file that writes the package name
unquoted — so no build could ever succeed. Nothing in lint, typecheck or 174
jest tests could have caught it; it needed the JDK and the Android SDK, which
were installed during this session for exactly this reason.

**Fix:** the Android package is now `app.mutual` and the native module's
package is `app.mutual.ble`. The reason is written into `app.config.ts` and the
module's `build.gradle` so nobody reintroduces `in.mutual.*` as the more
idiomatic reverse-domain name for an Indian project. The package name was
already on the Phase 8 human review checklist as a decision worth confirming;
it still is, with one option removed.

Also added `app/modules/*/android/build/` to `.gitignore` — the local module's
Gradle output had been left untracked-but-visible.

### 26. The first built APK, and two things only it could reveal — Adopted

The Android build succeeded (`BUILD SUCCESSFUL in 12m 30s`, a 321 MB debug APK,
package `app.mutual`). Inspecting the **built artefact** rather than the
prebuild output immediately found two problems that every earlier check had
passed.

**Getting there needed two workarounds worth recording:**

- `in` is a Kotlin keyword and Expo's autolinking generator writes package
  names unquoted — entry 25. Renamed to `app.mutual` / `app.mutual.ble`.
- The C++ native build failed with
  `Filename longer than 260 characters` while compiling
  `react-native-gesture-handler`'s codegen output. Windows
  `LongPathsEnabled` is already 1, but ninja and CMake do not honour it, and
  the project path (`C:\Users\sanka\Desktop\STUDIES\AIDS\Project 2\`) is long
  and contains a space. **Fix:** a directory junction,
  `mklink /J C:\mtl "<project>"`, and build from `C:\mtl\app\android`. This is
  a property of where the repository lives, not of the repository, so it is
  recorded for whoever clones it into a deep path next.

**Finding 1 — the good news, confirmed on the real artefact.** The merged
manifest contains **zero location permissions**. `aapt2 dump permissions` on
the APK shows `BLUETOOTH_SCAN` carrying
`usesPermissionFlags='neverForLocation'`, and no `ACCESS_*_LOCATION` of any
kind. Invariant 3 and claim C4 hold in a thing that could actually be
installed, not just in a generated file.

**Finding 2 — the config plugin was doing nothing useful.**
`withBleNeverForLocation.js` deleted `SYSTEM_ALERT_WINDOW` from the manifest at
prebuild, and the built APK **still carried it**. The reason is the order of
operations: Expo's plugins edit the app's own manifest, and *then* Gradle merges
every library's manifest into it. `expo-dev-client` re-adds the permission
after the plugin has run, so the plugin's deletion is invisible in anything
that ships.

**Attempted fix, and what it actually achieved.** Permissions that must be
absent were moved to `android.blockedPermissions`, which Expo turns into
`tools:node="remove"`. That **worked for `CAMERA`** (declared by
`expo-image-picker`, which Mutual does not need because it only ever reads from
the photo library) — gone from the merged manifest.

It **did not work for `SYSTEM_ALERT_WINDOW`**, and chasing down why is the more
useful finding. The manifest-merger report shows our remove directive being
applied, and the permission still appears in all three merge stages. The source
is `react-android-0.86.3-**debug**`'s own manifest, which declares it for the
dev overlay (LogBox) — and a library's own declaration wins over an
application-level `tools:node="remove"`. Only the *debug* AAR declares it;
there is no release variant carrying it.

So the honest resolution, rather than either hiding it or leaving the check
broken: `check-privacy-invariants.ts` now treats `SYSTEM_ALERT_WINDOW` as
**expected in a debug manifest and forbidden in a release one**, and prints the
source as a note. A release build is the only build a participant would ever
install, so that is where the assertion bites. `blockedPermissions` keeps the
entry — it costs nothing and may take effect in a release build — and the
plugin keeps the one job only it can do: the `neverForLocation` flag, which
`blockedPermissions` cannot express.

**Worth being explicit about what was *not* done here:** the check was not
simply relaxed until it passed. `SYSTEM_ALERT_WINDOW` is not one of the 13
invariants and was not in the spec's requirements — it is an assertion added
during this review an hour earlier. Narrowing a self-imposed assertion to the
build where it is true and enforceable is different from weakening a specified
guarantee, and every specified guarantee (no location permission,
`neverForLocation` present, no denylisted SDK, no `fetch` outside
`src/api/client.ts`) passes against the **merged** manifest now.

**Finding 3 — the privacy check was reading the wrong file, and said so
quietly.** `check-privacy-invariants.ts` guessed at hard-coded paths under
`merged_manifests/`. The real directory is named after the Gradle task
(`processDebugManifest`), which has changed between AGP versions, so none of the
guesses matched and the script silently fell back to the weaker prebuild
manifest — printing a note nobody would read as a failure.

That is the worse of the two bugs: a check that verifies a weaker thing than it
claims is more dangerous than one that fails. **Fix:** the script now *searches*
`merged_manifests/` for any `AndroidManifest.xml`, prefers a debug variant, and
only falls back to the prebuild manifest when no merged one exists. It also now
asserts the two unwanted permissions, so the SYSTEM_ALERT_WINDOW class of
problem cannot recur silently.

**What this says about the earlier phases.** Phase 8 recorded AC-T2-3 as
passing "against the prebuild manifest", which was true and weaker than it
sounded. The criterion's own wording allows it ("may be against the prebuild
output"), but the stronger check was available all along and is now the one that
runs. Lint, typecheck and 174 jest tests could not have found any of this: it
needed a JDK, the Android SDK, a 12-minute build and a look at the output.

### 27. Running the app for the first time — two real bugs, and a blocked interpreter

Getting the built APK to actually launch on an emulator found two defects that
nothing earlier in the project could have found. Both were in code that
compiled cleanly and passed 174 tests.

**Bug 1 — a missing dependency that made the app unlaunchable.**

```
Unable to resolve module @expo/ui/jetpack-compose
  from node_modules/expo-router/build/layouts/stack-utils/toolbar/StackToolbarMenu/native.android.js
```

`expo-router` in SDK 57 imports `@expo/ui`, and `npx expo install expo-router`
does not pull it in. Metro returned HTTP 500 for the bundle and the dev client
died with a `DebugServerException`. **Fix:** `npx expo install @expo/ui`
(57.0.22), now declared in `app/package.json`.

**Bug 2 — the native module could never have loaded, in my own Kotlin.**

```
java.lang.UnsupportedOperationException: This function has a reified type parameter
  at app.mutual.ble.MutualBleModule.definition(MutualBleModule.kt)
  at expo.modules.kotlin.ModuleHolder.<init>
```

The Expo Modules API builds its JS/native converters by **reifying** the types
in each `Function { ... }` signature. `MutualBleModule` used
`Map<String, Any?>` for `setSchedule`'s argument, `start`'s config, and the
return values of `drain`, `status` and `peek`. `Any?` is erased, so reification
throws — **at module-registration time**, which takes the whole app down on
launch before a line of JS runs.

This is the most serious defect found in the whole project, and it is worth
being precise about why nothing caught it: the Kotlin **compiles** (reified
generics fail at runtime, not at compile time), the TypeScript wrapper has
10 passing tests (they mock the native module, which is the only thing a unit
test can do), and `aapt2` is happy with the APK. It needed a JDK, the Android
SDK, a 12-minute build, an emulator and a launch.

**Fix:** every argument and return value across the bridge is now an Expo
`Record` with `@Field`-annotated properties of concrete types —
`ScheduleEntryRecord`, `StartConfigRecord`, `SightingResultRecord`,
`StatusRecord`, `PeekRecord`. The privacy shape is unchanged and now
enforced by the type system rather than by convention: `SightingResultRecord`
has exactly five fields and there is no `Any` for an RSSI value or a timestamp
to hide in. `ScheduleEntryRecord.toEntry()` returns null for a malformed
entry, so one bad record cannot poison the schedule.

**The development machine started blocking its own Python.**

Part-way through the session, `.venv\Scripts\python.exe` began failing with
`blocked by your organization's Device Guard policy`. It had worked for hours.
The uv-managed interpreter it was copied from is still allowed, so the
workaround is to use that interpreter with the venv's `site-packages` **and**
the three editable-install source directories on `PYTHONPATH` (a `.pth` file is
not processed via `PYTHONPATH`, which is why all four entries are needed).
Verified: 272 tests still pass.

This is recorded as an **environment problem for the human to resolve
properly**, not a thing to work around permanently: it also disables the
pre-commit hooks, and a project about privacy should not run with its test gate
off. Written up in the new `docs/RUNNING_LOCALLY.md`, together with the
PowerShell execution-policy failure the human hit, the 260-character path
limit, the `MSYS_NO_PATHCONV` requirement for `adb` paths, and the fact that
PowerShell's `>` redirect corrupts a `screencap` PNG.

**Also found while getting this far:** the default AVD skin is 320x640 at
density 160, which is far too small to judge a design against
`docs/design/prototype.html` (390x812). `adb shell wm size 1080x1920` and
`wm density 420` give a realistic phone for screenshots.

### 28. The app runs — what the last two bugs were, and what was verified on screen

Continuing entry 27. Two more defects stood between a built APK and a running
app, and both are the same shape: something that compiles, has no test that
could see it, and fails only when a real Android runtime loads it.

**Bug 3 — `start` and `stop` returned an Android class.**

The reified-type crash survived the rewrite to `Record` types, which was
confusing until the cause turned out not to be the argument types at all.
Kotlin infers a lambda's return type from its last expression, and
`context.startService(intent)` returns **`ComponentName?`**. So
`Function("stop") { ... context.startService(...) }` had `R = ComponentName?`,
an Android class Expo cannot convert — and reifying it threw at
module-registration time, exactly as `Map<String, Any?>` had.

**This bug was in the very first version of the module.** The `Record` rewrite
had not failed; it had fixed a different (also real) problem while leaving this
one. Fixed by making both lambdas end in an explicit `Unit`, with a comment
saying why, because the next person to add a `Function` that ends in a
framework call will hit it again.

The bridge kept the JSON-string shape from entry 27 rather than reverting to
`Record`s. Both would now work; the JSON version is the one that has been
seen to run, and it makes the privacy contract easier to audit — every field
that crosses is written out by name in `drainJson`, so there is no object
spread through which an RSSI value or a timestamp could arrive unnoticed.

**Bug 4 — a custom entry file left expo-router with no routes.**

`package.json` had `"main": "index.ts"`, a two-line file importing the CSPRNG
polyfill and then `expo-router/entry`. The bundle built (2,086 modules) and the
app launched with **no error anywhere** — and rendered a blank white screen,
because expo-router resolves its `app/` directory relative to the entry it was
given and found none, so it registered zero routes.

A blank screen with no error is the worst failure mode to debug: nothing in
logcat, nothing in Metro, nothing on screen. What identified it was measuring
the pixel colour — pure white, not the app's `#F7F3EE`, which proved no part of
our tree was painting.

Fixed by using the documented `"main": "expo-router/entry"` and making the
polyfill the first import of `app/_layout.tsx`. That is still before any
protocol code can run: `_layout.tsx` is the first module of the app's own tree
to execute, and nothing in `@mutual/protocol` touches the CSPRNG at import time
— `random.ts` throws when called, never on load. `app/index.ts` is deleted and
removed from SPEC §20.

**A robustness bug fixed on the way.** `useAppFonts()` ignored the error from
`useFonts`, and the root layout renders a blank background until it returns
true. A font that failed to load would have left the app blank **forever**,
with nothing on screen and nothing in the log — indistinguishable from a hang.
It now warns and carries on in the system face: a wrong-looking app that works
beats a correct-looking app that never appears.

**A layout bug found by looking at a screenshot.** `Screen` added the bottom
safe-area inset but not the top, so every screen's back button and title sat
underneath the status bar. Visible immediately on the privacy screen, invisible
to every test. Fixed, and confirmed fixed on screen.

#### What was verified on the emulator

| | |
|---|---|
| App launches, no crash | yes, package `app.mutual` on Android 16 |
| **Protocol self-test on the device** | **"Protocol OK" — 17 vectors from `vectors.json` reproduced byte-for-byte under Hermes**: pair keys, interest tokens, EIDs, ephemeral keys, encounter tokens, key validity and base64url |
| Welcome screen against the prototype | matches: warm paper `#F7F3EE`, Fraunces display, "almost" in terracotta italic, the overlapping-circles logo, ink pill button, underlined privacy link |
| Privacy screen | matches: both lists, eye and crossed-eye icons, the unaudited-prototype footnote and the not-end-to-end-encrypted note |
| Fonts | Fraunces and Inter both load and render on the device |

That settles the Phase 8 human-review item "the in-app protocol self-test shows
OK on the emulator", which had been outstanding since Phase 8. **The
TypeScript protocol produces the same bytes as the Python reference, on an
actual Android runtime** — which is the claim the whole cross-language vector
suite exists to support, and until now it had only been checked under Node.

Still not done, and still needing a person: the 60 steps of
`docs/E2E_CHECKLIST.md` (two emulators, and judgement about what each screen
should feel like), and the two-phone BLE spike.

### 29. The second security review, and what it found — Adopted

An independent review of the whole app layer (`app/src`, `app/app`,
`app/modules/mutual-ble`, the scripts, the config and the merged manifest), run
against `CLAUDE.md` §5 and `SPEC.md` §6, §7, §9, §11, §13, §14. It was asked to
assume nothing was right merely because it had a test.

It found one invariant violation, two bugs that stopped the system working at
all, and a set of smaller ones. All were applied under the human's standing
delegation for security fixes (2026-10-05); the ones that are spec questions
rather than code questions are marked and are on the Board.

**1. Sending a signal told the server you had sent one.** The Today screen
finished every signal — send, change *and* withdraw — by calling
`letter.refresh()`, and `refresh()` called `digest.refetch()`. A refetch is
imperative, so it goes straight past `staleTime: Infinity` and every other
default that `query-defaults.test.ts` so carefully checks. The result was a
`GET /v1/digest` in the server's log at the exact second a one-sided signal was
created. Claim C1 says the two worlds "U holds an unreturned signal for V" and
"U holds no such signal" must produce identical request logs; telling them apart
needed nothing but a timestamp.

This is the most serious thing found in the project so far, and it was in the
one screen the whole protocol exists to protect. It was also almost certainly
added for an innocent reason: to re-render the "Signal sent" chip. Nothing on
the server can have changed anyway — the digest is byte-identical until the next
release (claim C5) — so `refresh()` now bumps a local counter and re-reads
SQLite.

The lesson is about the shape of the test suite, not about one line.
`query-defaults.test.ts` checks the *declarative* half of invariant 1 and passed
throughout. There was no test for the imperative half, which no configuration
can protect. `signal-no-traffic.test.tsx` is now that test: it renders the
letter, waits for it to load, then sends, changes and withdraws a signal and
asserts `fetch` was not called once.

**2. The radio was never switched on.** `NativeBle.start()` had exactly one
caller in the entire app: the pause switch on the You screen. A new account's
`discovery_paused` is false, so the switch's first use *pauses* — a user had to
toggle it twice before anything was ever advertised. Until then nothing
advertised and nothing scanned, every later stage was correctly empty, and Today
said "No crossings yesterday" forever. A failure that produces a plausible,
calm, entirely wrong screen is the worst kind, and this one would have survived
a pilot: we would have concluded the BLE detection rate was zero.

Now `presenceTick` starts the adapter after handing it a schedule, the
permissions screen runs one pass of the nightly work on its way out, and
resuming from pause goes through the same path — which also fixes the radio
running on compiled-in defaults instead of the server's `ble.*` settings.

**3. The legacy advertisement fallback cannot receive anything.** `SPEC` §14.2's
fallback puts `magic || version || EID[0:24]` in the advertisement and
`EID[24:32]` in the scan response, both under company id `0xFFFF`, and says "the
scanner uses active scanning and joins the two halves". Android parses
manufacturer-specific data into a map keyed by company id, so the two halves
collapse onto each other and the scanner never sees a 32-byte id. No encounter
token is ever produced on a device that falls back — silently, while the UI
reports that advertising is on.

**Not fixed, deliberately.** Both candidate fixes (parse the raw AD bytes and
join them, or move the tail into a service-data element) are guesses about merge
behaviour on hardware this laptop does not have, and writing untested Kotlin
against a guess is exactly what produced the two module bugs in entry 27. What
was done instead: `status()` now reports `legacy_fallback_unverified` rather
than claiming discovery works, and the defect is written into
`docs/BLE_SPIKE.md` as the **first** thing the two-phone spike must settle. If
the join cannot be made to work, §14.2 is a spec change, not a code change.

**4. Raw sightings were being uploaded to Google.** The BLE module keeps its
undrained sighting table in `SharedPreferences`, keyed by own EID, heard EID and
15-minute interval. The manifest had `android:allowBackup="true"` with
expo-secure-store's bundled rules, which exclude only `SecureStore` and include
the whole rest of the `sharedpref` domain. So this device's EIDs and the
intervals it heard others in were going to Android Auto Backup.
`SightingStore`'s own comment explains that it stores no timestamps so that a
compromised device cannot reconstruct a movement trace; the manifest undid that.
Now `allowBackup: false`, recorded in SPEC §14.1 — and §4 already said there is
no key escrow and no backup.

**5. A build without an environment variable shipped the dev panel.**
`app.config.ts` had `env: process.env.EXPO_PUBLIC_MUTUAL_ENV ?? 'dev'`, and
`isDev()` is what gates clock travel, synthetic crossings and the readout of
tonight's upload minute — the one value §6.11 says must never be predictable.
Fail-open is the wrong direction for a privacy invariant. It now defaults to
`'prod'`, and development sets the variable explicitly.

**6. Three of the ways a signal ends were never wired up.** §6.10 says a signal
lives until its TTL runs out, or it is withdrawn, or a match arrives for its
`(peer, intent)`. Withdrawal worked. The others did not, and nor did the TTL's
own anchor:

- `expiredSignals()` had no caller. Dead rows stayed in the table, so after a
  week of ordinary use a user could be told "All 20 signals are out" while
  holding none that would ever be uploaded again.
- `touchCrossing()` had no caller, so the TTL anchor was written once at
  creation. A signal to someone crossed every single day still expired seven
  days after the *first* crossing — the exact opposite of what the TTL is for.
- Nothing cleared a signal when its match arrived. The slot stayed used, and the
  same real token was rebuilt and re-uploaded every epoch; per §6.9 the server
  appends a newly matching token to an existing match as another shared intent,
  so the number of shared intents both sides saw would have climbed night after
  night with neither of them doing anything.

All are now wired up, with eight tests in `signal-lifecycle.test.ts`.
`sent_tokens` is pruned on a 30-day horizon too, which its own docstring had
described and nothing performed.

**7. Every day and every epoch came from the phone's clock.** §6.11 is explicit:
"The client uses the server's current epoch from `GET /v1/config`, never its own
clock", and §6.3 says devices correct their clock by the `server_time` offset.
`ServerConfig.epoch` and `ServerConfig.server_time` existed in the types and
were read nowhere. A phone in another timezone addressed its upload to a day the
server rejects — after the local ledger had already recorded that day as
claimed, so the epoch was lost rather than retried — drew its random upload
minute against the wrong wall clock, and computed different interval indices
from its peer, which is what the §6.13 midnight rule depends on.
`src/signals/deploymentClock.ts` now derives the deployment's wall time from
`server_time`, including the skew between the two clocks, and `runNightlyWork`
addresses uploads to `config.epoch`.

**8. An empty night was not uploaded, which said "I was near nobody".** *(A spec
question, resolved in favour of the spec.)* `upload.ts` skipped the request when
a night produced no qualifying encounters, and argued in a comment that this was
covered by §7.3. It is not: §7.3 grants the server "the size rounded up to a
multiple of 256", and silence is not a size. §6.13 says the set is padded "to
the next multiple of 256, **at least 256**", and `paddedSize(0)` returns 256
precisely so that this case has an answer. With the skip in place, zero was the
one count the server could read exactly — so it learned which nights a user was
ill, off campus or alone, the cheapest thing in the system to observe. The code
now matches the spec, SPEC §7.3 says so explicitly, and the test that asserted
the old behaviour was rewritten rather than deleted, with the reasoning in it.

**9. The presence upload ignored its window.** §6.11 asks for "a random time
between 00:05 and 06:00 local on day d+1" and states that the timing "is a
privacy property, not a convenience". `presence_upload_window` was read into a
type and never used: the upload went out whenever Android happened to wake the
background task, which correlates with when the phone is being used. It now
draws a minute inside the window from the CSPRNG, once per night, persisted in a
new `presence_plans` table (schema version 2) for the same reason the signal
minute is persisted.

**A consequence the human should know about:** a night whose window passes
without the device waking is now *lost* rather than uploaded late, which is what
the signal path already does. That is the privacy-preserving reading of §6.11,
and it does mean a phone switched off overnight produces no crossings. If the
pilot needs the other trade-off, that is a spec change to §6.11, not a bug. On
the Board.

**10. Nothing checked that the Kotlin constants still matched the spec.**
`Schedule.kt` restates six values from `constants.json` by hand, because the
native module cannot load the JSON at build time. A `protocol_version` bump that
changed `ble.magic_hex` would update the spec, the constants, both
implementations and the vectors — all of which have tests — and leave Kotlin
quietly advertising the old format, with every test in the repository still
passing. `kotlin-constants.test.ts` now reads `Schedule.kt` as text and compares
all six.

**Smaller ones, all applied.** The media fetch had no timeout, so one hung
connection stalled the whole morning's sequential prefetch. The scan window was
skipped after every EID rotation and never opened at all on a device that could
not advertise — the guard contradicted its own comment. `extractEid` had no
length check and trusted the TypeScript side to reject what it returned. The
"preview of how you appear" on the You screen hashed the user id instead of the
identity key, so it showed a different blob from the one every peer sees.
`pickAdapter` substituted the fake adapter in release builds, where it would
report "advertising" on a phone that cannot. The `global.fetch` ESLint guard was
silently dropped in exactly the files that render peer content. The privacy
script now also rejects remote URLs, `WebView` and `sendBeacon`, not just
`fetch`. And two comments asserted things their own code did not do.

**One found by using the app rather than reviewing it.** Typing a bad address,
pressing "Send me a code", then correcting it left the field red with "That does
not look like an email address." underneath a perfectly good one. All four
onboarding forms set the error on submit and cleared it only on the next submit.
Fixed in all four, with `form-errors.test.tsx`.

**Where it landed.** SPEC §7.3 (the empty-night rule), §14.1
(`BLUETOOTH_CONNECT` with its reason, and `allowBackup="false"`), §20 (the new
file). CLAUDE.md §6 had said the privacy script checks hex literals; ESLint does,
and it now says so. Tests: **272 Python, 206 app (was 174), 29 protocol-ts**.

**Still open, and on the Board:** the legacy-split join (needs two phones); the
daily keys living in plaintext SQLite while SPEC §9 reads as if they were in the
keystore; and whether §6.11's window should cost a night when the phone was off.

### 30. Five Board questions answered, and one that cannot be — Adopted

The human answered the Board on 2026-10-07, delegating three of the five to me
("do whatever is good", "follow common ethics and answer them yourself"). What
each turned into.

**Q10 — the legacy Bluetooth advertisement. Withdrawn, not repaired.**

The human's answer was "no issue, since most people use latest phones", which
settles it: the split layout goes rather than being fixed.

That is the right call and worth recording why, because withdrawing a fallback
sounds like losing something. Repairing it meant changing what goes on air —
a different company id for the tail, or moving the tail into a service-data
element — which is a protocol change under invariant 8, with a
`protocol_version` bump and regenerated vectors, for the sake of phones older
than the Android 12 floor the project already sets (D1). BLE 5 reached
mid-range Android years before Android 12 did. The fallback was insurance
against a population that this project has already excluded.

What was removed: `startLegacySplit`, the legacy advertise callback and flag,
`Payload.legacyHead`/`legacyTail`, `AdvertiseLayout.LEGACY_SPLIT`, and the four
`LEGACY_*` constants in `BleConstants`. `extractEid` now accepts exactly the
35-byte payload and nothing else, which is simpler than accepting two lengths
and safer than accepting any. `kotlin-constants.test.ts` gained a case
asserting that no `LEGACY` identifier survives in `Schedule.kt`, so the
withdrawn layout cannot creep back as dead constants.

What a device without BLE 5 now gets: `unsupported_device`, said plainly, and
no part in discovery. That is the whole point of the change. The previous state
— advertising correctly and hearing nothing, for good — was the worst of both,
because it is indistinguishable from a quiet campus.

**Q11 — the presence upload window. Left as specified.**

The human said they did not follow this one and that it is not an issue for
now. Restating it as plainly as it can be put: the app waits for a random
minute between 00:05 and 06:00 to send the night's encounter tokens, because
sending them the moment the phone happens to wake up would tell the server
roughly when its owner is asleep. The cost is that a phone switched off through
that whole window never sends that night, and the server's cutoff then refuses
it — so that day produces no crossings for that person.

Kept as it is. The alternative (upload late, outside the window) hands the
server exactly the sleep-and-routine signal the window exists to remove. If the
pilot's crossing counts come out low, this is the first thing to look at, and
it is a spec change to §6.11, not a bug.

**Q12 — daily keys in plaintext SQLite. The spec was corrected, not the code.**

"Do whatever is good." The good thing here is the accurate description.

Moving the daily keys into `expo-secure-store` sounds stronger and buys almost
nothing. Device compromise is out of scope (§7.2): an attacker with the app's
private storage has both the database and the keystore, because the app itself
must be able to read both. What it would cost is real — SecureStore is a
key-value store with no enumeration, and `forgetStaleKeys` has to list the days
it holds, so a second index would have to be maintained and kept correct, and
an index that drifts loses keys that are still needed.

So SPEC §9 now says what is true, in a new §9.1: the keystore holds the session
token, the identity private key and the user id; everything else, daily keys
included, is in the app-private SQLite database. The identity key is the
exception that stays, because it is the one secret whose disclosure is not
merely a device compromise — it is what makes one-sided interest unreadable to
the server (claim C1), and it outlives every daily key.

`secure.ts`'s docstring, which had been corrected once already in entry 29 to
stop claiming the daily keys were there, now explains why they are not.

**Q9 — declining consent. The design was wrong, and is changed.**

"Follow common ethics and answer them yourself." The answer is that the
previous design would not have survived an ethics committee, and should not
have.

It required a `consent_version` to create an account on a study campus. So on
that campus, for those weeks, the only way to use a campus social app was to
agree to be in a study. That is consent obtained as the price of participation
in ordinary student life, and it is not freely given. The in-app copy even said
so out loud — "an account cannot be created without agreeing to take part" —
which is the kind of sentence that reads fine while writing it and badly in an
application form.

What changed:

- `POST /account` no longer rejects a missing consent version. A user without
  one has the ordinary app and appears in no study outcome.
- The consent screen's dead end ("Not now", which went *back*) is now
  **"Use Mutual without taking part"**, which goes forward.
- The screen states the thing that is true either way: the reveal policy is a
  campus setting, so it changes during the study for everyone on that campus,
  participant or not. They are told because it is a change to the product they
  use, not because they are subjects.
- Nothing re-asks during the block. Repeated asking is pressure.
- `test_consent_required_only_on_study_campus` asserted the old behaviour. It
  was rewritten rather than deleted, as two tests, with the reasoning in the
  docstring: an account is created either way, and the `consent_version` column
  is what differs.

**Q8 — operator access. Written down as a commitment.**

The student running the pilot and the supervisor hold operator access, and
**neither holds a participant account on that deployment**. §7.2 already
recorded why there is no technical fix: an operator who is also a user can test
interest directed at themselves, silently, until the batch deletes that epoch's
tokens. So it is a governance rule, and the right place for a governance rule
is somewhere a committee can hold you to it —
`study/ETHICS_APPLICATION_DRAFT.md` §6 already carried it, and SPEC §19 now
records it as resolved rather than open. If the person running the pilot needs
to use the app, they use a separate deployment, not a separate account.

**Q4 — the one that stays open.**

Which ethics body approves research with students at the institution, and on
what timeline. This cannot be answered from inside the project, and it would be
a serious thing to pretend otherwise: invariant 9 turns on `study/APPROVAL.md`
recording a real committee's real reference, and the server refuses to start in
study mode without it. A plausible-looking answer written here would be a
forged approval. It stays on the Board, marked as the human's alone.

**Q3 — two phones: yes, and last.** The human has them; the spike is the final
task. `docs/BLE_SPIKE.md` §1a — the section written in entry 29 to settle the
legacy join — is now moot and should be read as history; what the spike still
has to measure is whether extended advertising is delivered under
`neverForLocation` without a location permission.

**The Device Guard problem has a name.** It is Smart App Control, and it is
enforced (`VerifiedAndReputablePolicyState = 1`). The human administers this
laptop, so it is theirs to switch off — in Windows Security → App & browser
control. **That is a one-way door**: it cannot be turned back on without
resetting Windows. Recorded in `docs/RUNNING_LOCALLY.md` with the trade stated,
because the shim directory already works and the only thing it cannot fix is
`scipy`, which Tier 3's model needs and which can be run elsewhere for free.
