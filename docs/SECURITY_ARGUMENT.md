# Security argument — Mutual

Status: Tier 1 document. Companion to `docs/THREAT_MODEL.md`. The normative
source for every claim is `SPEC.md` §7.4.

This document does one thing: for each security claim, it says what the claim
means precisely, what evidence supports it, and where that evidence lives. Two
kinds of evidence appear, and they are labelled differently on purpose:

- **Test.** A named test file and the specific thing it asserts. A claim
  backed by a test is checked on every commit.
- **Argument.** Prose reasoning, usually about a cryptographic primitive or a
  structural property of the code. A claim backed only by an argument is
  weaker, and this document says so rather than blurring the distinction.

Mutual is an **unaudited research prototype**. No part of this has been
reviewed by a professional security auditor.

---

## 1. The five claims at a glance

| Claim | In one line | Strongest evidence |
|---|---|---|
| **C1 — Independence** | The server's data and observed traffic are identical whether or not an unreturned signal exists | Test (two worlds, end to end) |
| **C2 — Mutual only, both sides** | Only mutual same-intent interest is ever revealed, only to the two parties, and always to both | Tests (protocol + server + fair delivery) |
| **C3 — No intent anywhere** | No protocol message, API field, stored column or log line carries an intent | Test (automated schema audit) |
| **C4 — No location** | No location is collected, transmitted, stored or logged | Tests (manifest + schema + retention) + argument |
| **C5 — No real-time proximity** | A crossing is invisible until the next morning's release | Test (injected clock, byte-identical responses) |

---

## 2. C1 — Independence of one-sided interest

### What the claim says

Take two parallel worlds that differ in exactly one respect: in world A, user
U holds a signal for peer V which V does **not** return; in world B, U holds no
signal at all. Then the following are identical across the two worlds:

1. every row the server stores, except the raw bytes of
   `epoch_tokens.token` before the nightly batch deletes them;
2. the request log produced by **every** account — method, path, query, body
   length, status, in time order under a mocked clock;
3. every response body returned to every account.

### Why it is true, structurally

Four design rules do the work, and all four are necessary:

1. **Fixed size.** A signal upload is always exactly `signal_set_size` = 20
   tokens of 32 bytes (`SPEC.md` §6.7). One real signal, twenty real signals
   and zero real signals produce byte-identical request sizes. The padding is
   drawn from the OS CSPRNG.
2. **Fixed frequency.** At most one upload per epoch, and it happens whether
   or not the user signalled anyone (§6.11). There is no "upload because the
   user just tapped".
3. **Random timing.** The upload time is drawn uniformly inside the evening
   window, which the measured costs below confirm is 5.5 hours wide. Upload
   time therefore carries no information about when the user acted.
4. **Batch matching.** Matching runs once, at a fixed time after the window
   closes, never inside a request (§6.9). This removes response *timing* as a
   side channel, which padding alone would not.

Given those four, the only thing that differs between worlds A and B is the
content of 20 opaque 32-byte values. An interest token is

```
token = BLAKE2b(key = pair_key(U, V), person = "mutual-interest1", data = epoch ‖ intent)
```

where `pair_key` is derived from the X25519 shared secret between U's and V's
identity keys together with both user ids (§6.5). The honest-but-curious
operator holds neither private key. Under the standard assumption that keyed
BLAKE2b is a PRF and that X25519 shared secrets are indistinguishable from
random to a party without either private key, a real token is computationally
indistinguishable from the random padding beside it. So world A's upload and
world B's upload are indistinguishable, and because the batch deletes every
non-matching token, they are not even retained for later analysis.

### Evidence

- **Test:** `server/tests/test_leak_two_worlds.py::test_worlds_a_and_b_are_indistinguishable_and_c_is_not_vacuous`.
  It drives three complete worlds through signup, presence upload, crossing
  resolution, digest, signal upload, the nightly batch and the release step,
  then compares stored rows, request logs and response bodies across worlds,
  before **and** after the batch.
- **Non-vacuity, which matters more than the pass itself:** the same test runs
  a third world C where V signals U back, and asserts that a match *is*
  produced and *is* visible from `notify_after`. A leak test that passes
  because nothing happens is worthless; world C is what rules that out. Before
  `notify_after`, world C's responses are additionally asserted identical to
  world B's — so even a real, formed match is invisible until its fixed
  release instant.
