# 5. Why the digest arrives tomorrow morning

The app could show you who is nearby right now. It refuses to, and the refusal
is load-bearing in two different ways — one technical, one about what the
product is.

## The technical reason: real-time proximity is the attack

Decision **D3**. An app that tells you who is nearby *now* is a tool for
finding a specific person, and the person being found does not consent to each
lookup. Every other protection in the system would be decoration if the app
answered "where is she right now".

So claim **C5** is stated strongly: a crossing from day *d* is not returned by
`GET /digest` before `digest.release_time` on day *d+1*, and between two
consecutive release times the digest a user receives is **byte-identical**.

Byte-identical, not merely "doesn't show new people". The digest is baked once
per release into a snapshot, so repeated polling cannot reveal that something
changed during the day. Without that, a user could poll every minute and watch
their own crossing list grow — which is real-time proximity with extra steps.

Two exceptions exist and are tested: the viewer's **own** block takes effect
immediately (a safety action must not wait for a release), and an operator
suspension is applied live. Both are changes the viewer either caused or that
protect them, and neither reveals anything about timing.

## The product reason: "a morning letter, not a slot machine"

Decision §13.3, and the reason the latency is not apologised for.

A feed that can change at any moment trains you to check it. That is the
mechanic the entire category is built on, and it is also what makes the social
cost of these apps high: the loop rewards looking, not meeting. A letter that
arrives once, complete, at a known time, and then stops changing cannot be
checked profitably. There is nothing to refresh into existence.

That is why Today has no pull-to-refresh that produces new people, no counts,
and no "X people want to meet you" teaser — the last one being impossible
anyway, since one-sided interest does not exist in any readable form.

It also shapes smaller things. Cards stay in your letter all week
(`digest.lookback_days` = 7), with a collapsed "Earlier this week", so there is
no urgency to act today. The empty state says "No crossings yesterday. Mutual
notices people you spend a little time near — keep it on during your day."
rather than suggesting you invite friends.

## The eager prefetch, which is the subtle part

Here is the failure the design has to avoid, and it has nothing to do with the
server.

Suppose the digest arrives as a list, and each card's voice note loads when the
card scrolls into view. The server is perfectly behaved — and it now learns
exactly which cards you looked at, in what order, and how long you lingered.
That is a *better* record of one-sided attention than the signals themselves,
and the whole protocol would have been pointless.

So: `GET /digest` returns the day's peers **and the full list of every media
item in it**, and `app/src/digest/prefetch.ts` fetches every one of them, in
the order the digest lists them, before any card renders. UI components read
from the local cache only; `VoicePlayer` takes a local file URI and has no way
to ask for the file.

An observer watching the device sees one burst of fetches each morning whose
contents are a function of the digest alone. Opening one card, all of them, or
none produces identical traffic.

This is invariant 1, and it is the invariant most easily broken by an ordinary
performance optimisation. `app/__tests__/no-network-on-render.test.tsx` renders
a crossing card and a voice player with `global.fetch` replaced by a spy that
fails the test if it is called at all, and presses play to be sure.

**What happens at the prefetch cap** (`digest.media_prefetch_cap_mb` = 25) was
a gap in the spec. The resolution: items are dropped **from the end of the
digest's own order**, never by what the user has looked at — so the set
fetched still depends only on the digest. Any rule that privileged "the ones
they opened" would reintroduce the leak.

## The measured cost

| | |
|---|---|
| Crossing to notification, worst case | **56 hours** |
| Digest to notification | **24 hours** |
| Tap to both parties told, worst case | **38 hours** |

The 56 hours is a crossing just after midnight: it waits for that day to end,
appears in the next morning's letter, a signal sent that morning rides that
evening's upload, the batch runs at 23:45, and the release is the following
morning.

A conventional app does this in seconds. Mutual trades about a day and a half
for the property that an unreturned signal leaves no trace. Whether users
accept that is an empirical question, and retention is one of the field pilot's
pre-registered outcomes — which is also the honest answer to "but would anyone
use this?": we do not know yet, and the study is designed to find out rather
than to assume.
