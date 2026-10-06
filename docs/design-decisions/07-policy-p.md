# 7. Why policy P exists only in the simulation

Three reveal policies appear in this project:

| | Name | Photos become visible | Where it exists |
|---|---|---|---|
| **P** | photo at discovery | immediately, while browsing | **simulation only** |
| **M** | photo at match | when a mutual match is notified | server default |
| **C** | photo after conversation | after 8 messages each, or mutual consent | server, by schedule |

The server implements M and C. It does not implement P, and will not. That is
decision **D9**, and it is the sharpest example of a research question
colliding with a product principle.

## Why P is the interesting policy

P is what almost every app in this category does: you see a face first. If the
hypothesis is that photo-first browsing concentrates attention on a small
number of people, then **P is the condition the hypothesis is about**. Leaving
it out of the experiment looks like leaving out the control group.

## Why it is not in the product anyway

Because showing photos while browsing is the specific thing Mutual exists not
to do.

The product's premise is that you meet someone through their words, and the
face arrives only once interest is mutual. Implementing P would mean building,
shipping and testing the exact mechanism the project argues against — and once
it exists in the codebase it is one config flag away from being the default. A
campus running P would be a conventional app with worse latency.

There is a sharper version of the argument. Under P, a user's photo is visible
to everyone who crossed their path, with no mutual interest having been
established. In a system whose whole pitch is that your face is not a browsing
commodity, that is not a policy variant. It is a different product, with
different consent.

## So how is it studied?

In the simulation, where there are no people.

`sim/` models 600 agents over 56 days under all three policies. Under P,
attractiveness enters the **discovery** decision; under M and C it cannot,
because at discovery time there is no photo to see. That difference is exactly
what the simulation isolates, and there is a test that pins it:
`test_beta_a_changes_discovery_only_under_p` — varying the weight on
attractiveness changes signalling under P and leaves M and C untouched.

The finding, from 30 seeds: under P the Gini of interest received is 0.664
against about 0.61 for M and C, and the share of matches involving the most
attractive decile nearly doubles — 31% against about 18%. Page 8 is the honest
account of what that does and does not establish.

## What this costs the research, stated plainly

**The strongest evidence about the most interesting policy is simulated, not
observed.** That is a real weakness, not a presentational one, and no amount of
sweep robustness fixes it: a model that says photo-first concentrates attention
is a model, and the parameter driving the result — how much weight people put
on appearance — is assumed rather than measured.

The field pilot therefore compares **M against C only**. It cannot speak to P
at all, and `study/PREREGISTRATION.md` §1 says so.

## Why this is the right trade anyway

Three reasons, in order of how much they would convince a sceptic:

1. **The simulation's conclusion runs in the direction nobody disputes.** That
   photo-first browsing concentrates attention is not a surprising claim; it is
   the widely held intuition the product is built around. The simulation's
   contribution is to put a number on it under stated assumptions, and to show
   where that number reverses — not to establish the effect from scratch.
2. **M versus C is the decision a builder actually faces.** Nobody shipping a
   product like this is choosing between photos-first and photos-later; they
   have already chosen later, and the live question is *how much* later. That
   is the comparison the pilot runs.
3. **Running P on real students would mean showing their photos to people they
   had not matched with, in order to measure whether that is harmful.** Even
   with consent, that is a poor thing to ask an ethics committee for, and a
   poor thing to do.

One note on process, since it is the kind of thing that gets lost: D9 predates
the simulation. This is a decision made before any results existed, not a
rationalisation of a policy that turned out to look bad.
