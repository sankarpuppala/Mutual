# Decisions log — Mutual

Every question asked, issue found, idea raised and decision made on this
project, in plain words, newest at the bottom. `SPEC.md` holds the rules
themselves; this file holds **how we got there**. Whenever Claude asks the
human a question or a review finds issues, an entry is added here in the same
session (`CLAUDE.md` §8).

Status words: **Adopted** (in the spec), **Rejected** (decided against, with
the reason), **Parked** (good idea, not now), **Open** (waiting for an answer).

---

## Board

### Open questions
| # | Question | Needed before |
|---|---|---|
| Q1 | Which college email domain(s) are allowed to sign up? | Phase 3 |
| Q2 | Confirm the timezone `Asia/Kolkata`. | Phase 3 |
| Q3 | Do you have two Android 12+ phones for the Bluetooth test? | Phase 9 |
| Q4 | Will you run the real-user pilot? Which ethics body approves it? | Phase 12 |
| Q6 | Where will the server run for a demo with more than one phone? | Phase 11 |
| Q8 | In a pilot, who has server (operator) access? They cannot also hold accounts. | Phase 5 |

### Parked ideas
| Idea | Why parked | Where |
|---|---|---|
| Run the UI work in parallel with the research core | The human chose to follow the plan order | PLAN.md deferred #2 |
| Make the AI ranking (`reciprocal_content`) a planned, evaluated deliverable | Strengthens the AI/data-science side; decide later | PLAN.md deferred #3 |
| Revisit the cream/terracotta colours | Judge on a real device first | PLAN.md deferred #4 |
| Say what happens when the 25 MB media prefetch cap is reached | Spec gap; must not depend on what the user looked at | PLAN.md deferred #5 |
| State that discovery needs many users at once | Honesty in the report | PLAN.md deferred #6 |
| "Hold" other date signals while a date mutual is active | Only useful if signals ever become scarce (allowance or subscription) | PLAN.md deferred #7 |
| Run PROMPT.md Prompt 1 (full spec interrogation) | Skipped to keep moving; protocol reviews were run instead | PLAN.md deferred #1 |

---

## 2026-10-05

### 1. First look at the project
- **What came up:** the four planning files describe Mutual, a campus app and
  research project: Bluetooth co-presence, private signals, photos only after
  a match.
