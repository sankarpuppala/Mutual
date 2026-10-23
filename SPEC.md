# SPEC.md — Mutual

Status: **v1.5 — the contract.** (v1.5, 2026-10-23: official college applications §4.2,
the operator console §11.3, operators and audit tables §12, the deployment kit §17 and
§20; D25. v1.4, 2026-10-05: many colleges, each a
closed campus, §4.1 and D24; Q1 and Q2 resolved. v1.3, 2026-10-05: second protocol
review. EIDs are one-time X25519 public keys and encounter tokens are keyed
by a shared secret, §6.8 and §6.13; per-token release, verification and
deletion rules, §6.9 and §6.10; D23.) (v1.1, 2026-10-05: adds the approved visual
reference, §13.9 and D19. v1.2, 2026-10-05: fixes from the adversarial
protocol review: encounter tokens §6.13, batch matching and fair delivery
§6.9, identity binding §6.5, D5/D13 revised, D20–D22. Same day: the
date-one-at-a-time rule was withdrawn for simplicity, see D20.) Every
implementation decision is checked
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
(impossible by design); federation across several servers; key
backup/recovery; malicious-server security (§7.2); app-store release;
hosting at scale. (A single-server pilot deployment kit exists, `docs/DEPLOYMENT.md`,
v1.5; it does not make the prototype production-ready.)

Mutual is **standalone**. It does not depend on any other project (including
Bazaar). Identity is verified by college email OTP.

### 4.1 Campuses (decided 2026-10-05, D24)
One server hosts **many colleges**. Each college is a **campus**: a closed
partition. Nobody ever sees, crosses, signals or matches anyone from another
campus.
- **Campus from the email domain.** The lowercase domain of the verified email
  decides the campus:
  1. if it equals or is a subdomain of a domain listed under a campus in
     `campuses` (config), it belongs to that campus;
  2. otherwise, if it ends in one of `auth.academic_suffixes` (`ac.in`,
     `edu.in`, `edu`), its campus key is the label just before the suffix
     plus the suffix (`cse.iitb.ac.in` → `iitb.ac.in`). That key is a
     **pending campus** until the operator approves it once with
     `python -m mutual_server.admin campuses approve <key> --name "<name>"`.
     Some schools also use these suffixes, and the app is 18+ with a
     self-declared age, so no college opens automatically;
  3. anything else is not a college email.
- **What the server stores** for a pending campus is only its key and a count
  of attempts, never an email.
- **Partition rule.** Crossings are recorded only between users of the same
  campus (§6.13). A token shared across campuses is ignored and nothing is
  stored. Digests, signals, matches, blocks and reports therefore stay inside
  one campus.
- **Account moves.** A user's campus is fixed at account creation. Moving to
  another college means a new account with the new email.
- **Opening** happens in the operator console (§11.3) or the CLI, for any of the three
  routes in §4.2. An open campus may list several domains; no domain may belong to two
  open campuses.

### 4.2 Official college applications (decided 2026-10-23, D25)
A college official can ask for their college to be opened at `GET /colleges`, a public,
script-free HTML form outside `/v1`.
- **Proof of affiliation.** The form takes the college name, its email domain, the
  official's name, role and email. The email must be at that domain or a subdomain of
  it. A 6-digit code (CSPRNG) is mailed to it; only its HMAC under the server pepper,
  bound to the application id, is stored. `colleges.code_max_attempts` wrong tries or
  `colleges.code_ttl_seconds` end the attempt.
- **Nothing opens automatically.** A verified application waits for an owner. Approving
  it opens the campus (key = the academic key of the domain if it has one, else the
  domain itself, so non-academic college domains are possible on this route only), adds
  the verified domain, and sets `campuses.partner_verified_at`.
- **The contact email is stored in plaintext.** It is an institutional work address
  volunteered for a partnership so the operator can reply, not a student's identity.
  Invariant 5 still holds for students. Retention: unverified applications are deleted after
  `colleges.unverified_retention_hours`, decided ones `colleges.decided_retention_days`
  after the decision (§9).
- **Abuse limits.** Per-IP hourly limits on applying and verifying (the IP is counted in
  memory only, as in §9). An already-open domain is refused. A failed email send deletes
  the application.
- **Campus moderators.** A partner college's safety officer can be given an operator
  account scoped to that campus (§11.3).
- The real-world procedure (who to ask, what to agree, how to launch) is in
  `docs/COLLEGE_ONBOARDING.md`.

---

## 5. User journeys

