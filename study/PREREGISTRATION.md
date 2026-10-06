# Pre-registration — Mutual field pilot (RQ3)

Status: **DRAFT. Not yet registered, and no data may be collected.**

This document must be committed to git, unchanged, **before the first study
day**, and the commit must predate it (acceptance criterion AC-T3-2). The
commit hash and date are what make it a pre-registration rather than a
description of what happened. Until then it is a draft that can be edited
freely; after that, any change goes in §12 as a dated amendment, never by
editing the text above it.

Nothing in this document authorises data collection. Collection requires, all
four: written ethics approval, `study/APPROVAL.md` recording it, institutional
permission, and `study.enabled: true` on a server whose config carries the
approval reference (`CLAUDE.md` invariant 9, mechanically enforced by
`server/tests/test_study_gate.py`).

---

## 1. Research question

**RQ3.** Between the two reveal policies the server implements — **M** (photos
available as soon as a match is notified) and **C** (photos available once each
party has sent 8 messages, or both consent) — do observable outcomes differ:
match concentration, conversation depth, unmatching within 24 hours of reveal,
weekly retention, and self-reported frustration?

Policy **P** (photo at discovery) is **not** in the pilot. It exists only in
the simulation, because showing photos while browsing is the thing the product
is built not to do (decision D9). The pilot therefore cannot speak to P at
all; the simulation is the only evidence about it, and is explicitly
model-dependent.

## 2. What this pilot can and cannot establish

Stated before any data exists, because it is the honest frame and it is the
part most easily lost later:

- This is a **pilot**. The expected sample is tens of students on one campus,
  not hundreds. **Low statistical power is expected and will be reported.** A
  null result here is a statement about the pilot's power, not about the
  policies.
- The quantity the research most wants — the **concentration of one-sided
  interest** — is **unobservable by design** (claim C1). The server cannot
  count how many people signalled a given user without breaking the property
  the project exists to demonstrate. So the pilot uses observable proxies, and
  the gap is itself a finding (RQ4, `docs/SECURITY_ARGUMENT.md` §8.2).
- Any difference found is a difference **on one campus, in one term, among
  students who volunteered**. It is not a population estimate.

## 3. Design

A **switchback (ABAB) within-campus design** over four blocks of two weeks:

| Block | Days | Policy |
|---|---|---|
| 1 | 1–14 | **M** |
| 2 | 15–28 | **C** |
| 3 | 29–42 | **M** |
| 4 | 43–56 | **C** |

The order is fixed here, before the first study day, and is implemented as
`reveal.policy_schedule` in the server's config. It is not re-randomised, and
it is not changed mid-pilot.

**Why switchback rather than between-subjects:** on a single campus, splitting
users into two arms would mean a user under M could match someone under C,
which makes a match's policy ill-defined. Switching the whole campus avoids
that. A match keeps the policy that was active when it was created
(SPEC §11.2), so blocks do not contaminate each other through long-lived
matches.

**Known confound, stated in advance:** block and calendar time are perfectly
confounded. Week 1 of term is not week 7 of term. The ABAB order is what
partially addresses this — M appears early and late, as does C — and the
analysis reports block-level estimates rather than pooling the two M blocks as
if they were exchangeable.

**Participants are told the active policy in-app.** Blinding is impossible
(a user sees whether a photo is there) and pretending otherwise would be
dishonest.

## 4. Participants

- Consenting adults (18+), verified by college email, on the one approved
  campus.
- Recruitment: as described in the approved ethics application, and not before
  approval.
- **No target sample size is claimed.** The pilot takes whoever consents in the
  recruitment window. The analysis reports the number per block.
- Withdrawal: available at any time from the app's settings. Withdrawing
  deletes that participant's study data. It does not delete their account
  unless they also ask for that.

## 5. Outcomes

All computed per block, from server-side data only, via
`study/analysis/export.py` (which may not be written until approval exists —
see §10).

**Primary**

1. **Gini of matches received** among active users in the block. Matches, not
   interest: interest is unobservable (§2).
2. **Unmatch within 24 hours of reveal**, as a proportion of matches that
   reached a reveal in the block.

**Secondary**

3. Matches per active user-week.
4. Messages per match (median and mean).
5. Share of matches reaching **≥ 10 messages**.
6. Weekly retention: the share of users active in week *w* who are also active
   in week *w+1*.

**Self-reported (optional, in-app, at the end of each block)**

Three 5-point Likert items, asked once per block:

- S1 "I felt comfortable using Mutual this fortnight."
- S2 "Not being able to see someone's photo was frustrating."
- S3 "Overall, I was satisfied with Mutual this fortnight."

