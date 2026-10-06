# 4. Why the server resolves crossings, and what it learns

A crossing means "you two spent a little time near each other yesterday". The
question is who computes that, and what they learn by doing it.

## The design changed three times, and the reasons are the interesting part

This is the one part of the protocol that was redesigned twice before it
worked. `SPEC.md` §21 records it as decision **D5**; the versions are worth
walking through, because each rejected one is the design most people reach for
first.

### v1.0 — the phone uploads its daily key, the server derives everything

Simple: the phone generates a daily key, derives 96 ephemeral ids from it,
broadcasts them, and uploads the key. The server derives the same 96 ids,
matches up what everyone heard, and builds the crossing graph.

**Why it was wrong:** the server can now derive every id every phone broadcast,
for every interval of the day. Anyone with the database and a bag of cheap BLE
receivers planted around a campus can attribute sniffed broadcasts to named
accounts and rebuild a **15-minute-resolution movement graph** of every user.
The app would have become the most effective tracking tool on campus, operated
by whoever ran the server.

### v1.1 — distribute the keys to clients instead

If the server should not have the keys, give them to the clients: each phone
gets the keys of the people it might have met, and works out its own crossings.

**Why it was wrong:** worse. Now *any user* can do what the operator could.
Hand someone a daily key and a scanner app and they can follow a specific
person around for the day. It moves the capability from one semi-accountable
party to everybody.

### v1.2 — unkeyed tokens

Keep keys on the device. Each phone hashes the pair of ids it heard — its own
and the peer's — and uploads the hashes. The server pairs up hashes that two
accounts both uploaded. No keys leave the device, and the server learns only
that two accounts share a value.

**Why it was wrong, and this is the subtle one:** the hash is computable by
*anyone who heard both ids*. A listen-only sniffer with an account of its own
can hear A's broadcast and B's broadcast, compute the same hash, upload it, and
**forge a crossing with either of them**. Worse, a token uploaded by three
accounts is ambiguous, so a sniffer could poison real crossings.

### v1.3 — tokens keyed by a secret only the two devices share

The version that is implemented:

```
ss      = X25519(esk_a, eid_b)          # reject an all-zero result
lo, hi  = sort_bytes(eid_a, eid_b)
E       = BLAKE2b(day ‖ lo ‖ hi, key = ss, digest_size = 32,
                  person = "mutual-encount01")
```

Each ephemeral id is an X25519 **public key**, derived from the daily key, and
the device keeps the matching private key. The token is keyed by the shared
secret between the two ephemeral keys.

The device that heard the other computes the same `E`, because X25519 is
symmetric and the ids are sorted. **Nobody else can**, including a sniffer that
heard both broadcasts, because it holds neither ephemeral private key. And
including the server.

That fixes all three failures at once: no keys reach the server, no keys reach
other users, and a listener cannot forge a crossing even with an account.

## The dwell rule, and why counts are never summed

A crossing is supposed to mean you spent *time* near someone, not that you
passed them in a corridor.

Per 15-minute interval, the device counts the **scan windows** in which it
heard a peer above the RSSI threshold. A sighting qualifies at
`presence.min_qualified_windows` = 4 or more windows **within one interval**.

The rule that matters: counts are **never summed across intervals**. "The best
single sighting counts." Without that, four brief brush-pasts at different
times of day would add up to a crossing — and someone who walks the same
corridor as you four times becomes indistinguishable from someone you sat next
to. `app/src/presence/encounters.ts` keeps the maximum per pair and has a test
for exactly this.

The threshold is applied on the device, as the sighting arrives, so the RSSI
value is never stored and there is nowhere to read it from afterwards.

## The midnight rule

Nothing is recorded while the device's own interval is the first (0) or last
(95) of the day. Thirty minutes of deliberate blindness, every day.

It exists because the token includes the **day**. If one phone thinks it is
23:59 and the other thinks it is 00:01, they compute different tokens and the
crossing silently never resolves. Excluding both edge intervals means both
devices are certain to be on the same local day whenever they record each
other.

It is enforced inside `SightingStore.addWindow` and again in
`qualifying()` — in the store rather than at the call sites, because a rule
checked at each call site holds until someone adds a second call site.

## The padding, and what the server learns from the size

The night's upload is the set of distinct qualifying tokens, padded with CSPRNG
values to the next multiple of 256, up to 1024, and shuffled.

So the server learns the set's size **rounded up to a multiple of 256** — four
possible values. That is a coarse activity level: it distinguishes a quiet day
from a very social one, at two bits of resolution, and nothing finer.

Measured: **11,792 bytes** for a quiet day and **23,568 bytes** for a very
social one. One sighting costs exactly the same as fifty, which is the padding
doing its job, and there is a test that asserts precisely that
(`test_padding_hides_how_many_sightings_a_small_night_had`).

## What the server genuinely learns, stated without softening

This is the largest by-design disclosure in the whole system, and the
documentation does not dress it up:

**The server learns the day's crossing graph: who was near whom, at day
granularity, retained for 7 days.**

Groups that spend time together appear as clusters. With a public timetable, an
operator could plausibly guess which class a cluster was. That is real, and the
mitigations are modest and honest rather than clever:

- **day granularity** — no time of day ever reaches the server;
- **7-day retention** — `test_retention.py` enforces it;
- **a 2-day cutoff** on the raw presence uploads themselves;
- **campus scoping** — a token shared across two campuses creates no crossing
  and stores nothing;
- **no friend-of-friend feature**, which the graph would make easy. That one is
  excluded by *product decision*, not by the protocol — so a future operator
  could reverse it, which is itself an argument for keeping retention short.

## The time chip, and where the time lives

A card says "Yesterday · evening". The server never knew that.

`GET /digest` returns, per peer, the crossing's canonical encounter token. The
device keeps its own local map from each token it uploaded to the coarse block
(morning / afternoon / evening / night) of the sighting it came from. The chip
is a local lookup.

A client therefore learns the time of **one** sighting with a peer — the one it
recorded itself, which it already knew. The server learns none.

## Why the server resolves it at all

Given all that, why not have the phones work out crossings between themselves?

Because they are rarely online at the same time, and any relay that let them
find each other would see who was talking to whom — which is the crossing
graph again, held by whoever runs the relay. The server is the simplest party
that can do the pairing, and the protocol is designed so that pairing is *all*
it can do: it holds opaque 32-byte values and can only notice that two accounts
uploaded the same one.
