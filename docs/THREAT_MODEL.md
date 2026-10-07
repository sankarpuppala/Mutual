# Threat model — Mutual

Status: Tier 1 document. Expanded from `SPEC.md` §7, which stays the
normative source. Where this file and `SPEC.md` §7 disagree, `SPEC.md` wins
and this file is wrong.

Mutual is an **unaudited research prototype**. It has not been security
audited, it is not production software, and nothing in this document should be
read as a guarantee to a user. The point of the document is the opposite: to
be precise about what is defended, what is not, and why.

---

## 1. What the system is, in one paragraph

Students install Mutual on an Android phone. The phone broadcasts a rotating,
meaningless 32-byte ephemeral id over Bluetooth Low Energy and listens for
other phones doing the same. It never uses GPS. Each night the phone turns the
ids it heard into **encounter tokens** — values that only the two phones
involved can compute, because each is keyed by an X25519 secret derived
between them — and uploads a fixed-size, padded set of them. The server pairs
up tokens that two accounts both uploaded and learns, at day granularity, who
was near whom. The next morning each student sees yesterday's crossings, with
no place and no exact time, and can send a private **signal** to any of them
for one of five intents. Signals never leave the phone individually: each
evening the phone uploads exactly 20 **interest tokens**, padded with random
values, at a random time. The server intersects the sets. A pair that both
signalled the same intent is told the next morning; nobody else learns
anything, including the server.

---

## 2. Assets, in order of how much harm their disclosure does

| # | Asset | Why it is first, or not |
|---|---|---|
| 1 | **One-sided interest** — that A signalled B, when B did not signal back | The single most socially dangerous fact in any dating or connection app. Its disclosure causes humiliation, harassment, outing, and in some settings physical danger. It is also the fact every conventional app stores in plaintext. Protecting it is the project's reason to exist |
| 2 | **The intent of a signal or match** | "A wanted to date B" is a different disclosure from "A wanted a study partner". Intent leakage re-creates the stigma the product is built to remove, and can out someone's orientation |
| 3 | **Location and routine** | Where a student sleeps, when they are alone, which route they walk. This is what enables stalking. Mutual's answer is to never collect it: no GPS, no place names, no times finer than a quarter of a day, nothing live |
| 4 | **Pre-reveal photos** | Withholding photos until a match is a product decision (RQ2), but it is also an anti-harassment measure: a face plus a first name plus a campus is enough to find someone |
| 5 | **Messages** | Sensitive, but both parties chose to send them, to a known person, after a mutual match. Chat is not end-to-end encrypted (decision D10) and the documentation says so plainly |
| 6 | **The fact that a person uses Mutual at all** | Lowest, but not zero. A BLE listener can tell that *some* Mutual device is nearby. Accepted and documented (§5 below) |

---

## 3. Adversaries

The table in `SPEC.md` §7.2 is normative; this section explains each entry in
plain language and says what the defence actually is.

### 3.1 In scope, and primary: the honest-but-curious server operator

A person with the full database, every log line, and the source code, who runs
the protocol correctly but reads everything they can. This is the adversary
claims C1–C5 are stated against, for two reasons: it is the realistic one (a
student-run server, a university IT department, a future acquirer), and it is
the one conventional apps lose to completely.

What they get by design: verified accounts and their campus, first names,
profile text and media, the day's crossing graph (7 days), the fact that a
user uploaded a signal set of exactly 20 tokens, the fact that a user uploaded
an encounter set whose size is rounded to a multiple of 256, mutual matches
and how many intents each matched pair shares, and messages inside matches.

What they do not get, and the mechanism:

| They never learn | Because |
|---|---|
| Whether any particular signal exists, or whom it targets | An interest token is `BLAKE2b(key = pair key, epoch ‖ intent)`. Without one of the two private keys the token is indistinguishable from random, and the set is padded to exactly 20 with random values and uploaded at a random time, once per epoch (`SPEC.md` §6.7, §6.11) |
| The intent of any signal or match | Intent is an input to the token hash and appears nowhere else — no field, no column, no log line (claim C3) |
| GPS location, any place, any client IP | Never requested, never sent, never logged. uvicorn runs with `--no-access-log` in every environment (D22) |
| Daily keys, ephemeral ids, RSSI, or the time of day of a crossing | They are never uploaded. The phone does the derivation and uploads only the final tokens (`SPEC.md` §6.13) |
| Who was near whom at what time | Crossing rows carry a day, not a timestamp. The quarter-of-a-day time chip shown in the app is computed on the device from its own local log and never uploaded |
| Which cards a user opened, played or scrolled past | The digest's media is prefetched in full, in a fixed order, before the UI renders anything (invariant 1). There is no per-card request to observe |

