# Consent form — Mutual field pilot

Status: **DRAFT, for the ethics application.** No consent may be sought until
written approval exists and `study/APPROVAL.md` records it. Consent version:
**1** (the version recorded by the server as `consent_version`; bump it
whenever the wording below changes materially).

Written for the participant. Read `study/PARTICIPANT_INFO.md` first — this form
assumes you have.

---

Please tick each box. You can stop at any point, and you do not have to give a
reason.

| | Statement |
|---|---|
| ☐ | I have read the information sheet, and I have had the chance to ask questions. |
| ☐ | I am 18 or over and a student at this college. |
| ☐ | I understand that taking part means using the Mutual app normally, and that there is nothing extra to do. |
| ☐ | I understand that the app changes **when photos appear** every two weeks, that the same setting applies to everyone on this campus at once, and that the app will tell me which setting is active. |
| ☐ | I understand that the information collected about me is **counts only** — whether I opened the app, how many matches and messages I had, and my answers to three optional questions — and that my identity is replaced by a code before anything is analysed. |
| ☐ | I understand that my name, my written answers, my photos, my voice notes and my messages are **never** part of the research data, and neither is who I signalled or who I crossed paths with. |
| ☐ | I understand that I can withdraw at any time from the app's settings, that this deletes my study data, and that I do not have to explain why. |
| ☐ | I understand that if I unmatch or block someone, the conversation is deleted for both of us, but **they will still see that the match happened and ended** — and that neither of us can remove it from the other's history. |
| ☐ | I understand that chat inside a match is **not end-to-end encrypted**, so whoever runs the server can read messages inside my matches. |
| ☐ | I understand that Mutual is an **unaudited research prototype**, not a finished product, and that it protects me from someone reading the server's database but not from someone who controls the server and actively tampers with it. |
| ☐ | I understand that the app never uses GPS or any location permission, and that it does not know where I am. |
| ☐ | I understand that the results may be published, and that only counts and summaries will appear — never anything that identifies me, and never a quotation from my profile or my messages. |
| ☐ | I agree to take part. |

**Optional, and refusing it changes nothing:**

| | Statement |
|---|---|
| ☐ | I am happy to be asked three short questions at the end of each fortnight. |

---

| | |
|---|---|
| Participant's name | |
| Signature | |
| Date | |
| Researcher's name | |
| Signature | |
| Date | |

---

## Notes for the researcher (not part of the form)

- The app records only that consent version **1** was given, and when. It does
  **not** store a copy of this form, a name or a signature: the server stores
  no plaintext identity data (`CLAUDE.md` invariant 5).
- Signed forms are kept wherever the approval says to keep them, which is not
  this repository. **Do not commit a completed form to git.**
- If this wording changes in any way that affects what a participant is
  agreeing to, bump the version here **and** in
  `app/app/(onboarding)/consent.tsx`, and re-consent anyone already enrolled.
- The in-app consent screen must say the same things as this form. If the two
  ever disagree, the form is what the participant agreed to and the screen is
  the bug.
