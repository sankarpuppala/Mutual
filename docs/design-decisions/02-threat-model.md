# 2. The threat model, in one page

The full version is `docs/THREAT_MODEL.md`. This page is the shape of it, and
the one limitation that matters most.

## What is being protected, in order

1. **One-sided interest** — that A signalled B when B did not signal back. The
   most socially dangerous fact in any app of this kind, and the one every
   conventional app stores in plaintext.
2. **The intent** of a signal or match. "Wanted to date" is a different
   disclosure from "wanted a study partner", and can out someone.
3. **Location and routine.** What makes stalking possible. Mutual's answer is
   not to collect it.
4. **Pre-reveal photos.** A face plus a first name plus a campus is enough to
   find someone.
5. **Messages.** Sensitive, but both parties chose to send them, to a known
   person, after a mutual match.
6. **The fact that someone uses Mutual at all.** Lowest, and not zero.

## Who it defends against

**The primary adversary is an honest-but-curious server operator** with the
full database, every log line and the source code, who follows the protocol and
reads everything they can. Claims C1–C5 are stated against exactly that person.

Why that one: it is the realistic adversary for a student-run or
university-hosted service, it is the adversary a future acquirer becomes, and
it is the adversary conventional apps lose to completely.

Against them, the design holds: no record of unreturned interest exists
anywhere, no intent exists in any field or column, no location is ever
collected, and no response reveals a match before its fixed release instant.
The two-worlds test (page 6) is the evidence.

**Also in scope:** another student using the ordinary app. There is no endpoint
that answers a question about another user before a mutual match exists
(enforced by an automated route audit); a signal has no observable effect
unless returned; the digest is next-morning only, so the app cannot locate
anyone; block and report always return the same response whether or not the
target exists.

**Partly in scope:** a passive Bluetooth sniffer. It sees that a Mutual device
is nearby and a 32-byte value that changes every 15 minutes. It **cannot**
compute an encounter token, because the token is keyed by a secret between the
two participating devices — not even with an account of its own. That is the
whole reason for the v1.3 redesign on page 4.

## Who it does not defend against

Four, stated plainly rather than buried:

| | What they get | Why out of scope |
|---|---|---|
| **An active (malicious) server** | Substituting one public key gives them every one-sided interest and intent directed at that peer, undetectably, forever | **This is the headline limitation.** Defending it needs key transparency — a signed, append-only log of `(user_id, public key)` that clients audit — which is a project of its own |
| **An operator who also holds an account** | They can silently test interest directed at themselves, retroactively, until the batch deletes the epoch's tokens | Inherent to any scheme where the operator can be a participant. Handled as a governance rule — operators hold no account in a pilot — not a technical claim |
| **A relay or a planted phone** | A two-way real-time relay can fabricate a crossing between two strangers; a phone with an account left in a café collects crossings with whoever lingers | Defending it needs distance bounding. The harm ceiling is low: an extra card in a digest, or a weak "who uses Mutual here" oracle bounded by the 40-peer display cap |
| **A compromised device** | That device's own signals, keys and local sighting log | Secure storage limits the blast radius; full device compromise is unwinnable at this layer |

## The two accepted trades worth knowing about

**Fair delivery means a match cannot be erased for one side.** If A unmatches
or blocks B a second after the notification, B still receives the match as
`ended`, with its intents and a frozen minimal card. That is deliberate: if a
block could erase a notified match, the *absence* of an expected match would
itself become a signal, and one party could unilaterally rewrite the other's
history. The cost is that B learns A matched them and then ended it.

**Chat is not end-to-end encrypted** (decision D10). The operator can read
messages inside matches. It is in the participant information sheet, the
consent form and the in-app privacy screen, in those words.

## The residual risks, ranked

1. An **active server** breaks everything. Mitigation is future work.
2. The **BLE device address may not rotate** with the ephemeral id, which would
   let a sniffer link ids across rotations and track a device in range.
   **Measured in Phase 9a before any claim is made** — `docs/BLE_SPIKE.md`'s
   tables are still blank, and if the answer is bad, the rotation claim gets
   weakened in writing rather than quietly kept.
3. **Operator-as-user collusion** — unfixable technically, handled by a rule a
   deployment must actually follow.
4. **Real-time two-way relay** can fabricate a crossing.
5. **The crossing graph is genuinely sensitive.** The server legitimately
   learns who was near whom each day. Page 4 is honest about how much.
6. **Chat is readable by the operator.**
7. **The number of matched tokens reveals how many intents a pair shares**
   (never which).
8. **An encounter set's size, rounded to 256, is a two-bit activity signal.**
9. **App presence is detectable over BLE.**

## Trust assumptions, as assumptions

1. The server follows the protocol. If not, see the first row above.
2. Both phones in a crossing run honest client code. A modified client can lie
   about what it heard; it still cannot forge a token for a device it never
   heard.
3. X25519 and keyed BLAKE2b behave as standard primitives. No cryptography here
   is home-made: Python uses `cryptography` and `hashlib`, TypeScript uses
   `@noble/curves` and `@noble/hashes`, and the two are held byte-identical by
   a committed vector suite.
4. The OS CSPRNG is sound. `Math.random()` and Python's `random` are never used
   for anything security-relevant.
5. College email verification identifies a student well enough for a
   campus-scoped prototype. It is not identity proofing.