- **Issues raised by Claude:**
  - the interface (the human's top priority) comes last in the plan;
  - "like Hinge" conflicts with "no photos before a match";
  - Node.js and Android Studio were missing;
  - the app only works when many students use it;
  - the AI part is thin for an AI & Data Science project.
- **Decision:** keep the no-photo rule. Get the Hinge feel from prompts, type
  and voice notes. A clickable interface prototype was built first.

### 2. Interface prototype — Adopted (D19, SPEC §13.9)
- **Human:** "looks so good … make it exactly the same, changes at the end."
- **Decision:** `docs/design/prototype.html` is the approved look, and the app
  must match it exactly. Extras that came with it became part of the spec:
  profile screen, "Not for me" (on the phone only), "Your turn", and the
  prompt shown at the top of a chat.

### 3. Setup choices (Phase 0)
- **Adopted:**
  - the repository is the project folder itself;
  - Python 3.11 comes from uv (`py -3.11` cannot find it, Q7);
  - Node 24 LTS was installed with winget;
  - files keep LF line endings so test vectors stay byte-identical;
  - `prompt.md` is kept out of git.

### 4. The five reasons (intents) — Adopted (Q5)
- **Human:** study, project, fitness, friend, date: "that's all I can think of".

### 5. First security review of the protocol (15 findings) — Adopted (SPEC v1.2)
An independent reviewer saw only the protocol sections and attacked them.

| Finding | Plain words | Decision |
|---|---|---|
| F1 (critical) | A hacked app could see a match first, then block, so the other person never learned of it | **Adopted:** one nightly matching batch; nothing visible before 8 am; an "ended" mutual stays visible to both |
| F3, F6, F7 | The server got daily keys and could rebuild who was near whom every 15 minutes | **Adopted (human chose 1a):** phones upload only crossing fingerprints, never keys |
| F4 | IP addresses reveal which building you are in | **Adopted:** the server never logs IPs |
| F5 | Copying someone's public key could redirect their signals | **Adopted:** account ids are bound into the pair key; keys must be valid and unique |
| F2 | Ticking all five reasons reveals which one the other person picked | **Adopted** after F1: a match only shows what both chose, which is symmetric |
| F8–F15 | Wording of claims, a digest that changes during the day, responses that reveal accounts, small gaps | **Adopted** |
| F9 (part) | End-to-end encrypted chat | **Rejected:** conflicts with D10 (reports need readable excerpts) |
| F2 (part) | Show each person the other's full signal set | **Rejected:** it would leak one-sided reasons |

### 6. Limit on dating signals — Adopted, then removed (D20)
- **Human idea 1:** date is one person at a time; the other reasons are
  unlimited; slots free instantly. Adopted, and built into the prototype.
- **Human idea 2:** unlimited date signals, but hold the others once a date
  matches, "since they used their daily limit or paid".
- **Claude's view:** the hold idea is safe for privacy, but signals here are
  free and can be withdrawn at any time, so there is nothing to protect. Any
  limit could only be enforced by the app.
- **Decision:** remove per-reason limits entirely for simplicity. The hold
  idea is parked.

### 7. Withdrawing a signal — Adopted (§6.10, §13.6)
- **Human:** "the effect should be immediate".
- **Decision:** a withdrawal is instant on the phone, and the slot frees at
  once. One exception: if tonight's batch has already been sent, that one can
  still match tonight, and the app says so. A "cancel" message to the server
  would itself reveal the signal, so it is not possible.

### 8. Standing permission for security fixes
- **Human:** "approve everything on your own for … attacks and defenses."
- **Decision:** Claude applies pure security fixes without asking and records
  them here. Anything users see, ethics, irreversible actions and git commits
  still go to the human.

### 9. Second security review (12 findings on the new designs) — Adopted (SPEC v1.3)

| Finding | Plain words | Decision |
|---|---|---|
| N1 (critical) | The v1.2 crossing fingerprint could be computed by anyone who overheard both phones. Hidden receivers plus an account would let someone forge crossings and track people | **Adopted:** phones broadcast one-time public keys; fingerprints are keyed with a secret only the two phones share |
| N1 cost | The broadcast grows to 35 bytes, more than classic Bluetooth carries | **Adopted with a check (D23):** the Phase 9 phone test decides the layout; if neither works, the human decides about the v1.0 fallback |
| N2 | The server could see groups and how long people stayed | **Adopted:** no durations are uploaded; one token per crossing is kept; the spec admits the day's crossing graph is visible |
| N6 | Several broadcasting gadgets could turn a walk-past into a crossing | **Adopted:** dwell is judged per single sighting, never summed |
| N3, N8 | A key change, or a withdrawal after upload, could make one side miss a real match | **Adopted:** the phone verifies against the keys and tokens it actually used |
| N4 | Deleting your account right after a match erased it for the other side | **Adopted:** it becomes "ended", with a frozen minimal card |
| N5, N7 | A new shared reason, or a night-time block, could reveal a match early | **Adopted:** each reason gets its own 8 am release; blocks act at release |
| N9 | The digest gave exact times to a hacked app | **Adopted:** one token per person |
| N10 | An "ended" mutual tells the other side who ended it, and invites revenge reports | **Adopted:** documented; such reports are flagged for review |
| N11, N12 | Midnight disagreements, no upload cap, wording contradictions | **Adopted:** ignore the first and last 15 minutes of each day; max 1024 entries; wording fixed |

### 10. Phase 1 implementation choices — Adopted
- `constants.json` is read in place, not copied, so no value is duplicated.
- One error type, `ProtocolError`, lives in `encoding.py`.
- `tests/test_constants.py` was added; it is not in the SPEC §20 list.
- Test vectors are written as hex, with 135 cases.
- `cryptography` is pinned to 50.0.2. It already refuses low-order keys, and
  we check anyway.

### 11. Phase 2 (TypeScript protocol) choices — Adopted
- **Human:** "continue phase 2". Phase 1 was committed (`39e7d21`) but not
  merged into `main`, so the Phase 2 branch starts from the Phase 1 branch.
  Merging is left to the human.
- **Libraries, pinned:** `@noble/curves` 2.4.0 and `@noble/hashes` 2.4.0
  (audited, free); `vitest` 5.0.3; TypeScript 7.0.2; `@types/node` 24.19.1
  for tests only.
- **Issue found while verifying:** noble accepts *non-canonical* public keys,
  such as one with the top bit set, and returns a secret where Python
  refuses. **Decision:** the TypeScript code runs our own key-validity check
  before every exchange, so both languages always agree. The shared
  `public_key_validity` vectors catch any drift.
- **Package shape:** ships its TypeScript source (no build step). The Expo
  app's bundler compiles it in Phase 8.
- **Hermes safety:** `src/` has no Node types, and a test scans `src/` for
  `Buffer`, Node modules, `require`, `Math.random` and `fetch`.
- **New guard:** a pre-commit hook re-runs the TypeScript suite whenever the
  protocol or its vectors change, so the two languages cannot silently
  drift apart.
