# 6. Why the leak test is built the way it is

How do you test that something is **absent**?

Most tests check that an action produces an effect. This one has to check that
an action produces *no* effect — anywhere, in anything the server can see. That
is a different shape of test, and the obvious ways to write it are all wrong.

## The wrong ways first

**Wrong way 1: assert the signal is not in the database.**

```python
# Useless.
assert "V" not in db.dump()
```

Of course it is not: the token is a hash. This test passes on a system that
leaks the signal through a request size, a response time, or a row that exists
in one world and not the other. It tests the one channel nobody would have
used.

**Wrong way 2: check a few endpoints by hand.**

Pick `GET /digest` and `GET /matches`, compare them with and without the
signal. Better, but it only covers the endpoints someone thought of, and a leak
added later to a third endpoint passes silently. It also only checks the
*viewer's* responses, when the dangerous disclosure is to the **peer** — V
should not be able to tell either.

**Wrong way 3: trust the argument.**

The cryptographic argument in §3 is sound, and it is not enough. The argument
is about the tokens; the leak would be somewhere else entirely — a row count, a
log line, an error code, a response that is one byte longer.

## How it is actually built

`server/tests/test_leak_two_worlds.py` builds **two complete worlds** that
differ in exactly one respect:

- **World A**: user U holds a signal for peer V, for `date`. V does **not**
  signal back.
- **World B**: U holds no signal at all.

Everything else is identical: the same accounts, the same profiles, the same
crossings, the same mocked clock, the same sequence of requests from every
account. Then it compares three things across the two worlds:

1. **Every row of every table.** Not a chosen subset — the whole database,
   dumped and compared. The single exception is the raw bytes of
   `epoch_tokens.token`, which genuinely differ for the few hours before the
   batch deletes them, and which the cryptographic argument covers.
2. **The request log of every account.** Method, path, query, body length,
   status, in time order. Not just U's requests: **every** account's, because a
   leak to V is the one that matters.
3. **Every response body returned to every account**, before and after the
   nightly batch.

Comparing the whole database rather than named columns is the point. A leak
nobody anticipated — a counter, an index row, an audit entry added next term —
shows up as a diff without anyone having to predict it.

## The part that makes it worth anything: world C

A test that asserts "nothing happened" passes beautifully on a system where
nothing *can* happen. If the matching batch were accidentally disabled, worlds
A and B would be identical and the test would be green — while the whole
product was broken.

So the same test builds a **third world**:

- **World C**: V signals U back, for the same intent.

And asserts that world C **does** produce a match, and that the match becomes
visible from its `notify_after` instant. If matching breaks, world C fails.

Then it adds one more comparison, which is the one that actually demonstrates
the fair-delivery property: **before `notify_after`, world C's responses are
identical to world B's.** A real, formed, stored match is invisible to everyone
until its fixed release instant. Not merely hidden from `GET /matches` — the
*whole response surface* is unchanged.

So the test has three jobs:

| World pair | What it proves |
|---|---|
| A vs B | An unreturned signal leaves no trace anywhere |
| C | Matching actually works, so A-vs-B is not vacuous |
| C vs B, before release | Even a real match is invisible until its release instant |

## Why `notify_after` is per token, and why that needed testing too

A match can gain a second intent later: U and V match on `study` in one epoch
and on `project` in another. Each matched token has **its own** `notify_after`,
and the batch writes new tokens as pending without touching what is already
visible.

That rule exists because the alternative leaks. If a new token were visible
immediately, then the *arrival* of a second intent would be observable at a
moment determined by the batch rather than by a fixed release time — and a
user watching closely could infer when the other person signalled. So
`test_matches.py::test_appended_token_is_invisible_until_its_own_release`
exists, and it is not a corner case.

## The companion test

`test_route_audit.py` does the other half, and it is automated rather than
enumerated by hand. It reads the **live OpenAPI schema** — every route the app
actually serves — and for each one asserts:

- no request or response model has a field named or typed as an intent;
- every route taking a user, peer or match id either sits on the explicit
  block/report allowlist or returns non-2xx without a qualifying notified
  match;
- `/v1/dev/*` is absent when `MUTUAL_ENV` is not `dev`.

Reading the live schema rather than a hand-written list is deliberate: a new
route added next term is audited without anyone remembering to add it.

## What these tests do not prove

Worth being blunt, since they are the project's headline evidence:

- They are tests against an **honest-but-curious** server. An active server
  that substitutes V's public key learns every signal directed at V, and no
  test here would notice. That is the project's largest residual risk
  (page 2).
- They cover the **server's** view. A client that uploaded early, or made a
  request when a card was opened, would leak everything while these tests
  stayed green. That is why `app/__tests__/no-network-on-render.test.tsx`
  exists — it renders a crossing card and a voice player with `global.fetch`
  replaced by a spy that fails the test if it is called at all.
- They prove **indistinguishability under this threat model**, not secrecy in
  any absolute sense. The server still learns that a user uploaded a set of
  twenty tokens, and still learns the day's crossing graph. Page 4 is honest
  about how much that second one is.