The important subtlety is that "never learns" here means *information-theoretically
or cryptographically*, not "we chose not to write it down". A signal set
containing one real token and a set containing zero real tokens are the same
size, sent at the same kind of time, and differ only in bytes the operator
cannot distinguish from random. That is the claim the two-worlds test checks
end to end.

### 3.2 In scope: another student using the ordinary app

Curious, probing, or actively harassing. Someone who wants to know whether a
specific person is interested in them, or where that person is.

Defences: there is no API that answers a question about another user before a
mutual match exists (invariant 10, enforced by `test_route_audit.py`); a
signal produces no observable effect of any kind unless it is returned; the
cap of 20 signals per epoch limits mass probing; the digest is next-morning
only, so the app cannot be used to locate anyone; times are coarse and places
absent; block and report are always available and always return the same
response whether or not the target exists.

The honest limitation: a student who signals the same person every day for
weeks and eventually matches learns nothing they did not already know. But a
student who matches with someone *can* infer that the other side signalled
them — that is the entire point of a mutual match, and it is consensual by
construction because the inference requires their own signal too.

### 3.3 Partly in scope: a passive Bluetooth sniffer

A generic scanner app, or a few cheap receivers planted in a corridor.

What it sees: that a Mutual device is nearby, and a 32-byte ephemeral id that
changes every 15 minutes. What it cannot do: compute an encounter token, because
the token is keyed by an X25519 secret between the two *participating* devices
(D5). This is the reason the design moved away from unkeyed tokens: with
unkeyed tokens, a listen-only sniffer that also held an account could forge a
crossing with anyone it heard. It now cannot, even with an account.

Accepted leak: the presence of the app itself. A sniffer learns "a Mutual user
walked past here". Mitigating that would mean abandoning BLE discovery
entirely.

Open item verified by measurement, not assumption: whether Android rotates the
underlying BLE device address when advertising restarts. If it does not, a
sniffer could link ephemeral ids across rotations and track a device for as
long as it stays in range — defeating the rotation. This is explicitly tested
in the Phase 9a spike (`SPEC.md` §14.2, `docs/BLE_SPIKE.md`) rather than
assumed to be fine.

### 3.4 Accepted risk: relay and planted devices

A device that forwards ephemeral ids between two places in real time can make
two strangers appear to have crossed. A phone with a real account left in a
café collects crossings with everyone who stays near it for four minutes or
more, which is a weak "who uses Mutual here" oracle, bounded by the 40-peer
display cap.

Neither is defended against. Doing so would need distance bounding or a
trusted timestamp, which is out of scope for a student prototype. The harm
ceiling is low: a false crossing produces an extra card in a digest, and the
planted-phone oracle reveals app usage, which §2 already ranks last.

### 3.5 Accepted risk: the blocked or unmatched party

Fair delivery (invariant 12) means a match, once notified, cannot be erased
for one side. If A unmatches or blocks B one second after the notification, B
still receives the match as `ended`, with its intents and a frozen minimal
card.

This is a deliberate trade against a worse alternative. If a block could erase
a notified match, then the *absence* of an expected match would itself be a
signal, and worse, one party could unilaterally rewrite the other's history.
The cost is that B learns A matched them and then ended it. A report filed
from an ended match goes to the moderation queue flagged for human review and
is never acted on automatically.

### 3.6 Documented limitation: a pending match hides its own peer

Once a match row exists — before anyone is told — `SPEC.md` §11's "already
matched the viewer" exclusion removes that peer from the next freshly baked
digest. A user who wants to block or report that peer during the pending
window must reach them through an already-cached digest snapshot from before
the match formed, or through the match once it is notified. They are never
left without a route to block, but the route is narrower for a few hours.

### 3.7 Mitigated: Sybil accounts

One account per verified college email address, with a 403-until-approved gate
for unknown academic domains and operator approval before a new college opens
(§4.1). This stops casual mass-account creation; it does not stop a determined
attacker with access to many real student addresses.

### 3.8 Out of scope, and why each is stated rather than hidden

