# 3. Why twenty signals, once a night, at a random time

This is the most important design decision in the project. Everything else is
either support for it or a consequence of it.

## The problem, stated precisely

A student taps "send a signal" on someone's card. What must the server be
unable to learn?

Not just *who* — that part is easy, you hash it. The hard part is that the
server must not learn **that anything happened at all**. If a request appears
when a user taps, then the request's existence is the signal, whatever is
inside it. If the request is bigger when there are more signals, the size is
the signal. If it arrives at 21:03 because that is when the user was looking at
their phone, the timing is the signal.

So the requirement is not "encrypt the signal". It is: **the server's view must
be identical whether or not the signal exists**.

## The four rules, and why each one is necessary

### Exactly twenty tokens, always

The phone uploads `signal_set_size` = 20 values of 32 bytes. One real signal,
twenty real signals, or none: twenty values. The unused slots are filled from
the operating system's CSPRNG.

*Why necessary:* without it, the request's length leaks the count. With it, the
measured upload is **932 bytes every single day** regardless
(`server/tests/test_costs.py`).

*Why twenty rather than five or a hundred:* it has to be a fixed cap, so it has
to be a number a student would not often hit, but small enough that the daily
cost stays trivial. Twenty crossings a day that you want to act on is a lot.
The number lives in `constants.json`, is enforced on the device, and is
enforced again by the server, which rejects any other count.

### At most once per epoch

One upload per day, whether or not anything was signalled.

*Why necessary:* this is the rule people get wrong. Padding alone does not
help if the padded set is sent *because* the user acted — then the upload's
existence is still the signal. So the upload happens on a schedule that knows
nothing about what the user did, and happens on quiet days too.

There is a consequence worth stating plainly: a signal sent at 09:00 waits
until the evening. **Nothing leaves the phone when you tap.** The signal sheet
says so.

### At a random time inside the window

The minute is drawn from the CSPRNG, uniformly inside the evening window
(18:00–23:30, so 5.5 hours wide).

*Why necessary:* a fixed time would be fine for hiding *what* was signalled but
would turn a missing upload into information — the phone was off, or the user
has stopped using the app. A random time inside a wide window also means a
network observer cannot align an upload with anything the user was doing.

*Why the CSPRNG and not `Math.random()`:* the upload time is a privacy
parameter. A predictable sequence would let an observer distinguish a late
upload from an absent one. `@mutual/protocol`'s `randBelow` rejection-samples
from the platform CSPRNG, and throws rather than falling back to anything
weaker.

### Matching runs in a nightly batch, never in a request

The server stores the set when it arrives and does nothing. At 23:45 a batch
job intersects every pair of sets for that epoch.

*Why necessary:* this is the rule that is easiest to leave out and the one that
closes the last channel. If matching happened inside `PUT /signals`, then the
*response time* of that request would depend on whether a match was found.
Padding and random timing do not help with that at all. Batching moves the
computation away from any request, so there is no response whose timing could
carry the answer.

It also means the second person to upload cannot learn anything from being
second.

## What makes a real token indistinguishable from the padding

```
pair key  = BLAKE2b(X25519(sk_self, pk_peer) ‖ pk_lo ‖ pk_hi ‖ uid_lo ‖ uid_hi,
                    person = "mutual-pairkey01")
token     = BLAKE2b(epoch ‖ intent, key = pair key, person = "mutual-interest1")
```

The pair key is derived from the X25519 shared secret between the two identity
keys, with both public keys and both user ids folded in and sorted, so both
sides compute the same value. The token is then a keyed hash of the epoch and
the intent.

The server holds neither private key. Under the standard assumptions — keyed
BLAKE2b behaves as a PRF, and an X25519 shared secret is indistinguishable
from random to a party with neither private key — a real token is
computationally indistinguishable from the CSPRNG padding sitting beside it in
the same list.

Three consequences fall out of the construction rather than being added:

- A different **intent** gives a different token, so cross-intent signals
  cannot match. There are only five intents, but you cannot enumerate them
  without the pair key.
- A different **epoch** gives a different token, so yesterday's set tells you
  nothing about today's.
- Non-matching tokens are **deleted** when the batch finishes, so even the
  indistinguishable values do not accumulate.

## How it is checked

`server/tests/test_leak_two_worlds.py` builds two complete worlds that differ
in exactly one respect — in world A, U holds a signal for V that V does not
return; in world B, U holds nothing — and asserts that **every** account's
stored rows, request log and response bodies are identical, before and after
the batch. Page 6 explains why that test is built the way it is, and why a
passing test would not be enough on its own.

## The cost, measured

| | |
|---|---|
| Signal upload | **932 bytes** of request body, once a day, for any number of real signals |
| Worst-case latency, tap to both parties told | **38 hours** |
| Typical latency, digest to told | **24 hours** |

The 38 hours is the honest worst case: a tap that lands just after tonight's
upload has already gone waits for tomorrow night's upload, that night's batch,
and the following morning's release. A conventional app delivers a match in
seconds.

That is the trade, and the product does not hide it: the whole design is framed
as a morning letter rather than a live feed, so the latency is the thing being
offered rather than a limitation being apologised for.

## What was considered and rejected

| Alternative | Why not |
|---|---|
| Encrypt the signal and send it immediately | The request's existence is the signal. Encryption does not help |
| Private set intersection between the two phones directly | The two phones are rarely online at once, and a PSI protocol between them still needs a relay that sees who talks to whom |
| Upload only on days when something was signalled | Then the upload's existence is the signal — the exact mistake the once-per-epoch rule exists to prevent |
| A trusted enclave on the server | Moves the trust rather than removing it, and cannot be verified by a student with a laptop |
| Variable padding (pad to a random size) | Leaks less than no padding, but a distribution of sizes still correlates with the count across many days. A constant is strictly better and costs less |
