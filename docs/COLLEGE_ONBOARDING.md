# Bringing Mutual to a college

There is no switch anyone can flip to get "official access" to a college. A college
doesn't give an app an API. What it can give is **permission, a named contact and
trust**. This document covers how Mutual asks for those, what the software already does to
support it (SPEC §4.1, §4.2), and the order to do things in.

---

## 1. How a campus opens in the software

A campus is the set of students whose verified email is at one college's domain. Nobody
ever sees, crosses, signals or matches anyone from another campus (invariant 13). A campus
opens **only** when an operator opens it. There are three routes into that decision:

| Route | What happens | When to use it |
|---|---|---|
| **Official application** (recommended) | A college official fills in `https://<host>/colleges`, proves they hold an address at the college's domain with an emailed code, and appears under **Admin → Applications**. You talk to them, then press *Open as a partner*. The campus is marked **partner**. | Every college you do not personally belong to. |
| **Student demand** | A student tries to sign up from an unopened academic domain (`*.ac.in`, `*.edu.in`, `*.edu`). The server records only the domain and a count, never the email. It shows up under **Admin → Overview → Most-requested colleges**. | A signal of where to reach out next, never a reason to open on its own. |
| **Direct** | An owner opens a domain from **Admin → Colleges** (or `python -m mutual_server.admin campuses approve`). Marked **student demand**, not partner. | Your own college for the first pilot, after the conversations in §2. |

The application route also works for colleges whose domain is not academic, such as
`christuniversity.in`, because the operator adds the exact domain the official verified.
**Admin → Colleges** lets you add more domains to one campus, for example a separate
student-mail domain. A domain can belong to only one open campus.

Why no college ever opens automatically: some schools use the same suffixes, the app is
18+ with a self-declared age, and a campus only works if someone at the college has agreed
to be the safety contact.

## 2. Getting your own college to say yes

Start with the college you study at. It is the only one where you are not a stranger.

1. **Your supervisor.** They are already an operator (SPEC §19, Q8). Ask which office
   approves student-facing software. It is usually the Dean of Student Affairs, sometimes
   the Registrar or an IT committee.
2. **The ethics question, settled first.** Running Mutual as an ordinary campus app is not
   research. Collecting anything for the study (Tier 3) is, and needs your institution's
   ethics committee approval first. That is Board question **Q4**, and only you can answer
   it (`study/ETHICS_APPLICATION_DRAFT.md` is ready). Be clear with the college which of
   the two you are asking for.
3. **A one-page request** to the Dean of Student Affairs. Include:
   - what it is, in three sentences: the `/colleges` page text works;
   - what it never collects: no location, no contacts, no analytics, emails stored only as
     keyed hashes (SPEC §7.3, §9);
   - that it is an **unaudited research prototype**, said plainly;
   - what you are asking for:
     a) permission to invite students,
     b) a named **safety contact** who receives a moderator login,
     c) IT allow-listing of the login-code sender address,
     d) optionally, the student council's endorsement and a launch slot at an event;
   - how to stop it: you close the campus on request, and accounts can be deleted from the
     app's You tab at any time.
4. **Have the official apply at `/colleges`** with their college address, even though you
   know them. That leaves a verified record in the system of who asked, and when.
5. **Open the campus** from the application, then add their moderator account:
   **Admin → Operators → Add**, scope = their campus. They see only that college's reports
   and users, never another college's, and they cannot open colleges or add operators.

### Data protection (India)

The Digital Personal Data Protection Act, 2023 governs processing of digital personal data
in India. Ask your institution's legal or ethics office how it applies to your deployment,
and record the answer. Mutual's design already minimises what is held (no location, no
plaintext emails, codes or tokens, and deletion on a schedule, SPEC §9). The institution may
still want a privacy notice, a named grievance contact and a breach-response plan. The
safety contact in step 3 can usually double as the grievance contact. This document is not
legal advice.

## 3. Launching so it actually works

Discovery needs **many students running the app at the same time** (deferred note #6).
Opening a campus quietly produces empty mornings, and people uninstall. So:

- **Launch in one dense place first.** A single department, hostel or year, all at once,
  for example at an orientation event the student council runs.
- **Say what to expect.** "Your first letter arrives the morning after you've spent time
  near other people using Mutual." That is honest, and it stops "the app is broken" reports.
- **Watch, don't tune.** The Overview counts are for running the service. They are not
  study data. Using them as research results is exactly what invariant 9 forbids without
  approval.

## 4. Running a campus

- **Reports:** Admin → Reports, every day. A report carries the conversation excerpt the
  reporter chose to share. *Suspend reported user* stops the account at once. *Mark
  resolved* closes the report. Every action goes into the audit log.
- **Finding an account:** accounts are reached from a report, or by user id under
  Admin → Users. There is deliberately no list or search of every student. The app does
  not show students their own id, so a student who writes to you about their account is
  answered by email (deleting an account is in their own You tab).
- **Your moderator leaves the college:** Admin → Operators → Disable. Their sessions end
  immediately.

### Known gap: closing a campus

There is no "close campus" action yet. Declining works only for colleges that are not
yet open, and an open campus always keeps at least one domain. To wind a campus down
today, ask students to delete their accounts from the app, and suspend any that remain
(Admin → Users). A proper close action needs a spec decision first: what happens to
existing mutuals and messages, and how much notice students get. It is on the Board in
`docs/DECISIONS_LOG.md`.

## 5. Email to send a college (template)

> Subject: Request to pilot Mutual, a privacy-first campus connection app, at <College>
>
> Dear <Dean>,
>
> I am a student in <Department> working with <Supervisor> on Mutual, a research prototype
> that helps students meet people they already share campus spaces with, for study
> partners, projects, fitness, friendship or dating. It uses Bluetooth between phones,
> never GPS, never stores locations, and reveals interest only when it is mutual. It has
> not been independently security-audited, and we say so to every user.
>
> We would like permission to invite <College> students, a named safety contact who would
> receive a moderator login for <College> reports only, and IT's help allow-listing our
> sender address. The details, and a short form for your office, are at
> https://<host>/colleges.
>
> Could we have 20 minutes to walk you through it?
>
> <Name>, <Phone>
