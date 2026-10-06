# 9. Where the code and the spec disagree

Every discrepancy found while writing these pages, listed rather than quietly
fixed. The point of the list is that a reader can check it; a walkthrough that
reported perfect agreement would not be worth reading, because no project of
this size has perfect agreement.

Checked against `SPEC.md` as of the Phase 13 commit.

---

## Resolved in the same change that found it

### 1. `GET /config` returns a field the spec's prose does not list

**SPEC.md §11** describes the response as
`{campus, server_time, epoch, protocol_version, reveal_policy,
next_policy_change?, signal_upload_window, presence_upload_window,
digest_release_time, interest_ttl_days, ble:{...}, study_enabled}` — with no
`match_batch_time`.

The implementation (`server/mutual_server/schemas.py`, `ConfigOut`) **does**
return `match_batch_time`, and the app depends on it: the signal scheduler has
to know the instant after which an upload is rejected (§6.9), and hard-coding
23:45 in the app would break the moment the server's config changed.

So the code is right and the prose was incomplete. **Fixed in SPEC §11's prose
in the Phase 13 commit.** The field itself is not new.

### 2. The type scale in §13.4 is not the scale the app uses

**SPEC.md §13.4** states: "Scale (pt): 12, 14, 16, 18, 22, 28, 36."

The app uses those for UI text, and also uses **42, 38, 32, 30, 27, 26, 24, 23,
20, 19 and 17** for display text — because `docs/design/prototype.html`, which
§13.9 makes the authority on look and feel, uses them. §13.9 says the prototype
wins where the two disagree, so this is the spec resolving its own conflict
rather than the code deviating.

It is still worth naming, because "no magic numbers in components" would be a
fiction otherwise. `app/src/design/tokens.ts` collects the intermediate sizes
in a `displaySize` map, each annotated with the prototype class it comes from
(`.welcome-title`, `.display-name`, `.a`, `.reassure`, …), so every value is
traceable and the lint rule stays honest.

### 3. `SPEC.md` §20's file list was behind the code, repeatedly

§20 enumerates every output file, and eleven files were added during
implementation that it did not anticipate:

`app/app.json`, `app/index.ts`, `app/plugins/withBleNeverForLocation.js`,
`app/src/design/primitives.tsx`, `app/src/design/icons.tsx`,
`app/src/dev/protocolSelfTest.ts`, `app/src/api/{endpoints,types}.ts`,
`app/src/onboarding/{store,identity}.ts`, `app/src/digest/useDigest.ts`,
`app/src/matches/photo.ts`, `app/src/components/SafetySheet.tsx`,
`server/tests/test_costs.py`, `study/analysis/requirements.txt`.

Each was added to §20 in the same commit that introduced it, and each is
justified in `docs/DECISIONS_LOG.md`. This is the most ordinary kind of drift
and the easiest to let slide.

---

## Genuine gaps in the spec, resolved by a documented decision

These are places where `SPEC.md` did not say enough to implement from, so a
decision had to be made. Each is recorded in `docs/DECISIONS_LOG.md` with its
reasoning; none is a contradiction.

| # | The gap | What was decided | Logged |
|---|---|---|---|
| 4 | What happens when the 25 MB media prefetch cap is reached | Items are dropped **from the end of the digest's own order**, never by what the user looked at — any other rule breaks invariant 1 | entry 22; PLAN deferred item 5 |
| 5 | §15.5's churn formula refers to "recent matches" with no window | A trailing 7-day window, mirroring `interest_ttl_days` | entry 17 |
| 6 | §15.6's "share of matches captured by the top decile" — of which population? | The whole simulated population, not just active agents | entry 17 |
| 7 | §15.6's "share of conversations ending at reveal" — over what denominator? | Matches that *reached* a reveal check | entry 17 |
| 8 | §15.2's stochastic block model does not say what happens when two agents share both a hostel and a department | The hostel weight wins | entry 17 |
| 9 | §15.4's "progress" term in the reveal sigmoid | A per-policy constant: 0 for M and P, 1 for C | entry 17 |
| 10 | Which of the five intents the simulation represents | The `date` channel only; the other four are not modelled | entry 17 |
| 11 | §13.2 lists the consent screen but not its position in onboarding | Between the code step and the age step, because `POST /account` carries `consent_version` | entry 21 |

---

## Open, and deliberately not resolved in code

### 12. On a study campus, declining consent means not using the app

**The conflict.** `SPEC.md` §16 runs the pilot as a campus-wide switchback, and
`POST /account` refuses an account on a study campus without a
`consent_version` (`server/mutual_server/routers/account.py:87`). So during the
pilot, a student who does not want to take part cannot use Mutual at all.

This is not a coding mistake — it follows from the switchback design, because a
match between a participant and a non-participant would have no well-defined
policy. But it is a real question about voluntariness, and it is an **ethics
question, not an engineering one**.

It is recorded as **Q9** on the decisions-log Board, stated plainly on the
in-app consent screen, and raised explicitly in
`study/ETHICS_APPLICATION_DRAFT.md` §4.2 as the application's weakest point,
with a proposed remedy (shorten the pilot to a single policy period) if the
committee finds it unacceptable. It is left open rather than decided, because
deciding it is not the implementer's call.

### 13. The simulation's discovery window is narrower than the real digest's

`SPEC.md` §15.3 says an agent sees "up to `display_cap` of day *t*'s
crossings" — that day's only. The real digest has a 7-day lookback
(§11, `digest.lookback_days`), so a card stays in your letter all week.

The simulation was implemented exactly as §15.3 is written, and it is a
**simplification, not a bug**: it makes signals more urgent in the model than
in the product, which if anything works against the headline finding rather
than for it. Recorded in `docs/DECISIONS_LOG.md` entry 17, and stated in the
simulation's own report as a modelling limitation.

Resolving it would mean either changing §15.3 and re-running the experiment, or
leaving it as a stated limitation. The second was chosen, because changing a
parameter after seeing results is exactly what `CLAUDE.md` §8 rule 4 forbids.

---

## Things that look like drift and are not

Worth listing so nobody spends time on them:

- **`app/app.json` and `app/app.config.ts` both exist.** Not a duplicate:
  `expo install` maintains the autolinked plugin list in `app.json`, and
  `app.config.ts` merges it rather than replacing it, so a future
  `expo install` is not silently discarded. Entry 19.
- **`ReportReason` has six values and SPEC §11 lists none.** §11 says
  `{peer_id, reason, message_ids?}` without enumerating reasons; the six in
  `schemas.py` are an implementation detail the spec left open.
- **The app sometimes loads an image outside `api/client.ts`.**
  `src/matches/photo.ts` builds an `Image` source with the bearer token as a
  header, so photos stream through the platform's image pipeline. Invariant 1
  governs traffic **before a match exists**; these requests happen only inside
  a notified, revealed match. The exception is documented in the file itself
  rather than left to be discovered.
- **`sim/results/report.md`'s runtime line changes when the experiment is
  re-run** (10.2 s, then 8.4 s). The *results* are byte-identical — that is the
  determinism requirement — and only the wall-clock line differs.