**J1 — Onboarding (≈3 minutes).** Welcome → "How it works" (3 panels) → enter
college email (the app shows "You're joining Mutual at {campus name}", or
"Mutual isn't open at your college yet" for a pending campus, §4.1) →
6-digit code → date of birth (must be 18+; not stored, only
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
sent". The Signals tab shows "4 of 7 signals free" as a row of 7 dots, and
each active signal with an expiry ("until Sunday"). A signal can be withdrawn
any time, and withdrawing frees its slot instantly. No intent has its own
limit; all five share the 7 signals.

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
  "protocol_version": 2,
  "signal_set_size": 7,
  "token_bytes": 32,
  "pair_key_bytes": 32,
  "daily_key_bytes": 32,
  "eid_bytes": 32,
  "eid_interval_minutes": 15,
  "eid_intervals_per_day": 96,
  "encounter_bytes": 32,
  "encounter_pad_block": 256,
  "encounter_max_entries": 1024,
  "uid_bytes": 16,
  "personalization": {
    "pair_key": "mutual-pairkey01",
    "interest": "mutual-interest1",
    "eid": "mutual-eid-v0001",
    "encounter": "mutual-encount01"
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
- "Local" always means the deployment timezone. Devices read their clock
  corrected by the `server_time` offset from `GET /v1/config`. The deployment
  timezone must not observe daylight saving (config validation rejects one
  that does), so every day has exactly 96 intervals.
- User id `uid`: the account's UUIDv4 as 16 raw bytes (RFC 4122 byte order).

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
K_AB = BLAKE2b(data = ss || lo || hi || uid(lo) || uid(hi),
               digest_size = 32, person = "mutual-pairkey01")
```
`uid(x)` is the 16-byte id (§6.3) of the account that registered public key
`x`. `K_AB == K_BA`. Computing a pair key where `pk_A == pk_B` or
`uid_A == uid_B` is an error. Binding the account ids means a copied public
key cannot redirect anyone's tokens.

**Identity key validity.** A public key is valid only if it is 32 bytes,
canonical (top bit clear and `u < 2^255 − 19`), not one of the low-order
points, and not registered to another non-deleted account. The server
enforces this at `POST /account` and `PUT /account/identity-key`. Clients
apply the same checks, except uniqueness, before using a peer's key.

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
esk(d, i) = BLAKE2b(data = uint16_be(i), key = DK_d, digest_size = 32,
                    person = "mutual-eid-v0001")       # X25519 private key
EID(d, i) = X25519_public_key(esk(d, i))               # 32 bytes, broadcast
```
The EID is a one-time public key. It is what the device advertises during
interval `i`, and it is what a peer uses to compute the shared secret in
§6.13. X25519 clamps `esk` as usual (RFC 7748), and a derived EID is always a
valid public key (§6.5).
EIDs are computed in TypeScript and handed to the native module as a
schedule (§14). `DK_d` **never leaves the device**. It is deleted once day
`d`'s encounter set (§6.13) has been uploaded.

### 6.9 Server matching rule
Matching for epoch `e` runs **once**, as a batch job at
`signals.match_batch_time` (23:45 local, after the upload window closes).
`PUT /signals` only stores the set. Users U ≠ V match iff some token
`t ∈ S_U(e) ∩ S_V(e)`. The server records the unordered pair and each matching
token with its epoch. It does **not** know the intent. If U and V already
have an active match, new matching tokens are appended to it (a new shared
intent). When the batch finishes, every non-matching `epoch_tokens` row for
`e` is deleted.

**Fair delivery.** Every matched token has its own `notify_after` =
`digest.release_time` on day `e+1`, where `e` is that token's epoch. It is
the same instant for both parties. The batch never modifies what is already
visible. It writes new tokens, for a new match or appended to an existing
one, as **pending**.
- **Nothing before release.** Before a token's `notify_after`, no response to
  any account may depend on that token. That covers status codes, bodies,
  digest contents and timing. `GET /matches` shows a match only from its
  first token's `notify_after`, and each token only from its own.
- **Blind removal.** Pending tokens are dropped for both parties when, at
  release time, a block exists in either direction, either party has deleted
  their account, or the match was unmatched. Neither party is ever told. This
  is evaluated by the release step, never inside the block, unmatch or delete
  request. If no notified token remains, the match is deleted.
- **No one-sided erasure.** After `notify_after`, a notified match cannot be
  erased for one side. If one party unmatches, blocks or deletes their
  account, the other party still receives it as `state: "ended"`, carrying
  its notified tokens and a frozen minimal card (`peer_id`, `first_name`,
  `identity_pk`), but no chat and no photos. It stays until that party's
  client has fetched it or 30 days pass.

So both parties always learn the same thing.

### 6.10 Client-side rules
- A signal is active from creation until `interest_ttl_days` (7) after the
  most recent crossing with that peer, or until withdrawn, or until a match
  containing its `(peer, intent)` token is received. Signals to the same peer
  for other intents stay active, and can later be appended to the match.
- **No per-intent limits.** All intents share the `signal_set_size` cap
  (D20). Selecting several intents for one peer is allowed. Each is a real
  signal, and a match reveals only the intent(s) both chose.
- **Withdrawal** takes effect immediately on the device. The signal slot
  frees at once, and the signal is left out of every later upload.
  If tonight's set has already been uploaded, it still contains the token,
  which can still match tonight; the UI says so (§13.6). No withdrawal request
  is ever sent to the server, because its existence would leak the signal.
- **Match verification.** For every uploaded set, the client keeps the real
  tokens it contained, and the `(peer, intent, peer pk, peer uid)` each was
  computed from, until that epoch's `notify_after` has passed and matches
  have been fetched. This applies even if a signal was withdrawn after
  upload. A matched token is accepted only if it equals one of those kept
  tokens, and it maps to that `(peer, intent)`. The peer's current key on the
  card is never used for verification, so a key change after upload cannot
  break the match for one side.
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
  uploads at the next opportunity **before `match_batch_time`** (23:45);
  otherwise that epoch is skipped. Never upload a set for a past epoch. The server rejects
  uploads before the window start (HTTP 425) and duplicates (HTTP 409). The
  client uses the server's current epoch from `GET /v1/config`, never its own
  clock.
- **Presence:** for each past day `d`, the client uploads its padded
  encounter set (§6.13) once, at a random time between 00:05 and 06:00 local
  on day `d+1`, or at next app open before the cutoff (start of day `d+2`).
  It never uploads daily keys, EIDs or sighting times.
- **Digest media:** after fetching a digest, the client downloads **every**
  media item it lists that is not already cached, in a fixed order (sorted by
  media id), whether or not the user ever opens the card.

### 6.12 Versioning
Any change to §6 bumps `protocol_version`, changes the personalization
strings' trailing digits, regenerates vectors, and requires approval. (Before
the first protocol code exists, as for v1.2, §6 may change without a bump.)

### 6.13 Encounter tokens (presence)
Crossings come from **mutual** sightings. A sighting is keyed with a secret
that only the two devices can compute, so listening alone gives nothing. The
server never learns daily keys, EIDs or times.

**Sightings.** While advertising its own EID `a` (interval `i`, private key
`esk_a`), a device that hears EID `b` counts the scan windows in which it
received `b` with RSSI ≥ `ble.rssi_threshold_dbm` (`windows`, 1–15). It drops
`b` if `b` is not a valid public key (§6.5, without the uniqueness rule).
**Midnight rule:** it records nothing while its own interval is the first
(`i = 0`) or the last (`i = 95`) of the day. Both devices are therefore on the
same local day `d` whenever they record each other.

**Dwell and token.** A sighting qualifies when `windows ≥
presence.min_qualified_windows` (4) within that single interval. The best
single sighting counts; counts are never summed, so carrying several
advertisers buys nothing. For each qualifying sighting the device computes:
```
ss = X25519(esk_a, b)                       # MUST reject all-zero
(lo, hi) = sort_bytes_lexicographic(a, b)
E = BLAKE2b(data = day_ascii(10) || lo || hi, key = ss, digest_size = 32,
            person = "mutual-encount01")
```
The other device, hearing `a` while advertising `b`, computes the same `E`.
Without `esk_a` or `esk_b`, nobody can compute it. That includes a sniffer
that heard both EIDs, and the server.

**Upload.** The presence upload for day `d` is the set of distinct qualifying
`E` values, with no window counts. It is padded with CSPRNG dummies to the
next multiple of `encounter_pad_block` (256, at least 256) and shuffled with a
CSPRNG. At most `encounter_max_entries` (1024) entries are sent; if there are
more real tokens, the device keeps those with the most windows.

**Resolution.** The server:
1. stores each set until the cutoff (start of `d+2`);
2. records a crossing for users X ≠ Y **of the same campus** (§4.1) when
   some token appears in exactly their two uploads for day `d`. A token
   uploaded by more than two accounts, or by two users of different
   campuses, is ignored and nothing about it is stored;
3. keeps, for the crossing, only `(day, pair)` and one canonical token: the
   byte-wise smallest shared token.

**Time chip.** For the digest window only, the device keeps a local map from
each uploaded `E` to the coarse block (morning / afternoon / evening / night)
of its sighting. `GET /digest` returns, per peer, only the canonical token,
so the device can show the chip. A client learns at most the time of one
sighting, and the server never learns a time (invariant 4).

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
| Passive BLE sniffer (generic scanner app, or several planted receivers) | Partly | Sees one-time EIDs and that *some* Mutual device is nearby. Encounter tokens are keyed by a secret it cannot compute (§6.13), so it can neither create crossings nor link EIDs to accounts, not even with an account of its own. App presence leaks — accepted. Linking EIDs across rotations through an unchanged device address is checked in the spike (§14.2) |
| Relay attacker or planted device (forwards EIDs both ways in real time, or a phone left at a place) | Accepted risk | A two-way real-time relay can create a crossing between two real users. A phone with an account left at a place gets crossings with people who stay ≥ 4 minutes, a weak "who uses Mutual here" oracle limited by `display_cap` |
| Blocked or unmatched party receiving an "ended" mutual | Accepted risk | Fair delivery means they still see the match and its intent(s), and know the other side ended it. A report filed against the other party from an ended mutual goes to the moderation queue flagged for review, never acted on automatically |
| A pending (not yet notified) match hides its own peer from later digests | Documented limitation | Once a match row exists, §11's "matched the viewer" exclusion applies at the next digest bake, even before `notify_after`. A block or report reaching that peer must then go through an *already-cached* digest snapshot from before the match formed, or through the match once it is notified — never through a freshly-baked digest while the match is still pending |
| Sybil accounts | Mitigated | One account per verified college email |
| Network attacker | TLS only | Dev runs on localhost HTTP; pilot must use TLS |
| **Malicious (active) server** — substituting public keys, forging digests | **Out of scope** | Stated limitation. One substituted key would give an active server every one-sided interest and intent toward that peer, undetectably. Key transparency (a signed, append-only `(user_id, pk)` log) is future work |
| Server operator colluding with a user account | Out of scope | That account can test one-sided interest *toward itself*, silently and retroactively, until the batch deletes the epoch's tokens. Inherent to any scheme where the operator can also be a user. Governance rule: people with operator access hold no account in any pilot deployment |
| Compromised or lost device | Out of scope | Secure storage reduces impact |

### 7.3 What the server learns (by design) and never learns

| Server learns | Server never learns |
|---|---|
| Verified accounts, each user's campus (college), first names, profile text and media | Plaintext email, date of birth |
| The day's **crossing graph**: who crossed whom, at day granularity, retained 7 days. Groups that spent time together show up as clusters, and with a public timetable an operator may guess which class a cluster was | GPS location, any place, or client IP addresses |
| That a user uploaded a signal set (always exactly `signal_set_size` tokens: 7) | Whom a signal targets, or whether any real signal exists |
| That a user uploaded an encounter set, and its size rounded up to a multiple of 256 (a coarse activity level) | Daily keys, EIDs, or the time of day of any crossing |
| Mutual matches (pairs), and how many intents a pair shares | The intent of any signal or match |
| Messages within matches; message counts | Which digest cards a user opened or played |
| Blocks and reports (explicit user disclosures) | Who was near whom at what time |

Presence uploads contain only encounter tokens, with no durations, and are
deleted at the cutoff. The server never receives a daily key, an EID or a
sighting time. It never logs or stores client IP addresses (§9).

A night with **no** qualifying encounters is uploaded as well, as 256 dummy
tokens (§6.13's "at least 256"). Skipping it would make zero the one count the
server could read exactly, and so would tell it which nights a user was near
nobody — ill, off campus, or alone. The table above grants the server the size
rounded up to a multiple of 256; silence is not a size.

### 7.4 Security claims (each must map to a test or a written argument)

- **C1 — Independence.** Take two worlds that differ only in whether user U
  holds a signal for peer V that V does **not** return. The following are
  identical in both worlds, except for the random contents of
  `epoch_tokens.token` before the batch deletes them:
  - the server's stored rows;
  - the request log produced by **every** account (method, path, query, body
    length, status, ordered by time with a mocked clock);
  - the response bodies returned to every account.

  Batch matching (§6.9) removes response timing as a channel, and AC-T2-2
  covers client behaviour. *Test:* `server/tests/test_leak_two_worlds.py`.
  *Argument:* pseudorandomness of keyed BLAKE2b under a key derived from
  X25519 (`docs/SECURITY_ARGUMENT.md`).
- **C2 — Only mutual same-intent interest is ever revealed**, only to the two
  parties, and **always to both**. *Tests:*
  - protocol property tests: a different intent or uid gives a different
    token;
  - server tests: cross-intent signals never match;
  - fair delivery: an unmatch or block at `notify_after` + 1 s still delivers
    the ended match to the other party;
  - before `notify_after`, every account's responses are identical with and
    without the match.
- **C3 — No protocol message, API field, stored column or log line carries an
  intent.** *Test:* `test_route_audit.py` scans request and response schemas
  for any field named or typed as an intent. *Stated limits:* message text
  written by users can reveal an intent, and the number of matched tokens
  reveals how many intents a pair shares (D10).
- **C4 — No location.** *Test:* `app/scripts/check-privacy-invariants.ts`
  asserts the merged Android manifest contains no location permissions and
  `BLUETOOTH_SCAN` carries `neverForLocation`. *Tests:* `test_presence.py`
  asserts the presence upload schema has no key, EID or time field;
  `test_retention.py` asserts 7-day crossing retention. *Argument:* the server
  never receives daily keys, EIDs, sighting times or client IP addresses (§9).
- **C5 — No real-time proximity.** *Test:* a crossing for day `d` is never
  returned by `GET /v1/digest` before `release_time` on day `d+1`. Every
  response between two consecutive release times is identical, apart from
  the viewer's own blocks (`test_digest.py`, using the injected clock).

---

## 8. Safety requirements

- **S1** 18+ only. Date of birth is checked at account creation and discarded;
  under-18 is rejected with a kind message.
- **S2** One account per verified college email, on an open (approved) campus
  (§4.1). Campuses never mix.
- **S3** No messaging before a mutual match. Text only; max 1000 characters;
  30 messages per minute rate limit; no links rendered as links.
- **S4** Block: immediate for the blocker, both directions, silent. Removes
  the peer from the blocker's digest at once and from the blocked person's at
  the next release (§11), deletes shared crossings, deletes the match, and
  hides the conversation. A match already delivered stays visible to the
  other party as "This mutual has ended" (fair delivery, §6.9). They are never
  told it was a block.
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
| Campus | `users.campus_id`, derived from the email domain (§4.1) | Account lifetime |
| Pending campus keys | Key (for example `iitb.ac.in`) and attempt count only | Until approved or rejected by the operator |
| Date of birth | Never stored; `age_verified_at` only | — |
| OTP codes | SHA-256 hash, 10-minute TTL, 5 attempts | Deleted on use/expiry |
| Session tokens | SHA-256 hash | 30 days |
| Presence uploads (padded encounter sets) | Server | Until cutoff (start of `d+2`), then deleted |
| Crossings (`day`, user pair, one canonical encounter token) | Server | 7 days |
| Digest snapshots (materialized peer lists) | Server | Same as crossings (7 days) |
| Epoch tokens | Server | Non-matching tokens deleted when the epoch's matching batch finishes; matched tokens live on the match |
| Matches | Server | Until unmatch, block or account deletion; then kept as `ended` for the other party until fetched or 30 days (§6.9) |
| Messages | Server | Deleted on unmatch/block/deletion (report excerpts retained) |
| Reports | Server | Until resolved + 90 days |
| College applications, including the official's contact email (§4.2) | Server | Unverified: `colleges.unverified_retention_hours` (24 h). Decided: `colleges.decided_retention_days` (180) after the decision |
| Operator passwords | scrypt hash (§11.3) | Until the operator is removed |
| Operator sessions | SHA-256 hash | `admin.session_ttl_hours` (12 h) |
| Operator audit log | Username, action, target, time; never an IP | Deployment lifetime |
| Signals, peer keys, sightings, encounter → time-block map, own daily keys | Device, in the app-private `expo-sqlite` database (§9.1) | Signals: TTL; sightings: until that day's encounter set is uploaded; encounter map: 7 days; daily keys: deleted after that day's upload |
| Session token, identity private key, user id | Device, `expo-secure-store` (Android Keystore) | Until logout or account deletion |

### 9.1 What is in the keystore, and what is not

`expo-secure-store` holds the session token, the device's X25519 **identity**
private key and the user id. Everything else on the device — including the
**daily** keys from which EIDs and ephemeral keys are derived — is in
`mutual.db`, an ordinary app-private SQLite database.

This is stated rather than fixed. Device compromise is out of scope (§7.2):
an attacker with the app's private storage has the database and the keystore
alike, since the app must be able to read both. Moving the daily keys would
buy only resistance to an attacker who can read app-private files but not use
the app's own keystore access, and it would cost a durable index —
SecureStore is a key-value store with no enumeration, and `forgetStaleKeys`
has to be able to list the days it holds. A clear description of where the
keys actually live is worth more than an inaccurate one that sounds stronger.

The identity private key is the exception and is in the keystore, because it
is the one secret whose disclosure is not merely a device compromise: it is
what makes one-sided interest unreadable to the server (claim C1), and it
outlives every daily key. (Decided 2026-10-07, Board Q12; DECISIONS_LOG 30.)

A retention job (`mutual_server.services.retention`) runs at startup and every
hour. Request-path logging is off unless `MUTUAL_ENV=dev`. **Client IP
addresses and user agents are never logged or stored** by the server or by
any proxy in front of it. Uvicorn runs without its access log. Rate limits
keyed on IP use an in-memory hash with a salt that rotates hourly. Backups
exclude `epoch_tokens` and `presence_uploads`. India's Digital
Personal Data Protection Act, 2023 applies to any real deployment; consult the
institution before Tier 3. This spec is not legal advice.

---

## 10. Architecture

```
 ┌─────────────────────────── Android phone ───────────────────────────┐
 │  Expo app (TypeScript)                                               │
 │   ├─ @mutual/protocol (protocol-ts)  ← keys, tokens, EIDs            │
 │   ├─ signals/ (queue + scheduled padded upload)                      │
 │   ├─ presence/ (EID schedule → native; sightings → encounter tokens) │
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
 │   uses mutual_protocol (protocol_py) for key validation and tests    │
 └──────────────────────────────────────────────────────────────────────┘
 sim/ (mutual_sim) — standalone; no dependency on server or app
```

---

## 11. Server API (`/v1`, JSON, bearer session token)

Errors: `400` malformed/semantic, `401` no session, `403` forbidden,
`404` not found, `409` duplicate, `422` validation, `425` too early,
`429` rate limited. Error body `{ "error": "<code>", "message": "<text>" }`. A
duplicate-write race (two concurrent requests both passing the same
check-then-insert guard) still surfaces as `409 conflict` rather than an
unhandled error, never echoing the underlying write.

### Auth and account
| Method & path | Body → response | Rules |
|---|---|---|
| `POST /auth/request-otp` | `{email}` → 204 | The domain must resolve to an open campus (§4.1). Otherwise 400 `not_a_college_email`, or 403 `campus_not_open` for a pending campus, which is recorded for the operator. 60 s resend cooldown applied silently (always 204, the code is simply not re-sent); in dev the code is printed to the console |
| `POST /auth/verify-otp` | `{email, code}` → `{session_token, account_exists}` | Constant-time compare; 5 attempts |
| `POST /auth/logout` | → 204 | Revokes session |
| `POST /account` | `{date_of_birth, identity_pk, first_name, year_of_study?, consent_version?}` → `{user_id}` | 18+ (S1); DOB discarded; `identity_pk` valid per §6.5 (422 otherwise; 409 if already registered); `consent_version` required only in study mode |
| `GET /account/me` | → account summary | |
| `PUT /account/identity-key` | `{identity_pk}` → 204 | For reinstall; valid per §6.5; at most once per `auth.identity_key_change_min_days` (429); documented limitation §6.10 |
| `DELETE /account` | → 202 | S11. Notified matches become `ended` for the other party; pending tokens are dropped blindly at release (§6.9) |

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
| `POST /presence/{day}` | `{encounters:[base64url]}` (§6.13) → 201. `day` must be before today and not past cutoff (400); once per day (409); 422 unless the count is a positive multiple of `encounter_pad_block` and at most `encounter_max_entries`, every entry is 32 bytes, and no entry repeats |
| `GET /digest` | → `{release_day, peers:[{card: PeerCard, last_day, encounter: base64url}], media:[{media_id, bytes, sha256}]}`. See the rules below |
| `GET /media/{media_id}` | Voice notes of peers in the viewer's digest window. A uniform 404 for every id the caller may not access, whether or not it exists |

`GET /digest` rules:
- **A snapshot.** It is computed once per viewer at `release_time` and stays
  byte-identical until the next `release_time`. The only exception is the
  viewer's own blocks, which remove that peer from the viewer's own response
  at once (the viewer's own action, visible to nobody else).
- **One entry per peer** (most recent crossing day only, within
  `lookback_days`), at most `display_cap` per release, ordered by ranking
  (§11.1).
- **Late crossings.** Crossings resolved after a release (a late upload)
  appear at the next release.
- **Exclusions.** The viewer's own blocks and suspended peers are removed
  immediately. Peers who blocked the viewer, paused, deleted their account,
  or matched the viewer are removed at the next release.
- **`encounter`** is the crossing's canonical encounter token, for the
  on-device time chip (§6.13).

`PeerCard = {peer_id, first_name, year_of_study?, identity_pk, prompts:[{prompt_id, text, voice_media_id?, waveform?}]}` — never photos, never counts, never times.

### Signals and matches
| Method & path | Notes |
|---|---|
| `PUT /signals/{epoch}` | `{tokens:[base64url × 20]}` → 201. 400 if `epoch ≠` current; 425 before window start; 400 at or after `match_batch_time`; 409 if exists; 422 if count ≠ 20 or any token ≠ 32 bytes. Only stores the set; matching runs in the nightly batch (§6.9) |
| `GET /matches` | Matches with at least one token past its `notify_after`, showing only such tokens: `[{match_id, state: active\|ended, peer: PeerCard, matched:[{epoch, token}], created_epoch, reveal:{state, policy, messages_needed_each?}, unread}]`. An `ended` match carries the frozen minimal card and no chat or photos (§6.9). Any match id that does not exist, is not the caller's, or is not yet notified gets the same 404 on every `/matches/{id}` route |
| `GET /matches/{match_id}/photos/{index}` | Only if revealed under the active policy (§11.2) |
| `POST /matches/{match_id}/reveal-consent` | Policy C only |
| `GET /matches/{match_id}/messages?after=` | |
| `POST /matches/{match_id}/messages` | `{body}`; S3 |
| `DELETE /matches/{match_id}` | Unmatch; deletes messages |

### Safety, config, dev
| Method & path | Notes |
|---|---|
| `POST /blocks` | `{peer_id}` (allowed pre-match; explicit user disclosure). Acts only on ids in the caller's current digest window or notified matches; any other id gets the same 204 with no effect. The request only records the block; its effect on pending tokens is applied at release (§6.9) |
| `POST /reports` | `{peer_id, reason, message_ids?}`. Same id rule and uniform 204 as blocks |
| `POST /discovery/pause`, `POST /discovery/resume` | S6 |
| `GET /config` | `{campus:{id, name}?, server_time, epoch, protocol_version, reveal_policy, next_policy_change?, signal_upload_window, presence_upload_window, match_batch_time, digest_release_time, interest_ttl_days, ble:{...}, study_enabled}` |
| `POST /dev/clock` | `{offset_seconds}` — **dev only** |
| `POST /dev/crossing` | `{user_a, user_b, day}` — **dev only**, creates a confirmed crossing |
| `POST /dev/seed` | Creates N synthetic users with profiles — **dev only** |
| `GET /dev/demo-accounts` | The accounts the last `demo_seed` run wrote to `server/demo_accounts.json` that still exist, for one-tap login in the dev panel — **dev only**, synthetic only |

### 11.3 Operator console (`/admin`, HTML, outside `/v1`) — v1.5, D25
For the people who run a deployment (§19, Q8). Never used by the app.
- **Operators** are created with `python -m mutual_server.admin operators add <name>`
  or by an owner in the console. Passwords are stored as stdlib scrypt hashes
  (N=2^14, r=8, p=1) and are at least `admin.password_min_length` long. Two roles:
  **owner** (`campus_id` NULL, every campus) and **campus moderator** (one campus:
  its reports, its users, its counts, nothing else; invariant 13).
- **Sessions:** a random 32-byte token in an `HttpOnly`, `SameSite=Strict` cookie scoped
  to `/admin` (`Secure` in prod), stored only as a SHA-256 hash, valid
  `admin.session_ttl_hours`. Every POST carries a per-session CSRF token. Sign-in is
  limited per IP (`admin.login_ip_limit_per_hour`), and an unknown username costs the
  same scrypt check as a wrong password.
- **Pages:** overview (counts per campus only: students, new in 7 days, active mutuals,
  open reports, most-requested unopened colleges); reports (excerpt, resolve, suspend
  the reported user); users (lookup by id only, with no list of all students; suspend and
  lift); colleges (open, decline, edit domains; owners); applications (owners);
  operators (add, disable; owners); audit log (owners); own password.
- **Cannot show:** signals (the server has none in plaintext, §7.3), crossings, digests,
  or messages outside a report's own excerpt. No route takes a user id in its path
  (`test_route_audit.py`).
- **Audit:** every change and every sign-in is written to `admin_audit` (operator
  username, action, target, time). No IP address and no user agent.
- Every page sends `Content-Security-Policy: default-src 'none'; style-src
  'unsafe-inline'; form-action 'self'; frame-ancestors 'none'`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.

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

- `campuses(id, key UNIQUE, name, domains JSON, status[open|pending|rejected],
  attempts, created_at, partner_verified_at NULL)` (v1.5, §4.2)
- `users(id, email_hmac UNIQUE, campus_id, first_name, year_of_study,
  identity_pk, identity_key_changed_at, age_verified_at, discovery_paused,
  suspended_at, created_at, consent_version)`; `identity_pk` is unique.
  Account deletion is a hard delete (S11): there is no `deleted_at` column
  to check, because a deleted account's row does not exist any more
- `otp_codes(email_hmac PK, campus_id, code_hash, expires_at, attempts,
  last_sent_at)` — `code_hash` is HMAC-SHA256 under the server pepper
- `sessions(token_hash PK, user_id NULL until account exists, email_hmac,
  campus_id, expires_at, created_at)`
- `profiles(user_id PK, prompts JSON, tags JSON, updated_at)`
- `media(id, user_id, kind[voice|photo], prompt_id NULL, photo_index NULL,
  path, bytes, sha256, waveform JSON NULL, duration_ms NULL, created_at)`
- `presence_uploads(user_id, day, uploaded_at)`, PK `(user_id, day)`
- `encounters(day, token, user_id)`, index on `(day, token)` — one row per
  uploaded entry, deleted at cutoff with the upload
- `crossings(day, user_lo, user_hi, token, created_at)`, PK
  `(day, user_lo, user_hi)` — `token` is the canonical encounter token,
  returned only to the crossing's own two users in the digest
- `digest_snapshots(user_id, release_day, peers JSON, created_at)`, PK
  `(user_id, release_day)` — the materialized peer list (`[{peer_id,
  last_day, token}]`) behind "byte-identical until the next release"
  (§11); built once, lazily, on first access after a release instant
- `epoch_tokens(epoch, user_id, token)`, index on `(epoch, token)`; unique
  `(epoch, user_id, token)`; one set per `(epoch, user_id)` enforced via
  `signal_uploads(epoch, user_id PK, uploaded_at)`
- `matches(id, user_lo, user_hi, created_epoch, policy, revealed_at NULL,
  ended_at NULL, ended_by NULL, frozen_card JSON NULL,
  ended_seen_by_other_at NULL)`; unique active pair. Ended matches are
  deleted once the other party has fetched them, or after 30 days
- `match_tokens(match_id, epoch, token, notify_after, notified)` — pending
  (`notified=False`) until the release step evaluates it at `notify_after`;
  the batch only ever inserts rows here, never mutates an existing one
- `reveal_consents(match_id, user_id)`
- `match_reads(match_id, user_id, read_at)` — the `unread` flag in
  `GET /matches` (§11): set on every `GET .../messages` call
- `messages(id, match_id, sender_id, body, created_at)`
- `blocks(blocker_id, blocked_id, created_at)`
- `reports(id, reporter_id, reported_id, reason, excerpt JSON, status,
  created_at, resolved_at)`
- `operators(id, username UNIQUE, password_hash, campus_id NULL, created_at,
  disabled_at NULL)` (v1.5, §11.3); `operator_sessions(token_hash PK, operator_id,
  csrf, expires_at, created_at)`; `admin_audit(id, operator, action, target,
  created_at)`
- `college_applications(id, college_name, domain, contact_name, contact_role,
  contact_email, note, status[unverified|verified|approved|rejected], code_hash NULL,
  code_expires_at NULL, code_attempts, created_at, verified_at NULL, decided_at NULL,
  decided_by NULL)` (v1.5, §4.2)

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
- Signals full: "All 7 signals are out. Withdraw one to send another."
- Withdrawn, before tonight's upload: "Signal withdrawn. Nobody was ever told."
- Withdrawn, after tonight's upload: "Signal withdrawn. It already left with tonight's set, so it could still match tonight. From tomorrow it's gone."
- Ended mutual (Mutuals row): "This mutual has ended." No chat, no photos.
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
`POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `RECORD_AUDIO`, and
`BLUETOOTH_CONNECT`. Location permissions are blocked via the Expo config
(`android.blockedPermissions`).

`BLUETOOTH_CONNECT` is listed only because `BluetoothAdapter.isEnabled()`
requires it from API 31, and that call is how the app tells a user "Bluetooth is
off" instead of silently failing to discover anyone. Mutual never connects to a
device, never pairs, and never reads a device name. The app does not request any
other permission for a reason it cannot name on the permissions screen.

Android Auto Backup is **off** (`android:allowBackup="false"`). The BLE module
keeps its undrained sighting table in `SharedPreferences`, so with backup on,
EIDs and 15-minute interval indices would be uploaded to a third party — which
§7.3 says the system never produces, and §4 already rules out by saying there is
no key escrow and no backup.

Verify exact names against current Android documentation for the installed
target SDK and record them in the Progress log.

### 14.2 Advertisement
Non-connectable advertisement with manufacturer-specific data: company id
`0xFFFF` (Bluetooth SIG test id — **not for shipping products**; acceptable
for a research prototype, decision D17). Payload =
`magic(0x4D 0x55) || payload_version(1) || EID(32)` = 35 bytes. That is more
than a legacy advertisement can carry (at most 27 bytes of manufacturer data),
so **BLE 5 extended advertising is the only supported layout** (Android
`AdvertisingSet`, `setLegacyMode(false)`), carrying the full 35-byte payload.
A device that cannot do extended advertising is **not supported**: the app says
so plainly on the You screen and takes no further part in discovery.

The split-advertisement fallback that v1.0–v1.3 specified here — `magic ||
version || EID[0:24]` in the advertisement, `EID[24:32]` in the scan response,
joined by the scanner — **is withdrawn**, because it cannot be received.
Android parses manufacturer-specific data into a map keyed by company id, and
both halves used `0xFFFF`, so the scan response overwrote the advertisement and
the scanner never saw a 32-byte id. A device on that path advertised correctly
and heard nothing, silently (DECISIONS_LOG 29 and 30).

It is withdrawn rather than repaired because repairing it means changing what
goes on air — a different company id for the tail, or moving the tail into a
service-data element — which is a protocol change under invariant 8, for a
fallback whose purpose was to support phones older than the ones this is for.
Android 12 is already the floor (D1), and BLE 5 reached mid-range Android some
years before Android 12 did. The honest cost is stated in
`docs/THREAT_MODEL.md` §5 and on the You screen rather than hidden behind a
path that does not work.

The spike (Phase 9a) still measures whether extended advertising is delivered
under `neverForLocation` without a location permission. If it is not, stop and
escalate.
Low-power advertise mode; TX power from config. On each 15-minute EID rotation the
module stops advertising, waits for the new random device address, and
restarts. Whether the address really changes with the EID is verified in the
spike. If it does not, a sniffer can link EIDs across rotations, and that is
escalated as a spec decision. Advertising stops whenever no EID exists for the
current interval.

### 14.3 Scanning
Duty-cycled inside the foreground service: scan `ble.scan_window_seconds` (8)
every `ble.scan_period_seconds` (60). A `ScanFilter` on manufacturer id
`0xFFFF` with the magic+version prefix is mandatory (Android pauses
unfiltered scans when the screen is off). Own EIDs are dropped.

### 14.4 Sighting aggregation and dwell
Per pair (own EID being advertised, heard EID) the module keeps `windows`:
the number of scan windows in which the heard EID was received with RSSI ≥
`ble.rssi_threshold_dbm`. RSSI itself never leaves the device. TypeScript
drains these pairs, applies the midnight rule and the per-interval dwell
threshold `presence.min_qualified_windows` (4), computes encounter tokens for
the qualifying ones (§6.13), records each token's coarse time block locally,
and deletes the raw pairs after upload. A **crossing** requires both devices
to have uploaded the same token, so each side's own dwell check passed.

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
`study.approval_reference` to be non-empty and `study.campuses` to list at
least one open campus; otherwise the server refuses to start
(`test_study_gate.py`). Study mode, consent screens and exports apply only to
users of the listed campuses (§4.1). `study/APPROVAL.md` must record the approving
body, reference number, date and conditions. Permission from the relevant
institutional authority is also required before recruitment.

**Design.** Switchback ABAB over four 2-week blocks: M, C, M, C (order fixed
in `study/PREREGISTRATION.md` before the first study day and committed to
git). Participants: consenting adults with verified college email. Users are
told the active policy in-app. Participants can withdraw at any time from
settings, which deletes their data.

**Declining is not a barrier to using Mutual.** On a study campus, someone who
does not consent still gets an account and the ordinary app; the server records
no `consent_version` for them and they are absent from every study outcome.
`POST /account` therefore does **not** require a consent version — an earlier
version of this spec made an account impossible without one, which would have
made consent a condition of using a campus social app, and consent obtained
that way is not freely given.

Two things follow, and both are stated on the consent screen rather than
implied. The reveal policy is a **campus-wide** setting, so it changes during
the study for everyone on that campus, participant or not; that is a change to
the product they are using and they are told about it either way. And a person
who declines is not asked again during the block — the app does not re-prompt,
because repeated asking is pressure. (Decided 2026-10-07, Board Q9;
DECISIONS_LOG 30.)

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
- Pilot deployment (v1.5): Docker, Caddy (free Let's Encrypt certificates), any free SMTP
  account, EAS Build free tier or a local Gradle release build. `docs/DEPLOYMENT.md`.

---

## 18. Configuration

### `server/config.example.yaml` (copied to `server/config.yaml`, which is gitignored)
The authoritative, complete file is `server/config.example.yaml`. Phase 3
added `database`, `email`, `profile` and extra `media` keys there (every
tunable number lives in config, CLAUDE.md §6). The essentials:
```yaml
timezone: Asia/Kolkata
database:
  url: sqlite:///server/mutual.db
secrets:                      # set via environment variables in practice
  email_pepper_env: MUTUAL_EMAIL_PEPPER
email:
  mode: console               # console (dev/test only; refused in prod) | smtp
campuses:                     # pre-approved colleges (§4.1); more are approved with the admin CLI
  - key: example.ac.in
    name: "Example College"
    domains: ["example.ac.in"] # subdomains are included automatically
auth:
  academic_suffixes: ["ac.in", "edu.in", "edu"]   # unknown domains with these become pending campuses
  otp_ttl_seconds: 600
  otp_max_attempts: 5
  otp_resend_cooldown_seconds: 60
  session_ttl_days: 30
  min_age_years: 18
  identity_key_change_min_days: 30
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
  match_batch_time: "23:45"
  interest_ttl_days: 7
reveal:
  default_policy: M
  policy_schedule: []         # [{start: YYYY-MM-DD, end: YYYY-MM-DD, policy: M|C}]
  conversation_messages_each: 8
  ended_match_retention_days: 30   # §6.9: "until... fetched or 30 days pass" fallback
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
  campuses: []                # study mode applies only to these campus keys
admin:                        # v1.5, §11.3; defaulted if absent
  session_ttl_hours: 12
  login_ip_limit_per_hour: 10
  password_min_length: 12
colleges:                     # v1.5, §4.2; defaulted if absent
  apply_ip_limit_per_hour: 5
  verify_ip_limit_per_hour: 20
  code_ttl_seconds: 1800
  code_max_attempts: 5
  unverified_retention_hours: 24
  decided_retention_days: 180
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
  including:
  - pair-key symmetry over 1 000 random key pairs;
  - all-zero shared secret rejected; identical keys or identical uids
    rejected;
  - the pair key changes when either uid changes;
  - low-order and non-canonical public keys rejected by the validity check;
  - tokens differ when pair, epoch or intent differ (≥ 5 000 tokens, zero
    collisions);
  - padded set has exactly 7 entries of 32 bytes, contains every real
    token, and raises on > 20 real tokens;
  - EIDs: 96 distinct valid public keys per daily key;
  - encounter token symmetry: both devices compute the same token;
  - a different day or EID gives a different token;
  - computing it with a wrong private key gives a different token, so a party
    that only heard both EIDs cannot reproduce it;
  - low-order heard EIDs are rejected;
  - the padded encounter set is a multiple of 256 (at least 256, at most
    1024), contains every real entry, and raises above 1024 real entries;
  - the midnight rule flags intervals 0 and 95;
  - all constants loaded from `constants.json`.
- **AC-T1-2 Vectors.** `python -m mutual_protocol.vectors --out
  packages/protocol-spec/vectors.json` generates ≥ 100 deterministic cases
  covering pair key, token, EID, encounter token, key validity and
  base64url; the committed file equals a fresh regeneration.
- **AC-T1-3 Protocol (TypeScript).** `npm test -w packages/protocol-ts`
  reproduces every vector byte-for-byte and passes the same property tests.
- **AC-T1-4 Server functional.** `pytest server` passes, covering: OTP flow
  (TTL, attempts, cooldown, constant-time compare); campuses (§4.1): listed
  domains and their subdomains map to their campus, an unknown academic
  domain becomes pending (403) until approved, a non-college domain gets 400,
  a token shared across campuses creates no crossing and stores nothing, and
  no digest, signal or match ever spans two campuses; under-18
  rejected and DOB not persisted; identity keys rejected when duplicate,
  low-order or non-canonical, and key changes rate-limited; `request-otp`
  always 204 for an allowed domain.
  - Presence:
    - upload rules: past day only, cutoff, once per day, size a multiple of
      256 and at most 1024, no repeated entries;
    - the schema has only encounter tokens: no key, EID, window or time
      field;
    - a crossing requires a token uploaded by exactly those two users;
    - a token in one upload creates no crossing;
    - a token in three or more uploads is ignored;
    - only the canonical token is kept on the crossing.
  - Digest:
    - a byte-identical snapshot between release times;
    - one entry per peer, respecting `display_cap`;
    - exclusions and their timing as in §11;
    - a late-resolved crossing appears at the next release.
  - Signals:
    - upload rules (400/409/422/425);
    - `PUT /signals` does not match;
    - the batch matches on a shared token, never across intents;
    - non-matching tokens are deleted after the batch;
    - a new shared intent is appended to an existing match.
  - Fair delivery:
    - `notify_after` = next release time;
    - every match token is pending until its own `notify_after`, and
      `GET /matches` hides it until then;
    - a block, unmatch or account deletion before a token's `notify_after`
      drops it blindly at release;
    - after `notify_after`, an unmatch, block or account deletion leaves an
      `ended` match with a frozen card for the other party;
    - a block request's response does not depend on any pending match.
  - Other: uniform 404 on `/media`; block and report act only on known ids;
    photo gating under M and C; reveal consent; message limits; unmatch
    deletes messages; report copies excerpts; account deletion cascades.
- **AC-T1-5 Leak test (C1).** `server/tests/test_leak_two_worlds.py` passes:
  worlds A (U signals V for `date`, V does not signal back) and B (U signals
  no one) produce, for **every** account:
  - identical row counts, and identical rows except `epoch_tokens.token`
    bytes;
  - identical request logs (method, path, query, body length, status);
  - identical response bodies, before and after the batch.

  A third world C (V signals U back) produces a match. It is visible only
  from `notify_after`, and before that every response is identical to world
  B, which proves the test is not vacuous.
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
  uploads before the window, never twice per epoch, never for a past epoch,
  never at or after `match_batch_time`;
  match resolution token → (peer, intent); match verification accepts only
  tokens kept from that epoch's uploaded set (still recognised after a
  withdrawal or a peer key change); a withdrawal frees its slot
  instantly and sends no request; encounter tokens and the
  padded encounter set are built through protocol-ts, and no daily key, EID or
  time is ever passed to `api/client.ts`; prefetch fetches every listed media
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
packages/protocol_py/mutual_protocol/{__init__,constants,encoding,keys,tokens,eid,encounter,vectors}.py
packages/protocol_py/tests/{test_constants,test_keys,test_tokens,test_eid,test_encounter,test_encoding,test_vectors}.py
packages/protocol-ts/{package.json,tsconfig.json,vitest.config.ts}
packages/protocol-ts/src/{index,constants,encoding,keys,tokens,eid,encounter,random}.ts
packages/protocol-ts/test/{vectors,properties}.test.ts
server/{pyproject.toml,config.example.yaml,alembic.ini}
server/migrations/{env.py,script.py.mako,versions/}     (Alembic)
server/mutual_server/{__init__,main,config,clock,ids,db,models,security,errors,deps,schemas,admin,demo_seed}.py
server/mutual_server/web/{__init__,html,admin,colleges}.py      (operator console §11.3, college applications §4.2)
server/deploy/{Dockerfile,start.py,docker-compose.yml,Caddyfile,config.prod.example.yaml,env.example}   (docs/DEPLOYMENT.md)
.dockerignore
server/mutual_server/data/prompts.json
server/mutual_server/routers/{auth,account,profile,presence,digest,signals,matches,messages,safety,config_route,dev}.py
server/mutual_server/services/{campus,resolution,matching,ranking,digest,arms,cards,retention,email,media,rate_limit,operators,colleges}.py
server/tests/{conftest,test_app,test_auth,test_account,test_profile,test_presence,test_digest,test_signals,test_matches,test_reveal,test_messages,test_safety,test_retention,test_leak_two_worlds,test_route_audit,test_study_gate,test_costs,test_rate_limit,test_admin_web,test_colleges,test_email,test_migrations}.py
sim/{pyproject.toml,config.yaml}
sim/mutual_sim/{__init__,population,copresence,policies,behaviour,metrics,run,sweep,report}.py
sim/tests/{test_metrics,test_determinism,test_policies}.py
sim/results/report.md  sim/results/figures/            (generated)
app/{package.json,app.json,app.config.ts,eas.json,tsconfig.json,eslint.config.js,jest.config.js,babel.config.js,metro.config.js}
app/plugins/withBleNeverForLocation.js                   (local Expo config plugin, §14.1)
app/src/signals/deploymentClock.ts                      (deployment wall clock, §6.3, §6.11)
app/app/...                                              (routes listed in §13.2)
app/src/api/{client,endpoints,types}.ts
app/src/design/{tokens,typography,motion,theme,primitives,icons}.ts(x)
app/src/dev/protocolSelfTest.ts                          (in-app vector check, §13.1)
app/src/components/{CrossingCard,VoicePlayer,VoiceRecorder,SignalSheet,SafetySheet,SignalDots,GenerativeAvatar,RevealMoment,ChatBubble,IntentChip,EmptyState,PrivacyRow}.tsx
app/src/signals/{db,ttl,setBuilder,scheduler,upload}.ts
app/src/presence/{bleAdapter,nativeBle,fakeBle,dailyKeys,schedule,drain,encounters,upload}.ts
app/src/digest/{prefetch,cache,useDigest}.ts
app/src/matches/{resolve,photo}.ts
app/src/onboarding/{store,identity}.ts                     (signup state and keys, §6.4)
app/src/storage/{secure,localDb}.ts
app/modules/mutual-ble/                                  (Expo local module: index.ts, expo-module.config.json, android/…Kotlin)
app/scripts/{check-privacy-invariants,check-contrast}.ts
app/__tests__/                                           (jest tests for AC-T2-2)
docs/{THREAT_MODEL,SECURITY_ARGUMENT,E2E_CHECKLIST,BLE_SPIKE,INTERVIEW_QUESTIONS,RUNNING_LOCALLY,DEPLOYMENT,COLLEGE_ONBOARDING}.md
docs/design/prototype.html                               (approved visual reference, §13.9)
docs/DECISIONS_LOG.md                                    (every question, issue, idea and decision, in plain words)
docs/design-decisions/                                   (generated walkthrough, Phase 13)
study/{PREREGISTRATION,CONSENT,PARTICIPANT_INFO,ETHICS_APPLICATION_DRAFT}.md       (Tier 3)
study/APPROVAL.md                                        (written by the human, only after approval)
study/analysis/{analyze,make_synthetic_export}.py  study/analysis/synthetic_export.csv
study/analysis/requirements.txt                          (statsmodels, for the model in §16)
study/analysis/export.py                                 (GATED: written only after approval exists, invariant 9)
```

---

## 21. Decisions log (pre-resolved — change only via approval)

| # | Decision | Rationale |
|---|---|---|
| D1 | Android only, minSdk 31 | iOS background BLE advertising is too restricted for reliable phone-to-phone discovery without special entitlements; Android 12+ lets BLE scanning avoid location permission |
| D2 | No GPS, BLE only | Location is the most dangerous asset; BLE proximity is enough for "people you were near" |
| D3 | Next-morning digest, never live | Kills real-time tracking and "who is that person right now" harassment |
| D4 | Fixed-size padded signal set, once per epoch, random time in window | Makes volume and timing independent of interest (C1) |
| D5 | Server resolves crossings from mutual, secret-keyed encounter tokens and learns only the day-granularity crossing graph (revised v1.2, v1.3) | Distributing daily keys to clients lets any user track anyone with a BLE scanner. Giving them to the server (v1.0) let the operator rebuild a 15-minute proximity graph and attribute sniffed EIDs. Unkeyed tokens (v1.2) let a listen-only sniffer with an account forge crossings. Tokens keyed by an X25519 secret between the two devices fix all three |
| D6 | Intents are private and per-signal; never shown on profiles | Showing "open to dating" would reintroduce the signalling stigma the product removes |
| D7 | No swipe UI; prompt-first cards | Swiping rewards snap visual judgement — the behaviour that concentrates attention |
| D8 | Text answer required; voice optional | Accessibility (deaf and hard-of-hearing users) and lower barrier |
| D9 | Field pilot compares M vs C only; P is simulation-only | Showing photos at discovery to real users would break the product promise for everyone in that arm |
| D10 | No end-to-end encrypted chat in v1 | Reports need verifiable excerpts; E2E would need a separate reporting design. Stated limitation |
| D11 | Whole app 18+ | Removes the risk of minors in a co-presence app with a date intent |
| D12 | Emails stored only as HMAC | Data minimisation; honest about its limits (§9) |
| D13 | Matching runs in one nightly batch; matches are delivered at the next release time, to both parties (revised v1.2) | Removes timing correlation between an upload and a notification, and stops one party from detecting a match and erasing it before the other sees it |
| D14 | 7-signal cap (reduced from 20, 2026-10-09) | Bounds the padded set, limits probing ("signal everyone to see who likes me") and discourages volume behaviour. Lowered once Tier 2 was running: 20 free, revocable, undetectable signals a night was a wide enough net to make the cap nearly meaningless as a limit on probing |
| D15 | Unmatch deletes the conversation (report excerpts kept) | Gives users a clean exit; preserves evidence when it matters |
| D16 | One account per verified college email | Sybil resistance without collecting ID documents |
| D24 | One server, many colleges; each campus is a closed partition; new colleges open after a one-time operator approval (§4.1) | The human's choice (2026-10-05): "make it for all colleges, people see only their college". Approval because `.ac.in` and similar suffixes also cover some schools, and age is self-declared |
| D25 | Colleges can apply officially at `/colleges`, proving an address at their domain; operators work in a web console at `/admin` with owner and campus-moderator roles and an audit log; a single-server deployment kit (§4.2, §11.3, v1.5) | The human asked on 2026-10-23 for official college access, admin controls, test accounts and deployment, "without looking back". Every opening still needs an operator (D24). Moderators give partner colleges a safety role without seeing other campuses. The applicant's work email is stored in plaintext so they can be answered, deleted on a schedule |
| D17 | BLE company id 0xFFFF (SIG test id) | Free and acceptable for a prototype; must change before any public release |
| D18 | Ranking never uses signal, match or attention data | Impossible by design and must stay identical across reveal policies |
| D19 | The app's interface matches `docs/design/prototype.html` exactly (§13.9) | Interface quality is the human's top priority; approved 2026-10-05 |
| D20 | No per-intent limits; all five intents share the 7-signal cap (§6.10) | Considered and withdrawn the same day (2026-10-05): "date one person at a time", and "hold other date signals while a date mutual is active". Signals are free and withdrawable, so there is nothing to protect. Any per-intent limit could only be enforced by the app, and simplicity wins. The hold idea is parked in PLAN.md "Deferred improvements" |
| D21 | Pair keys bind both account ids; identity keys must be valid and unique (§6.5) | A copied public key could otherwise redirect signals meant for its owner |
| D22 | The server never logs client IP addresses or user agents (§9) | Campus Wi-Fi addresses map to buildings, which would leak location |
| D23 | EIDs are 32-byte one-time X25519 public keys, carried by **BLE 5 extended advertising only** (§6.8, §14.2) | Required for keyed encounter tokens (D5). The legacy split-advertisement fallback was withdrawn on 2026-10-07: it cannot be received, because Android collapses two manufacturer-data structures that share a company id. Repairing it would change the bytes on air for the sake of phones older than the Android 12 floor. If the Phase 9a spike shows extended advertising is not delivered under `neverForLocation`, the fallback is the v1.0 server-side resolution with its operator visibility stated honestly — a spec decision for the human (DECISIONS_LOG 30) |

---

## 22. Open questions for the human

Answer these by editing this section (and the config) before the phase that
needs them. The agent must not guess them.

- **Q1 (resolved 2026-10-05)** All colleges, each its own closed campus;
  a new college opens after one operator approval (§4.1, D24).
- **Q2 (resolved 2026-10-05)** Timezone `Asia/Kolkata` confirmed.
- **Q8 (resolved 2026-10-07)** Operator access in a pilot is held by the
  student running it and the supervisor, and **neither holds a participant
  account on that deployment**. §7.2 records why no technical fix is possible:
  an operator who is also a user can test interest directed at themselves,
  silently, until the batch deletes the epoch's tokens. It is therefore a rule,
  written into `study/ETHICS_APPLICATION_DRAFT.md` §6 as a commitment the
  committee can hold the applicant to, and stated rather than pretended away.
  If the pilot needs the person running it to use the app, they use a separate
  deployment — not a separate account.
- **Q7 (resolved 2026-10-05)** Python version: 3.11 is used. On the
  development laptop it is provided by uv (`uv venv --seed --python 3.11`),
  because `py -3.11` does not find uv-managed interpreters.
- **Q3 (before Phase 9)** Do you have access to two physical Android 12+
  phones for the BLE spike? If not, Tier 2 ships with the fake adapter only and
  AC-T2-6 is deferred.
- **Q4 (open, before Phase 12 — only the human can answer this)** Will you
  pursue the field pilot? Which ethics body approves research with students at
  your institution, and what is its timeline? This cannot be answered from
  inside the project: it names a real committee at a real institution, and
  invariant 9 turns on `study/APPROVAL.md` recording that committee's actual
  reference. Nothing in this repository may stand in for it.

- **Q9 (resolved 2026-10-07)** Declining consent on a study campus no longer
  costs the account. See §16: `POST /account` records a `consent_version` when
  one is given and creates the account either way, and the consent screen
  offers "Use Mutual without taking part". Consent that is the price of using a
  campus social app is not freely given.
- **Q5 (resolved 2026-10-05)** The five intents are confirmed as study,
  project, fitness, friend, date, with the codes in §6.2. They are protocol
  constants; changing them later means a protocol version bump.
- **Q6 (before Phase 11)** Where will the server run for any demo with more
  than one phone (laptop on the same Wi-Fi is the default)?
