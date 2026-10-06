# 8. What the simulation can and cannot tell us

The full output is `sim/results/report.md`, and its first paragraph is the
caveat rather than the result — deliberately.

## Why there is a simulation at all

Not as a substitute for the real thing. Because the real thing **cannot
measure its own research question**.

RQ2 asks how reveal timing affects the concentration of **interest received**.
In the deployed system that quantity does not exist in any readable form: the
server cannot count how many people signalled a given user without breaking
claim C1, which is the project's central contribution. The research cannot
have it either. There is no privileged researcher view.

So the Gini coefficient of one-sided interest is measured where ground truth
exists by construction — in a model — and the field pilot is restricted to
observable proxies (the Gini of *matches*, conversation depth, unmatching after
reveal, retention).

**That gap is a finding, not a workaround.** It is RQ4, written up in
`docs/SECURITY_ARGUMENT.md` §8.2: a system that makes attention unobservable
makes it unobservable to its own builders, including for safety purposes. An
operator cannot proactively spot someone being mass-signalled. What is left is
the cap of 20, blocks and reports.

## What the model is

600 agents, 56 days, three policies, 30 seeds each.

- **Co-presence** from a stochastic block model: higher crossing probability
  within a hostel (0.05), lower within a department (0.02), low otherwise
  (0.002).
- **Agents** have an attractiveness score, an 8-dimensional compatibility
  vector, an activity level, and a 60% chance of being open to the `date`
  channel at all.
- **Signalling** is a logistic function of a utility that weights
  attractiveness (`beta_a`) and compatibility (`beta_c`). Under **P**
  attractiveness enters at discovery; under **M** and **C** it cannot, because
  there is no photo to see yet.
- **Reveal** and churn follow the sigmoid in SPEC §15.4–15.5.

Everything is seeded: the same seed gives a byte-identical output, and there is
a test for it. Re-running the 30-seed experiment reproduced
`main_experiment.csv` with zero differences.

## The result

| Metric | P (photo at discovery) | M (at match) | C (after conversation) |
|---|---|---|---|
| Gini of interest received | **0.664** [0.658, 0.669] | 0.607 [0.601, 0.614] | 0.610 [0.604, 0.615] |
| Gini of matches | **0.676** | 0.635 | 0.638 |
| Share of matches with a top-decile-attractiveness agent | **0.312** | 0.180 | 0.182 |
| Mean compatibility of matched pairs | 0.112 | 0.132 | **0.137** |
| Retention at day 56 | 0.686 | **0.695** | **0.394** |

Read in words: under photo-at-discovery, attention concentrates
noticeably — nearly a third of matches involve someone in the most attractive
tenth, against under a fifth for the other two — and matched pairs are *less*
compatible. But photo-after-conversation has a real cost of its own: barely 39%
of agents are still active at day 56, against about 69%.

So the model does not say "later is better". It says photo-at-discovery
concentrates attention, and waiting too long costs you your users. M sits
between them on both.

## The sensitivity sweep, and the reversals

45 parameter combinations × 3 policies × 30 seeds = **4,050 runs**, varying the
attractiveness-to-compatibility weight ratio (0, 0.5, 1, 2, 4), the churn
parameter `phi` (0, 0.02, 0.08), and the signal cap K (5, 10, 20).

The report names every conclusion that reverses somewhere in that grid, and
several do. The honest headline: at `beta_a_over_beta_c = 0` — where
appearance carries no weight at all — P's disadvantage disappears entirely.

That is not a failure of the model. It is the model behaving correctly: if
appearance does not matter to anyone, showing photos earlier cannot concentrate
attention by appearance. It does mean the result is **conditional on appearance
mattering at all**, which is an assumption and is labelled as one.

## What it cannot tell us

Stated as plainly as the result, because a simulation reported without this
section is an argument dressed as evidence:

1. **The key parameter is assumed, not measured.** `beta_a` and `beta_c` — how
   much weight people put on appearance versus compatibility — are the whole
   mechanism, and no measurement of them exists here. The sweep shows how
   conclusions move as the ratio changes; it cannot tell you where on that axis
   real students sit.
2. **The co-presence structure is invented.** The stochastic block model's
   three probabilities are plausible, not estimated from any campus.
3. **Agents are simple.** No conversations, no reputations, no friendship
   networks, no learning from rejection, no life outside the app.
4. **It models one channel.** SPEC §15 left unstated which of the five intents
   the model represents; the implementation covers the `date` channel only,
   because that is what reveal-timing research is centrally about. The other
   four exist in the product and not in the model.
5. **Discovery sees one day, not seven.** SPEC §15.3 says an agent sees that
   day's crossings; the real digest keeps cards for a week. A documented
   simplification that makes signalling more urgent in the model than in the
   product.
6. **A simulation cannot discover a mechanism it was not given.** The model
   produces concentration under P because attractiveness was wired into the
   discovery decision. It is a consistency check on an intuition and a way to
   quantify it under stated assumptions — not independent evidence that the
   mechanism is real.

## The discipline that makes it worth anything

Three rules, followed and recorded:

- **No post-hoc tuning.** Both the main experiment and the full sweep were run
  **once**, with the config as committed. No parameter was touched after seeing
  a result. `CLAUDE.md` §8 rule 4 requires any later change to be recorded with
  its reason; there are none to record.
- **Smoke-tested first.** A 2-seed run of the whole pipeline, and a tiny sweep
  grid, were run and inspected before the real experiment — so that bugs were
  found on throwaway output rather than on the run being reported.
- **The caveat comes first.** `sim/results/report.md`'s opening paragraph says
  the results are conditional on the model's assumptions, before any number
  appears, and points at the decisions log for every gap that had to be filled
  in.

## The one-sentence version

Under an explicit model of attraction and compatibility, showing photos at
discovery concentrates attention on conventionally attractive agents and lowers
the compatibility of matched pairs; waiting until after a conversation avoids
that but costs a large share of retention; and the whole conclusion depends on
assuming appearance matters, which is assumed rather than measured.