| Out of scope | What an attacker gains | Why it is out of scope |
|---|---|---|
| **Malicious (active) server** | Substituting one public key gives the operator every one-sided interest and intent directed at that peer, undetectably, forever | Defending it needs key transparency: a signed, append-only log of `(user_id, public key)` that clients audit. That is a project of its own. **This is the single largest residual risk and the honest headline limitation of the whole design** |
| **Operator colluding with a user account** | That account can silently test one-sided interest *toward itself*, retroactively, until the batch deletes the epoch's tokens | Inherent to any scheme where the operator can also be a participant. The governance answer, not a technical one: people with operator access hold no account in a pilot deployment |
| **Network attacker** | Everything, over plain HTTP | Dev runs on localhost HTTP. A pilot must use TLS. Not a protocol property |
| **Compromised or lost device** | The device's own signals, keys and local sighting log | Secure storage (Android Keystore-backed) reduces impact. Full device compromise is unwinnable at this layer |
| **Traffic analysis by a global passive observer** | Who uses the app, when, and roughly how active they are | Padding and random upload times are inside the protocol; hiding the connection itself needs a mixnet |

---

## 4. Trust assumptions, stated as assumptions

1. The server follows the protocol. If it does not (§3.8 row 1), claims C1–C5
   do not hold.
2. The two phones in a crossing both run honest client code. A modified client
   can lie about what it heard; it still cannot forge a token for a device it
   never heard.
3. X25519 and keyed BLAKE2b behave as standard primitives. No cryptography in
   this project is home-made (invariant 7); the Python side uses `cryptography`
   and `hashlib`, the TypeScript side `@noble/curves` and `@noble/hashes`, and
   the two are held byte-identical by a committed vector suite.
4. The operating system's CSPRNG is sound. `Math.random()` and Python's
   `random` are never used for anything security-relevant.
5. College email verification identifies a student well enough for a campus-scoped
   prototype. It is not identity proofing.

---

## 5. Residual risks, collected in one place

Ranked by how much they would worry a reviewer:

1. **An active server can break everything** by substituting a public key.
   Mitigation is future work (key transparency), not present.
2. **The BLE device address may not rotate with the ephemeral id**, which
   would allow short-range device tracking by a sniffer. Measured in Phase 9a
   before any claim is made.
3. **Operator-as-user collusion** is unfixable technically and handled by a
   governance rule that a deployment must actually follow.
4. **Real-time two-way relay** can fabricate a crossing.
5. **The crossing graph is genuinely sensitive.** The server legitimately
   learns who was near whom each day. With a public timetable, clusters may be
   attributable to a class. This is the biggest *by-design* disclosure in the
   system, and the mitigations are retention (7 days), day granularity, and
   campus scoping — not secrecy.
6. **Chat is not end-to-end encrypted** (D10), so the operator reads messages
   inside matches. Stated in the product copy, not buried.
7. **The number of matched tokens reveals how many intents a pair shares**
   (D10), though never which ones.
8. **An encounter set's size, rounded to 256, is a coarse activity signal** —
   it distinguishes "a quiet day" from "a very social day" at four levels.
9. **App presence is detectable over BLE.**
10. **The platform's own backup is a disclosure channel, and has to be turned
    off by hand.** Android Auto Backup uploads an app's `SharedPreferences` to
    Google unless the manifest says otherwise. The BLE module keeps its
    undrained sighting table there — own EIDs, heard EIDs and 15-minute
    interval indices — so with the default `allowBackup="true"` the one class
    of data §7.3 promises never leaves the device was leaving it to a third
    party. Now `allowBackup="false"` (SPEC §14.1), but the general point stands
    for every future dependency: a privacy property enforced only in our own
    code is not enforced, because the platform has defaults of its own.
    Found in the review recorded as `docs/DECISIONS_LOG.md` 29.
11. **A device without BLE 5 currently discovers nobody.** The legacy split
    advertisement advertises correctly but cannot be received (both halves
    share company id `0xFFFF`, so Android's parser collapses them). The app
    now reports `legacy_fallback_unverified` rather than claiming discovery
    works. Whether this is fixable without a format change is the first
    question of the Phase 9a spike (`docs/BLE_SPIKE.md` §1a, Board item Q10).

---

## 6. How each claim is checked

See `docs/SECURITY_ARGUMENT.md`. In summary: C1 (independence of one-sided
interest) has a two-worlds test that compares stored rows, request logs and
response bodies across worlds that differ only in whether an unreturned signal
exists, plus a third world that must detect a match so the test cannot pass
vacuously. C2 (only mutual same-intent interest is revealed, to both parties,
always) and C5 (no real-time proximity) are covered by server tests under an
injected clock. C3 (no intent anywhere) is enforced by a route audit that
inspects every request and response schema. C4 (no location) is enforced on
the server by schema and retention tests and in the app by a manifest check.

---

## 7. What would change this document

Any of the following makes this file out of date, and the change is not
complete until it is updated in the same commit: a new route or schema field;
a change to what the server stores or logs; a change to the padding, the
upload discipline, or the matching batch; a BLE spike result that contradicts
§3.3; or a decision to bring an out-of-scope adversary into scope.
