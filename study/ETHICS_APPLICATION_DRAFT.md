# Ethics application — draft

Status: **DRAFT.** This is the researcher's working text for an application to
an ethics committee. It is not an approval, and it does not authorise anything.
When approval is granted, the body, reference, date and conditions go in
`study/APPROVAL.md` — written by the human, not generated.

Written for an ethics committee: the structure follows the questions such a
committee usually asks, and it avoids technical terms where a plain one exists.
Section numbers will need renumbering to match whichever form is actually used.

---

## 1. Title

Does the timing of photo disclosure change who receives attention in a campus
connection app? A switchback pilot of a privacy-preserving prototype.

## 2. Applicant and supervision

| | |
|---|---|
| Applicant | *(student name, to be completed)* |
| Programme | *(to be completed)* |
| Supervisor | *(name, to be completed)* |
| Department | *(to be completed)* |

## 3. Summary in plain words

Dating and connection apps usually show a photograph first. A common criticism
is that this concentrates attention on a small number of conventionally
attractive people, and that most users receive very little. The applicant has
built a prototype app, **Mutual**, that works differently: it shows people the
written answers of students they physically crossed paths with on campus, and
reveals photographs only after two people have both expressed interest in each
other.

This pilot asks whether **when** a photograph appears changes measurable
outcomes. For two weeks the app reveals photographs as soon as two people
match; for the next two weeks only after they have exchanged several messages;
then it alternates again. The study measures how evenly matches are
distributed, how long conversations last, how often people end a match right
after seeing a photograph, how many keep using the app, and what they report
about their own experience.

A prior simulation of the same question has already been run and is complete
(`sim/results/report.md`). It suggests the effect exists under its modelling
assumptions. This pilot is the first attempt to look for it in a real, small
population, and is expected to be underpowered — it is a pilot, not a trial.

## 4. The three things a committee will most want to know

Put first rather than last, because they are the whole substance of the
application.

### 4.1 This app collects less than the alternatives, by construction

- **No location, ever.** The app uses Bluetooth proximity only. It does not
  request any Android location permission, and the build is checked
  automatically to confirm none is present. It cannot know where a participant
  is or has been.
- **Expressions of interest are cryptographically unreadable, including to the
  researcher.** When a student signals interest in someone, the phone sends a
  fixed set of 20 values once a night at a random time; 19 or 20 of them are
  random noise, and the real one is derived from a key only the two phones
  involved hold. The server can detect that two people signalled *each other*
  for the same reason, and nothing else. There is no record of unreturned
  interest anywhere, so there is nothing to disclose, subpoena or leak.
  This is tested, not asserted: `server/tests/test_leak_two_worlds.py`.
- **The study data is counts only.** No names, no written answers, no
  photographs, no voice notes, no message text, and no record of who crossed
  paths with whom. Participant ids are replaced by a keyed hash before
  analysis, and the key is destroyed afterwards.

### 4.2 The limitations, stated by the applicant rather than discovered

- **Chat is not end-to-end encrypted.** Whoever runs the server can read
  messages inside matches. Participants are told this in the information sheet
  and on the consent form.
- **The protection assumes an honest server.** The design protects against
  someone *reading* the database. It does **not** protect against someone who
  controls the server and actively tampers with it — such a person could learn
  who signalled whom. This is documented in the project's own threat model and
  is stated to participants.
- **The app is an unaudited prototype.** No independent security audit has been
  performed. The applicant's own tests are public and extensive, which is not
  the same thing.
- **Participation is effectively all-or-nothing during the study.** The
  photo-timing setting changes for the whole campus at once, so a student
  cannot use the app during the study while opting out of it. This is a design
  consequence of the switchback, and the applicant draws the committee's
  attention to it as the application's weakest point on voluntariness. The
  alternative — splitting the campus into two arms — was rejected because a
  match between a student in each arm has no well-defined policy. **If the
  committee considers this unacceptable, the applicant's proposed remedy is to
  shorten the pilot to a single policy period with no switching, losing the
  within-campus comparison.**

### 4.3 Safety, and what happens when something goes wrong

- 18+ only, verified by college email, with date of birth checked once and
  discarded.
- Block and report are available at every point, including before any match.
  Blocking is immediate and silent: the blocked person is not told.
- Reports go to a human moderation queue. **Nothing is acted on
  automatically.**
- Reports and blocks are the only user actions the server records as
  disclosures, and participants are told so.
- A participant can pause being discoverable, or delete their account, from the
  settings screen at any time. Deletion removes profile, matches and messages
  within 24 hours.
- The applicant will respond to a safety report within one working day during
  the pilot, and the pilot **stops immediately** on any safety incident
  involving a participant (pre-registered stopping rule).

## 5. Design and procedure

A switchback (ABAB) design over four two-week blocks on one campus: M, C, M, C.
The order is fixed in a pre-registration committed to version control before
the first study day (`study/PREREGISTRATION.md`), which also fixes the outcomes
and the analysis.