- **Argument:** the PRF reasoning above. It rests on an assumption about
  primitives, not on a test, and is labelled accordingly.

### Honest limits of C1

- It is a claim against an **honest-but-curious** server. An active server
  that substitutes V's public key learns every one-sided interest directed at
  V, undetectably. This is the project's largest residual risk
  (`docs/THREAT_MODEL.md` §3.8).
- It covers the server's view. Client-side behaviour — that the app does not
  betray the user by uploading early or making a per-card request — is a
  separate claim, covered by invariant 1, `AC-T2-2`,
  `app/scripts/check-privacy-invariants.ts` and the two app tests named below.
- **The client half has been violated once, and the violation is instructive.**
  The Today screen called `digest.refetch()` after every signal, which put a
  `GET /v1/digest` in the server's log at the second a one-sided signal was
  created: two worlds that differ only in whether U signalled V produced
  different request logs, which is precisely what this claim denies. The server
  was blameless; the leak was entirely in the app.

  What made it survivable for as long as it did is worth recording.
  `app/__tests__/query-defaults.test.ts` asserts the *declarative* guard —
  `staleTime: Infinity`, `refetchOnMount: false` and the rest — and passed
  throughout, because `refetch()` is imperative and ignores all of it. The
  lesson is that a configuration test cannot stand in for a behavioural one.
  `app/__tests__/signal-no-traffic.test.tsx` is the behavioural one: it renders
  the morning letter, sends, changes and withdraws a signal, and asserts
  `fetch` was not called. Fixed and logged in `docs/DECISIONS_LOG.md` 29.
- `epoch_tokens.token` bytes genuinely do differ between worlds during the few
  hours before the batch. The claim is that they are indistinguishable from
  random, not that they are absent.

---

## 3. C2 — Only mutual same-intent interest is revealed, to both parties, always

### What the claim says

Three parts, each of which can fail independently:

1. **Mutual only.** A match requires both sides to have signalled the same
   intent in the same epoch.
2. **Same intent only.** A signals "study" and B signals "date" is not a
   match.
3. **Both parties, always.** Whatever one side learns, the other side learns,
   at the same instant, and one side cannot take it away afterwards.

### Evidence

| Part | Test |
|---|---|
| A different intent, epoch or peer yields a different token (≥ 5 000 tokens, zero collisions) | `packages/protocol_py/tests/test_tokens.py`, mirrored byte-for-byte in `packages/protocol-ts/test/vectors.test.ts` |
| Cross-intent signals never match | `server/tests/test_route_audit.py::test_cross_intent_signals_never_match` |
| `PUT /signals` stores but never matches; matching happens only in the batch | `server/tests/test_signals.py::test_accepted_inside_the_window_and_once_per_epoch`, `test_rejected_at_or_after_match_batch_time` |
| Non-matching tokens are deleted after the batch | `server/tests/test_signals.py` |
| Both sides are told at the same instant, and not before | `server/tests/test_matches.py::test_a_mutual_match_is_shown_to_both_sides_after_notify_after`, `test_appended_token_is_invisible_until_its_own_release` |
| A pending match is dropped blindly, telling nobody | `server/tests/test_safety.py::test_block_before_notify_after_drops_the_pending_match_blindly` |
| A notified match cannot be erased for one side | `server/tests/test_matches.py::test_unmatch_deletes_messages_and_shows_ended_to_the_other_side`, `server/tests/test_safety.py::test_block_after_a_match_ends_it_for_the_other_side_silently`, `server/tests/test_account.py::test_delete_account_ends_active_matches_for_the_other_side` |
| A block's response never depends on whether a pending match exists | `server/tests/test_safety.py::test_block_unknown_id_is_a_silent_no_op`, `test_blocking_is_idempotent` |
| A second shared intent appends to the existing match with its own release | `server/tests/test_matches.py::test_second_shared_intent_is_appended_with_its_own_release` |

The third part — "always to both" — is the one that is easy to get wrong and
easy to forget to test. It is why block, unmatch and account deletion are all
tested from the *other* party's point of view, and why the evaluation happens
in the release step rather than inside the block request.

### Honest limits of C2

A match reveals, by arithmetic, that the other side signalled you. That is
consensual: the inference requires your own signal. What a match additionally
reveals is **how many** intents the pair shares, because the number of matched
tokens is visible (decision D10). It never reveals which.

---

## 4. C3 — No intent anywhere

