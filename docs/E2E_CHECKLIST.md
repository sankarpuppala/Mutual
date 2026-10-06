# End-to-end checklist

Status: **written, not yet run.** Every date column is blank on purpose. This
file is the evidence for acceptance criterion **AC-T2-5**, which passes only
when every item is ticked *with a date* — so a blank row is a true statement
about this project and a ticked row with no date is not evidence of anything
(`CLAUDE.md` §8 rule 4).

Running it needs an Android emulator, which needs a JDK and the Android SDK.
Neither is installed on the development laptop yet; see the Phase 8 entry in
`PLAN.md`.

---

## What you need

- **Two emulators** (API 31+), or one emulator and one phone. Two accounts are
  required for everything from §4 onwards: a mutual match needs two people.
- **The server in dev mode**, which prints OTP codes to its console and enables
  `/v1/dev/*`:
  ```powershell
  $env:MUTUAL_ENV="dev"; uvicorn mutual_server.main:create_app --factory --reload --no-access-log --app-dir server
  ```
- **The dev build on each device**: `npx expo run:android` from `app/`.
- The emulator reaches the host machine's server at `http://10.0.2.2:8000`,
  which is `app.config.ts`'s default.

Two things make this runnable in an afternoon rather than a week, and both are
in the dev panel: **clock travel** (to pass a release time or a batch time) and
**a simulated crossing** (so you need not carry two phones around a campus).

Record the actual behaviour, not the intended one. If something differs from
the expected result, write what happened in the notes column rather than
ticking it.

---

## 1. Onboarding (journey J1)

| # | Step | Expected | Date | Notes |
|---|---|---|---|---|
| 1.1 | Open the app for the first time | Welcome screen; the italic word in the title is terracotta | | |
| 1.2 | Tap "What Mutual can and can never see" before signing up | The privacy screen opens, with both lists | | |
| 1.3 | Get started → three How-it-works panels | Dots advance; "Skip" jumps straight to the email step | | |
| 1.4 | Enter a non-college address | "That has to be a college address" | | |
| 1.5 | Enter an allowed college address | Moves to the code step; the code appears in the **server console** | | |
| 1.6 | Enter a wrong code | "That code is not right" | | |
| 1.7 | Enter the right code | Moves on (consent screen if the server is in study mode, otherwise the age step) | | |
| 1.8 | Enter a date of birth under 18 | "Mutual is for students aged 18 and over", and **nothing is sent** (check the server log) | | |
| 1.9 | Enter a valid date of birth, a first name and a year | Account created; identity key generated | | |
| 1.10 | Answer three prompts, one of them "I'm looking for" | Saved; the sheet refuses fewer than three | | |
| 1.11 | Record a voice answer | Stops itself at 30 s; 48 waveform bars appear in the player | | |
| 1.12 | Add two photos | Uploaded; copy says they appear only after a mutual | | |
| 1.13 | Allow Bluetooth and notifications | Granted. **Confirm in Android settings that there is no location permission to grant at all** | | |
| 1.14 | Finish | Today tab, before the release time: "Your morning letter arrives at 8." | | |
| 1.15 | Time it from 1.1 to 1.14 | Under 3 minutes (AC for Phase 10) | | |

Repeat §1 on the second device with a different college address, and note both
accounts' `user_id` from their dev panels — §4 needs them.

## 2. Presence and the digest (journey J2, claim C5)

| # | Step | Expected | Date | Notes |
|---|---|---|---|---|
| 2.1 | Dev panel → "Generate fake BLE sightings" | Log says sightings were generated and stored | | |
| 2.2 | Dev panel → "Run the nightly work now" | Log reports a presence upload for yesterday | | |
| 2.3 | Server log | One `POST /v1/presence/<day>` with **256 entries** for a handful of sightings | | |
| 2.4 | Today tab, still before the release time | No crossings visible, whatever was uploaded | | |
| 2.5 | Dev panel → clock travel +24 h, then reopen Today | Yesterday's crossings appear, each with a coarse chip ("Yesterday · evening") | | |
| 2.6 | Pull Today again without travelling further | **Byte-identical**: no new cards appear mid-day | | |
| 2.7 | Open a card's profile, play a voice note | Plays from the cache. **Confirm the server log shows no request at that moment** (this is AC-T2-2's headline, and claim C1 from the client side) | | |
| 2.8 | A card with no voice note | Player absent, not a disabled stub | | |

## 3. Signals (journey J3, claim C1)

| # | Step | Expected | Date | Notes |
|---|---|---|---|---|
| 3.1 | Send a signal from a card, pick two intents | Card shows "Sent · Study, Project" | | |
| 3.2 | Server log at that moment | **No request at all.** The signal has not left the device | | |
| 3.3 | Signals tab | Twenty dots, two filled; the peer's name and both intents; "until …" | | |
| 3.4 | Withdraw it | Slot freed at once; "Signal withdrawn. Nobody was ever told." **No request** | | |
| 3.5 | Send 20 signals | 21st attempt refused with "All 20 signals are out" | | |
| 3.6 | At the cap, change one peer's intent | Allowed: the count does not change | | |
| 3.7 | Dev panel → "Run the nightly work now" inside the upload window | One `PUT /v1/signals/<epoch>` with **exactly 20 tokens**, whatever the real count | | |
| 3.8 | Run it again immediately | **No second request.** Once per epoch | | |
| 3.9 | Withdraw a signal after the upload | Copy now says it already left with tonight's set and could still match tonight | | |
| 3.10 | Send no signals at all on another night, then run the nightly work | **Still exactly 20 tokens uploaded.** This is the request that makes every other night unreadable | | |
| 3.11 | Travel past `match_batch_time`, then run the nightly work | Nothing uploaded; log says `skip:after_batch_time` | | |