**Definitions, fixed now so they cannot be chosen later:**

- **Active user (in a block):** opened the digest at least once in that block.
- **Active user-week:** a user counted in a week in which they were active.
- **Reveal reached:** under M, the match being notified; under C, photos
  becoming available (8 messages each, or mutual consent).
- **Unmatch within 24 h of reveal:** an unmatch, block or account deletion by
  either party within 24 hours of the reveal instant.

## 6. Analysis

1. **Per-block descriptive tables** for every outcome in §5, with **95 %
   percentile bootstrap confidence intervals** (10 000 resamples, resampling
   users for user-level outcomes and matches for match-level outcomes).
2. **Policy comparison**: M blocks versus C blocks, as a difference in means
   with a bootstrap CI. Reported per block pair as well as pooled, because
   pooling assumes the two M blocks are exchangeable and §3 says they are not.
3. **Unmatch-after-reveal**: a mixed-effects logistic regression with policy as
   a fixed effect and a **random intercept per user**, since one user can
   contribute several matches. Reported with its CI and with the number of
   matches and users it was fitted on.
4. **Survey items**: per-block medians and the distribution of responses. No
   parametric test on 5-point items.

**No p-value threshold is pre-registered, and no claim of significance will be
made.** Estimates are reported with intervals. A pilot this size cannot
support a decision rule, and inventing one after seeing the data is exactly
what pre-registration exists to prevent.

**Multiplicity:** six outcomes plus three survey items are reported. No
correction is applied, because no hypothesis test is being used as a decision
rule; the intervals are reported as they are and the number of outcomes is
stated beside them.

## 7. Stopping rules

- **Scheduled end:** after block 4 (day 56).
- **Stop early, immediately,** if any of these occurs: a safety incident
  involving a participant; a privacy defect found in the server or app; a
  condition of the ethics approval is breached; or the approving body asks for
  a stop.
- **No early stop for a promising result.** There is no interim analysis of the
  primary outcomes, and none may be run. Looking and then continuing is the
  classic way a pilot's intervals stop meaning anything.
- If the pilot stops early, the analysis runs on the blocks that completed and
  says which ones they were.

## 8. Data handled

**Exported for analysis** (counts only, per the de-identification rule in
SPEC §16):

- per user per week: active (yes/no), matches, messages sent, unmatches;
- per match: block, policy, reveal reached (yes/no), reveal instant, message
  counts for each side, ended-within-24h-of-reveal (yes/no);
- per survey response: block, the three Likert values.

User ids are replaced by **HMAC under a study salt** that is generated once,
kept outside the repository, and destroyed when the analysis is complete.

**Never exported:** names, prompt answers, photos, voice notes, message text,
email addresses, dates of birth, crossing pairs, or anything from which a
person could be identified. **Crossing data is not exported at all**, in any
form.

## 9. Pre-specified deviations we expect

Written here so that, if they happen, they are not surprises:

- Recruitment may not fill the window. Then the pilot runs with fewer
  participants and reports the number.
- A participant may use the app on a device where BLE discovery works poorly
  (`docs/BLE_SPIKE.md` risk R2). Those users will have few crossings; they are
  not excluded, and their activity is reported as it is.
- The server's clock, timezone or release time may need a correction during the
  pilot. Any such change is recorded as a dated amendment in §12.

## 10. What is not built yet, and why

`study/analysis/export.py` — the script that reads the real database — is
**deliberately not written**. `CLAUDE.md` invariant 9 forbids writing code that
exports real-user data for analysis unless `study.approval_reference` is set
and `study/APPROVAL.md` exists. Neither is true yet.

What *is* built, because SPEC §16 and PLAN.md Phase 12 allow preparing it:

- `study/analysis/make_synthetic_export.py` — generates a synthetic export with
  the exact schema `export.py` will produce;
- `study/analysis/analyze.py` — runs the whole analysis in §6 on that schema,
  so the pipeline is tested before it ever sees a real row.

## 11. Materials

- `study/CONSENT.md` — what participants agree to.
- `study/PARTICIPANT_INFO.md` — the plain-language information sheet.
- `study/ETHICS_APPLICATION_DRAFT.md` — the draft application.
- `study/APPROVAL.md` — **written by the human, only after approval.** It does
  not exist yet, and the server refuses to start in study mode without it.

## 12. Amendments

Any change after the pre-registration commit goes here, dated, with the reason.
Nothing above this section is edited.

| Date | What changed | Why |
|---|---|---|
| | | |