### What the claim says

The word "intent" names a user's reason for signalling: study, project,
fitness, friend, date. The claim is that this value appears in no protocol
message, no API request or response field, no database column and no log line.
It exists only as an input to a hash on the device, and as a label the two
matched parties resolve locally from their own stored tokens.

### Evidence

- **Test:** `server/tests/test_route_audit.py::test_no_schema_field_is_named_or_typed_as_an_intent`
  enumerates every route from the live OpenAPI schema and inspects each
  request and response model for a field named or typed as an intent. This is
  an automated audit over the whole surface, not a spot check, so a new route
  that adds an intent field fails the build.
- **Test:** `server/tests/test_signals.py::test_schema_has_only_tokens_no_intent_field`
  and `server/tests/test_matches.py::test_response_shape_has_no_intent_field`
  pin the two schemas where an intent would be most tempting to add.
- **Argument:** on the server side, intent cannot be recovered from a token
  even with the stored row, because recovering it would require the pair key.
  There are only five intents, so the space is tiny — but the key, not the
  space, is what protects it.

### Honest limits of C3

Stated plainly in `SPEC.md` §7.4: message text that users write can reveal an
intent, and the count of matched tokens reveals how many intents a pair
shares. C3 is a claim about the system's own fields, not about what people
choose to type.

---

## 5. C4 — No location

### What the claim says

No location is requested from the operating system, derived, transmitted,
stored or logged — not GPS, not network location, not a place name, not an IP
address.

### Evidence