## 4. A mutual match (journey J4, invariant 12)

| # | Step | Expected | Date | Notes |
|---|---|---|---|---|
| 4.1 | On device A's dev panel, create a crossing with B's user id | Log confirms it for yesterday | | |
| 4.2 | Travel both devices past the release time | Each sees the other in Today | | |
| 4.3 | A signals B for "study"; B signals A for "project" | Both cards show "Sent" | | |
| 4.4 | Run the nightly work on both, then travel past the batch time | **No match**: different intents never match (claim C2) | | |
| 4.5 | B also signals A for "study"; run both uploads; travel past the batch time | Still nothing visible yet — the match is pending until the next release | | |
| 4.6 | Travel past the next release time; open Mutuals on **both** devices | Both see "New this morning", with the shared intent named | | |
| 4.7 | Compare the two devices | Both show the same intents. Neither sees anything the other does not | | |

## 5. Reveal (journey J5, SPEC §11.2)

| # | Step | Expected | Date | Notes |
|---|---|---|---|---|
| 5.1 | Under policy **M**, tap "See <name>" | Avatar dissolves into the photo over ~900 ms; shared intents beneath | | |
| 5.2 | Try to screenshot the reveal | **Blocked** (`FLAG_SECURE`) | | |
| 5.3 | Turn on the OS reduce-motion setting; open a reveal again | **Instant**, not merely faster | | |
| 5.4 | Switch the server to policy **C** (`reveal.policy_schedule`) and make a fresh match | Mutuals row says "Photos after N more messages each"; no reveal offered | | |
| 5.5 | Exchange fewer than N messages each | Still no photos | | |
| 5.6 | Exchange N each | Reveal happens; photos available on **both** devices | | |
| 5.7 | Under C, both tap reveal-consent before N messages | Photos available early, on both sides | | |

## 6. Chat (journey J6)

| # | Step | Expected | Date | Notes |
|---|---|---|---|---|
| 6.1 | Open a conversation | Opens with the peer's first prompt as context | | |
| 6.2 | Send a message | Appears as an indigo bubble; arrives on the other device within ~5 s | | |
| 6.3 | Send an empty message | Refused | | |
| 6.4 | Send 1001 characters | Capped at 1000 | | |
| 6.5 | Watch the server log while typing | **Nothing.** No typing indicator, no read receipt | | |

## 7. Safety (SPEC §8)

| # | Step | Expected | Date | Notes |
|---|---|---|---|---|
| 7.1 | Chat → menu → Report, pick a reason | "Report sent. A moderator will look at it." | | |
| 7.2 | Report an id that does not exist (via curl) | Same 204, no effect | | |
| 7.3 | Unmatch | Conversation deleted on both; **the other device still shows the match as ended**, with no chat and no photos (invariant 12) | | |
| 7.4 | Block from the other device | Immediate; the blocked person is **not** told | | |
| 7.5 | After a block, travel to the next release | Neither appears in the other's letter | | |
| 7.6 | Profile → "Not for me" | That peer's cards disappear **on this device only**; server log shows no request | | |
| 7.7 | Check the other device | Still sees you normally — "Not for me" was never uploaded | | |

## 8. Pause and deletion (S6, S11)

| # | Step | Expected | Date | Notes |
|---|---|---|---|---|
| 8.1 | You tab → turn Discovery off | Banner on Today; the foreground-service notification disappears | | |
| 8.2 | Other device, next release | You are absent from their letter | | |
| 8.3 | Turn Discovery back on | Notification returns; you reappear at the next release | | |
| 8.4 | Reboot the phone with discovery **off** | Discovery stays off (the boot receiver respects the pause) | | |
| 8.5 | You tab → Delete account → confirm | Returns to Welcome; secure storage and the local database are wiped | | |
| 8.6 | The other device's Mutuals | The match remains as **ended**, with a frozen card and no chat | | |
| 8.7 | Try the old session token (via curl) | 401 | | |

## 9. Accessibility (SPEC §13.7)

| # | Step | Expected | Date | Notes |
|---|---|---|---|---|
| 9.1 | OS font size at 200% | Every screen still readable; no name or prompt answer truncated | | |
| 9.2 | TalkBack on | Every button and card has a spoken label; the signal sheet's chips announce selected/not selected | | |
| 9.3 | Reduce-motion on | No sheet or reveal animation; layout unchanged | | |
| 9.4 | Greyscale display | Selected intent chips still distinguishable (tick plus border, not colour alone) | | |
| 9.5 | Both themes, every screen | Matches `docs/design/prototype.html` side by side | | |

## 10. The privacy checks, run once at the end

| # | Step | Expected | Date | Notes |
|---|---|---|---|---|
| 10.1 | `npm run check:privacy -w app` | Passes, against the **merged** manifest from the build | | |
| 10.2 | `npm run check:contrast -w app` | Passes for both themes | | |
| 10.3 | `npm test -w app` | Passes | | |
| 10.4 | Android settings → Mutual → Permissions | **No location permission exists to grant** | | |
| 10.5 | Grep the server's database for anything that should not be there | No email address, no date of birth, no EID, no daily key, no time of day | | |

---

## Signed off

AC-T2-5 passes when every row above is ticked with a date.

| Field | Value |
|---|---|
| Run by | |
| Devices used | |
| Server commit | |
| App commit | |
| Date completed | |