Participants use the app normally. At the end of each block the app asks three
optional five-point questions. There is nothing else to do.

## 6. Participants, recruitment and consent

- **Who:** students aged 18+ at the one approved campus, verified by college
  email address.
- **How many:** no target is claimed. The pilot takes whoever consents; the
  number per block is reported. Tens, not hundreds, is the realistic
  expectation.
- **Recruitment:** *(to be completed with the exact method the committee
  approves — e.g. a notice on a department board and a talk at one society
  meeting. The applicant will not recruit through personal messages, and will
  not recruit students the applicant teaches or assesses.)*
- **Consent:** the information sheet and consent form
  (`study/PARTICIPANT_INFO.md`, `study/CONSENT.md`) are given before any data
  exists. The app also shows a consent screen, and the server **refuses to
  create an account in study mode without a recorded consent version**.
- **Withdrawal:** at any time, from the app's settings, with no explanation.
  Study data is deleted. The participant's account is not deleted unless they
  ask.
- **Incentives:** none.

## 7. Data management

| | |
|---|---|
| What is collected | Weekly counts per participant; per-match counts and timings; optional Likert responses |
| What is never collected | Names, answers, photos, voice notes, message text, email addresses, dates of birth, crossing pairs, location of any kind |
| De-identification | Participant ids replaced by HMAC under a study salt, generated once, stored outside the repository, destroyed on completion |
| Where it is stored | *(to be completed: the applicant's institutional storage, encrypted at rest)* |
| Who can see it | The applicant and the supervisor |
| Retention | Export retained for *(to be completed)*; the server's own operational data follows the retention rules in `SPEC.md` §9 — crossings for 7 days, presence uploads deleted at a 2-day cutoff |
| Transfers | None outside the institution |
| Publication | Counts and summaries only; no quotation from any participant's profile or messages |

**Governance rule the applicant commits to:** anyone with operator access to
the server holds **no participant account**. The project's threat model records
that an operator who is also a user could test interest directed at themselves,
and a technical fix is not possible — so it is handled as a rule rather than
pretended away.

## 8. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| A participant is recognised by their first name, year and answers | Certain — it is how the app works | Stated prominently in the information sheet; no surname, course or hometown is collected; photos are withheld until a mutual match |
| An unwanted or persistent approach after a match | Low | Block and report at every point; blocking is silent and immediate; a 20-signal cap limits mass probing |
| A participant finds a match ending after a photo appears upsetting | Medium — it is one of the outcomes being measured | Information sheet names it; the app's copy is deliberately non-judgemental; no "they unmatched you" notification exists |
| A participant feels pressure to take part because the whole campus is in the study | Medium | §4.2; the honest alternative (not using the app during the study) is stated on the information sheet |
| Operator reads messages inside matches | Possible by design | Disclosed in the information sheet and consent form; messages are not part of the research data |
| A privacy defect in the prototype | Unknown | Extensive automated privacy tests run on every commit; **pre-registered stopping rule: the pilot stops immediately if a privacy defect is found** |
| Battery drain affects a participant's day | Medium | Measured before the pilot (`docs/BLE_SPIKE.md`); discovery can be paused at any time; if drain exceeds 10 % per 8 hours the duty cycle is revised before any pilot |
| Under-18 student gains access | Low | Date of birth checked at account creation and discarded; college email required |

## 9. What the pilot cannot show

The applicant states this in advance so the committee can judge the
proportionality of collecting anything at all:

- The pilot is **underpowered** and cannot establish an effect. It can show
  whether the measurement pipeline works, give interval estimates, and surface
  practical problems.
- The quantity of greatest interest — how unevenly *one-sided* attention is
  distributed — is **unobservable by design**, because the protocol makes it
  unreadable even to the researcher. Only proxies are available. This is a
  finding of the wider project rather than a defect of the pilot.
- Policy **P** (photographs visible while browsing) is **not** tested, because
  the product does not implement it. Only the simulation speaks to P.

## 10. Attachments

- `study/PARTICIPANT_INFO.md` — information sheet
- `study/CONSENT.md` — consent form
- `study/PREREGISTRATION.md` — pre-registration (design, outcomes, analysis,
  stopping rules)
- `docs/THREAT_MODEL.md` — threat model, including out-of-scope adversaries
- `docs/SECURITY_ARGUMENT.md` — the privacy claims mapped to the tests that
  check them, and the measured costs
- `sim/results/report.md` — the completed simulation this pilot follows up
- `docs/E2E_CHECKLIST.md` — the manual verification the applicant will complete
  before any participant is recruited

## 11. Declaration

The applicant will not collect any research data from any person until written
approval exists, its reference is recorded in `study/APPROVAL.md` and in the
server's configuration, and institutional permission has been obtained. The
server is built to refuse to start in study mode otherwise, and that refusal is
covered by an automated test (`server/tests/test_study_gate.py`).

| | |
|---|---|
| Applicant's signature | |
| Date | |
| Supervisor's signature | |
| Date | |
