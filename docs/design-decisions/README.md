# How Mutual is built, and why

Written for someone who has not seen this project before — a supervisor, an
examiner, or whoever picks it up next. It explains the decisions, not the API.

These pages are built from `SPEC.md` (especially its §21 decisions log),
`PLAN.md`, the Progress log, `docs/DECISIONS_LOG.md` and the git history. Where
the code and `SPEC.md` disagree, the page says so rather than smoothing it
over — §9 collects every such case found while writing this.

Mutual is an **unaudited research prototype**. Nothing here has been
security-audited.

---

## The pages

| # | Page | What it answers |
|---|---|---|
| 1 | [The shape of the thing](01-architecture.md) | How the protocol, server, app and simulation connect, and what each one is for |
| 2 | [The threat model, in one page](02-threat-model.md) | Who the design defends against, who it does not, and the one limitation that matters most |
| 3 | [Why twenty signals, once a night, at a random time](03-padded-signals.md) | The single most important design decision in the project |
| 4 | [Why the server resolves crossings, and what it learns](04-crossings.md) | How proximity becomes a crossing without anyone learning a location |
| 5 | [Why the digest arrives tomorrow morning](05-morning-letter.md) | The deliberate latency, and what it buys |
| 6 | [Why the leak test is built the way it is](06-leak-test.md) | How you test the absence of a leak, and why a passing test is not enough |
| 7 | [Why policy P exists only in the simulation](07-policy-p.md) | The one reveal policy the product refuses to implement |
| 8 | [What the simulation can and cannot tell us](08-simulation.md) | The result, and the honest limits on it |
| 9 | [Where the code and the spec disagree](09-spec-drift.md) | Every discrepancy found, listed rather than quietly fixed |

If you read only two, read 3 and 6. Everything else follows from them.

---

## The project in one page

**The problem.** Dating and connection apps know who you are interested in,
even when it is not returned. That record is the most socially dangerous data
such an app holds: it causes humiliation when it leaks, it can out people, and
it is the thing every one of these apps stores in plaintext. It is also what
their recommendations are trained on, so nobody has much incentive to stop.

**The claim.** You can build co-presence discovery and mutual matching so that
the server's stored data and its observed traffic are **independent of
one-sided interest** — and the cost is measurable and small.

**The mechanism**, in four steps:

1. Phones notice each other over Bluetooth, never GPS, and never in real time.
2. Each night a phone turns what it heard into **encounter tokens** that only
   the two devices involved can compute, and uploads a padded set of them. The
   server pairs matching tokens and learns a day-granularity crossing graph.
3. The next morning you see the people you crossed, through their written
   answers rather than their photos, and can signal any of them for one of
   five reasons.
4. Signals never leave individually. Each evening the phone uploads **exactly
   twenty** tokens at a random time, nineteen or twenty of which are random
   noise. The server intersects the sets. A pair that both signalled the same
   intent is told the next morning. Nobody else learns anything, including the
   server.

**The evidence.**

| Claim | Evidence |
|---|---|
| The server learns nothing about unreturned interest | `server/tests/test_leak_two_worlds.py` — two worlds compared on stored rows, request logs and response bodies, plus a third world that must detect a match so the test cannot pass vacuously |
| No intent reaches the server | `server/tests/test_route_audit.py` — an automated audit of every request and response schema |
| No location | A manifest check, schema tests, retention tests |
| No real-time proximity | Byte-identical digests between release times, under an injected clock |
| It costs little | 932 bytes a day for signals; 12.7–24.5 KB a night for presence; 38 hours worst-case match latency. All measured, in `server/tests/test_costs.py` |
| Photo timing changes who gets attention | `sim/results/report.md` — 90 simulated runs plus a 4,050-run sensitivity sweep, with the reversals reported |

**What it costs.** A day and a half of latency, no interest-trained
recommendation, no way to measure one-sided attention *even for the research*,
and no real-time anything. Page 8 and `docs/SECURITY_ARGUMENT.md` §8 are the
full ledger.

**What is not defended.** An **active** server that substitutes a public key
learns everything. That is the honest headline limitation, it is out of scope,
and the fix (key transparency) is future work. Page 2 has the rest.

---

## Reading the repository

```
packages/protocol-spec/   constants.json and the committed cross-language vectors
packages/protocol_py/     the reference implementation (Python)
packages/protocol-ts/     the same bytes, in TypeScript, for the app
server/                   FastAPI: accounts, presence, digest, matching, chat, safety
sim/                      the agent-based simulation and its results
app/                      the Android app (Expo) and the native BLE module
study/                    field-pilot materials — gated on ethics approval
docs/                     threat model, security argument, checklists, these pages
```

The four files that govern everything: `CLAUDE.md` (the rules), `SPEC.md` (the
contract), `PLAN.md` (the phases and what actually happened), and
`docs/DECISIONS_LOG.md` (every question and decision, in plain words).
