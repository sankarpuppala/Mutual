# Fifteen questions you should be able to answer without looking anything up

Written for the student who built this, to be used before a viva or a
supervision. **No answers are given here on purpose.** If you cannot answer one,
re-read the relevant `SPEC.md` section and the code — do not ask an assistant
for the answer and memorise it, because an examiner's second question will go
somewhere the memorised answer does not reach.

The pointer beside each question says where to look, not what to say.

---

## Protocol and privacy claims

**1.** A student taps "send a signal" at 9 in the morning. Walk through
everything that happens, in order, until the other person is told — and say at
each step what the server knows. Then say what changes if the other person
never signals back.
*(SPEC §6.7, §6.9, §6.11; `docs/design-decisions/03-padded-signals.md`)*

**2.** Why exactly twenty tokens? Explain why padding alone is not enough, why
once-per-epoch is not enough either, and why matching has to happen in a batch
rather than inside the request. Name the channel each of the three rules
closes.
*(SPEC §6.11, §6.9; claim C1)*

**3.** The encounter-token design was changed twice before it worked. Describe
the two rejected versions and the specific attack that killed each one. Why
does keying the token with an X25519 shared secret fix all three failures at
once?
*(SPEC §6.13, decision D5; `docs/design-decisions/04-crossings.md`)*

**4.** How do you test that something does not leak? Describe the two-worlds
test, then explain what world C is for and why the test would be worthless
without it. Finally: name something the test would not catch.
*(`server/tests/test_leak_two_worlds.py`; `docs/design-decisions/06-leak-test.md`)*

**5.** An examiner says: "This all falls apart if the server is malicious."
They are right. Explain exactly what a malicious server can do, why it is out
of scope, what would fix it, and why the project is still worth something with
that hole in it.
*(SPEC §7.2; `docs/THREAT_MODEL.md` §3.8)*

## System and engineering choices

**6.** Why does the digest arrive the next morning instead of in real time, and
why is it byte-identical between release times rather than merely "not showing
new people"? What would a user be able to do if it were not?
*(SPEC §11 digest rules, claim C5)*

**7.** The app downloads every voice note in the morning digest before showing
a single card. That is slower and uses more data than loading each one when its
card appears. Defend the choice. What would the server learn under the
alternative?
*(CLAUDE.md invariant 1; `app/src/digest/prefetch.ts`)*

**8.** Where is the cryptography in the Android app, and where is it
deliberately absent? Why does the Kotlin module receive a schedule of ephemeral
ids rather than deriving them itself?
*(SPEC §14.5; CLAUDE.md invariant 7; `app/modules/mutual-ble/`)*

**9.** Quote the measured costs of the privacy design — bytes per signal
upload, bytes per presence upload, worst-case match latency — and explain how
each number arises from a design rule. Which of the three would a user actually
notice?
*(`docs/SECURITY_ARGUMENT.md` §7; `server/tests/test_costs.py`)*

**10.** Someone blocks a person they matched with one second after being told
about the match. Describe precisely what each of the two people sees
afterwards, and defend the design against the obvious objection that a block
should erase the match entirely.
*(SPEC §6.9 fair delivery; CLAUDE.md invariant 12)*

## Research design and what the results show

**11.** State the simulation's headline result with its numbers, then state the
three strongest reasons an examiner should not believe it is a fact about real
students.
*(`sim/results/report.md`; `docs/design-decisions/08-simulation.md`)*

**12.** The sensitivity sweep found conditions under which the headline
conclusion reverses. Name one, explain why it reverses there, and say whether
that makes the result weaker or simply conditional.
*(`sim/results/report.md` "Sensitivity sweep")*

**13.** Policy P — photo at discovery — is the condition the hypothesis is
about, and the product refuses to implement it. Justify that, and say what it
costs the research.
*(Decision D9; `docs/design-decisions/07-policy-p.md`)*

**14.** The field pilot cannot measure the concentration of one-sided interest,
which is the quantity the research is most interested in. Explain why not, what
it measures instead, and why that limitation is a finding rather than a defect.
*(RQ4; `docs/SECURITY_ARGUMENT.md` §8.2; `study/PREREGISTRATION.md` §2)*

**15.** The pilot is a four-block ABAB switchback on a single campus. Explain
why switchback rather than two randomised arms, name the confound that design
does not remove, and say what the analysis does about it.
*(SPEC §16; `study/PREREGISTRATION.md` §3, §6)*

---

## Three you should expect even though they are not on the list

They come up because they are the obvious sceptical questions, and the honest
answers are in the project rather than around it.

- **"Would anyone actually use this, with a day and a half of latency?"** —
  the honest answer is that nobody knows yet, and which pre-registered outcome
  is designed to find out.
- **"What is left that you did not build, and why?"** — the Tier 2 and Tier 3
  gates, the blank tables in `docs/BLE_SPIKE.md` and
  `docs/E2E_CHECKLIST.md`, and why a blank table is a true statement.
- **"Show me somewhere the code does not match the specification."** —
  `docs/design-decisions/09-spec-drift.md` exists so that the answer is a list
  rather than a silence.