| Layer | Evidence |
|---|---|
| Android permissions | **Test:** `app/scripts/check-privacy-invariants.ts` asserts the merged manifest contains none of `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, and that `BLUETOOTH_SCAN` carries `usesPermissionFlags="neverForLocation"` (AC-T2-3) |
| Upload schema | **Test:** `server/tests/test_presence.py::test_schema_has_only_encounter_tokens` — the presence request body has exactly one field, a list of tokens: no key, no ephemeral id, no window index, no time |
| What reaches the database | **Test:** `server/tests/test_presence.py::test_no_daily_key_eid_or_time_ever_reaches_the_database` dumps every row of every table and searches it |
| Retention | **Test:** `server/tests/test_retention.py::test_crossing_retention_days`, `test_presence_cutoff_deletes_at_start_of_d_plus_2` |
| Logs | **Argument + operational rule:** uvicorn runs with `--no-access-log` in **every** environment, because the access log records client IP addresses (decision D22). The command is written that way in `CLAUDE.md` §4 and `SPEC.md`. This is the weakest link in C4's evidence: it is a deployment discipline, not a test, and a future operator who starts uvicorn without that flag breaks it |
| Time granularity | The quarter-of-a-day chip shown on a crossing card is computed on the device from its own sighting log. The server has only a date |

### Honest limits of C4

BLE proximity is not location, but it is *correlated* with location: an
adversary who already knows where one device was learns something about where
the other was. Mutual's answer is that nobody — including the server — holds
the timing data that would make that correlation useful, and that the crossing
graph is kept for 7 days at day granularity. The crossing graph remains the
largest by-design disclosure in the system
(`docs/THREAT_MODEL.md` §5, item 5).

---

## 6. C5 — No real-time proximity

### What the claim says

A crossing that happened on day *d* is not returned by `GET /v1/digest`
before `digest.release_time` on day *d + 1*. Between two consecutive release
times, the digest a user receives is byte-identical, apart from the viewer's
own blocks and operator suspensions.

"Byte-identical" is the strong form, and it is the one implemented: the digest
is baked once per release into a snapshot, so repeated polling cannot reveal
that something changed during the day.

### Evidence

- **Test:** `server/tests/test_digest.py::test_crossing_invisible_until_release_the_next_day`.
- **Test:** `server/tests/test_digest.py::test_digest_is_byte_identical_until_next_release_then_shows_late_crossings`
  — the same bytes all day, and a crossing resolved late still appears at the
  next release rather than mid-day.
- **Test:** `test_digest_is_empty_before_any_release`, and the exclusion tests
  that pin *when* each exclusion takes effect (at bake, or live):
  `test_paused_peer_excluded_at_bake_and_stays_excluded`,
  `test_suspended_peer_is_removed_live_even_after_bake`,
  `test_viewer_own_block_removes_peer_immediately`.
- All of these run under the injected clock (`mutual_server.clock`), never
  wall-clock time, which is why they can assert instants rather than
  approximations.

### Honest limits of C5

Two exceptions to byte-identity are deliberate and tested: the viewer's own
block takes effect immediately (a safety action must not wait for a release),
and an operator suspension is applied live. Both are changes the viewer either
caused themselves or that protect them, and neither reveals anything about
proximity timing.

---

## 7. Measured costs (AC-T1-8)

Every number below is produced by sending a real request through the real
application and measuring the bytes the server received, or by computing a
latency from the configured schedule using the same clock helpers the server
uses. Nothing here is estimated by hand. The measurement lives in
`server/tests/test_costs.py`, and
`test_security_argument_records_the_measured_costs` asserts that the block
below still equals what the code does — so this document cannot quietly drift
out of date.

Reproduce with:

```
python -m pytest server/tests/test_costs.py -s -k print_costs
```

```measured-costs
signal_upload_bytes = 932
presence_upload_bytes_50_sightings = 11792
presence_upload_bytes_500_sightings = 23568
worst_case_match_latency_hours = 38
digest_to_notification_hours = 24
crossing_to_notification_hours = 56
```

### Reading these numbers

**Bandwidth.** A signal upload is **932 bytes** of request body, once a day,
regardless of whether the user signalled nobody or twenty people. That is the
whole price of hiding one-sided interest: under a kilobyte a day. For
comparison, a single profile photo is several hundred times larger.

A presence upload is **11,792 bytes** for a quiet day and **23,568 bytes** for
a very social one. The step between them is not gradual: the set is padded to
a multiple of 256 entries, so 1 sighting and 50 sightings cost *exactly* the
same bytes — asserted by
`test_padding_hides_how_many_sightings_a_small_night_had`. Four padding levels
(256, 512, 768, 1024 entries) mean the operator learns at most a two-bit
activity level, and nothing finer. Total daily upload is therefore between
about 12.7 KB and 24.5 KB, once per night.

**A night with nothing in it costs the same 11,792 bytes**, because it is
uploaded too (SPEC §6.13's "at least 256"). This is the least intuitive line
in the budget and the one most tempting to optimise away — the app did exactly
that until the review in `docs/DECISIONS_LOG.md` 29. Skipping an empty night
makes zero the one count an operator can read exactly, and so hands it a
reliable record of which nights each named account was near nobody: ill, off
campus, or alone. The padding rule is already paying 11.5 KB to blur 1 against
50; refusing to pay it to blur 0 against 1 would give away the most sensitive
count of all for the sake of the cheapest night.

**Latency.** This is where privacy actually costs the user something, and the
honest number is the worst case, not the typical one:

- **38 hours** worst case from tapping a signal to both sides being told. The
  worst case happens when the tap lands a moment after that epoch's single
  upload has already gone out: the signal then waits for the next night's
  upload, that night's batch, and the following morning's release.
- **24 hours** from seeing a crossing in the morning digest to learning about
  the match, which is the typical path a user experiences.
- **56 hours** worst case from the physical crossing itself to the
  notification — a crossing just after midnight waits for that day to end
  before it appears in a digest at all.

For comparison, a conventional app delivers a match in seconds. Mutual trades
roughly a day and a half of latency for the independence property, and the
trade is not hidden from users: the product's promise is a morning letter, not
a live feed, and the copy says so.

**Battery.** Measured separately on real hardware in Phase 9a and recorded in
`docs/BLE_SPIKE.md` (AC-T2-6), not here, because an honest battery number
cannot come from an emulator. If drain exceeds 10% per 8 hours, the duty cycle
is revised through a spec change rather than quietly accepted.

---

## 8. RQ4 — The price of privacy: what becomes impossible

The research question is not rhetorical. Several features that are standard in
this product category are not merely unimplemented in Mutual — they are
**impossible by construction**, and would stay impossible in any system with
the independence property. Naming them is part of the contribution, because a
privacy design that cannot say what it costs is not a design, it is a slogan.

### 8.1 Interest-trained recommendation is impossible

Every mainstream dating and connection app ranks candidates using one-sided
interest data: who you liked, who liked you, who people like you liked. That
is the core of collaborative filtering, and it is exactly the asset C1 makes
unavailable. The server cannot train on it, because the server never has it.

**What replaces it:** ranking on data users deliberately disclose and on
structural signals that carry no interest information —
`reciprocal_content` similarity between profile text, the number of qualifying
crossings, recency, and shared intents *after* a match (`SPEC.md` §11.1). The
honest expectation is that this ranks worse than interest-trained ranking on
engagement metrics. The claim is not that it performs equally; it is that the
difference is a price worth naming.

### 8.2 Measuring one-sided attention is impossible — including for the research

This is the sharpest consequence, and the most awkward one for the project
itself. RQ2 asks how reveal timing affects the **concentration of interest
received**. In the real system that quantity is unobservable *by design*: the
server cannot count how many people signalled any given user without breaking
C1.

So the Gini coefficient of one-sided interest is measured only in simulation,
where ground truth exists by construction, and the field pilot (Tier 3) is
restricted to observable proxies: the Gini of *matches*, conversation depth,
unmatching within 24 hours of reveal, retention. The gap between the quantity
the research cares about and the quantity the system permits itself to see
**is a finding, not a defect** — and it is the reason the simulation exists at
all rather than being a nice-to-have.

A corollary worth stating: Mutual cannot tell a user "you are popular", and it
cannot tell an operator which users are receiving disproportionate attention.
That is a safety cost as well as a product cost — an operator cannot
proactively spot someone being mass-signalled. The defences left are the K=20
cap, blocks and reports.

### 8.3 Real-time discovery is impossible

No "who is nearby now", no live map, no "you crossed paths 2 minutes ago", no
presence indicator, no read-receipt-driven urgency. C5 forbids the whole
category, and the 38-hour worst-case latency is its measured price.

**What replaces it:** the morning digest, deliberately framed as a letter that
arrives once a day. The design treats the delay as the product rather than as
a limitation to apologise for (`SPEC.md` §13.3). Whether users accept that is
an empirical question, and retention is one of the pilot's outcomes.

### 8.4 Growth and engagement mechanics are impossible

A long list follows directly from the three claims above: "X people want to
meet you" teasers (needs one-sided interest), "someone liked you, upgrade to
see who" (the entire freemium model of the category), read receipts and typing
indicators before a match, push notifications triggered by another person's
action on you, streaks and daily-active-user loops, and
"people you may know" built from the crossing graph.

The last one deserves a note: the server *does* hold the crossing graph, so
friend-of-friend suggestions are technically possible. They are excluded by
product decision, not by the protocol — because surfacing them would turn a
7-day proximity log into a social graph users never agreed to publish. It is
worth being clear about which restrictions are cryptographic and which are
chosen; this one is chosen, and could be reversed by a future operator. That
is an argument for keeping retention short.

### 8.5 Analytics and crash reporting are impossible

No third-party SDK can be added (invariant 6, enforced by a denylist in
`app/scripts/check-privacy-invariants.ts`), because any of them would see
screen-level behaviour and defeat invariant 1's "no attention-dependent
traffic". So there is no funnel analysis, no session replay, no automatic
crash aggregation.

**What replaces it:** the fake BLE adapter, dev routes, a written end-to-end
checklist run by hand (`docs/E2E_CHECKLIST.md`), and the simulation. For a
prototype this is adequate. For a real deployment it is a genuine operational
cost, and it should be stated in any claim that this design is deployable.

### 8.6 What is gained, stated with the same precision

So that the ledger is not one-sided: a student using Mutual can signal
interest in someone they see every day, for any of five reasons, with the
guarantee that **if it is not returned, nothing happened** — no notification,
no record, no inference available to the other person, to a curious operator,
or to anyone who later acquires the database. No conventional app in this
category offers that, and the measured price is under a kilobyte a day and a
day and a half of patience.

---

## 9. Verification status

| Criterion | What it requires | Status |
|---|---|---|
| AC-T1-5 | Two-worlds leak test passes and is non-vacuous | Passing |
| AC-T1-6 | Route audit: no intent fields, every id-bearing route gated, dev routes absent outside dev | Passing |
| AC-T1-7 | Retention and digest timing under the injected clock | Passing |
| AC-T1-8 | Costs computed from real uploads and recorded here | Passing, and asserted against this file |
| AC-T1-10 | Both documents exist; C1–C5 each mapped to evidence; RQ4 section present | This file and `docs/THREAT_MODEL.md` |

Run the whole Tier 1 suite with:

```
pytest packages/protocol_py server sim -q
npm test -w packages/protocol-ts
```
