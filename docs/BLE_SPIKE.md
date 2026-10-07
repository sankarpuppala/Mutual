# BLE spike — measurement protocol and results

Status: **procedure written, measurements not yet taken.** Every results table
below is blank on purpose. Nothing in this file may be filled in from
expectation, a datasheet or a plausible guess — only from a measurement taken
on two physical Android 12+ phones (`CLAUDE.md` §8 rule 4: never invent
results). An empty row is a true statement about this project; a guessed row
is a false one.

Covers `PLAN.md` Phase 9a and acceptance criterion **AC-T2-6**.

---

## 1. Why this spike exists

Mutual's whole discovery mechanism rests on one Android behaviour that the
documentation does not settle: whether a BLE advertisement is still delivered
to a scanner when the scanning app has declared `BLUETOOTH_SCAN` with
`usesPermissionFlags="neverForLocation"` and holds **no** location permission.
Android's own documentation says that under that flag some beacons are filtered
out of scan results. If Mutual's advertisement is one of them, Tier 2 does not
work as designed.

The rule, stated before any measurement so it cannot be bent afterwards: **if
detection requires a location permission, stop and escalate.** Never add the
permission (`CLAUDE.md` invariant 3). Tier 1 — the protocol, the server, the
leak tests and the simulation — is unaffected either way, which is why it was
built first.

A second open question is almost as important: Mutual's payload is **35 bytes**
(`magic(2) || version(1) || EID(32)`), and a legacy advertisement carries at
most 27 bytes of manufacturer data. So one of two layouts has to work
(`SPEC.md` §14.2, decision D23):

| Layout | How | Risk |
|---|---|---|
| **1. Extended advertising** (preferred) | BLE 5 `AdvertisingSet` with `setLegacyMode(false)`, all 35 bytes in one advertisement | Needs BLE 5 on both phones; some mid-range chipsets refuse it |
| **2. Legacy split** (fallback) | Advertisement carries `magic ‖ version ‖ EID[0:24]`; the scan response carries `EID[24:32]`; the scanner uses active scanning and joins them | Two packets to catch instead of one, so a lower detection rate |

The code already implements both and reports which one it achieved
(`app/modules/mutual-ble/android/.../BleRadio.kt`, surfaced through
`NativeBle.advertiseLayout()`). The spike records the answer rather than
assuming it.

### 1a. A known defect in layout 2, to be settled first

**The receiving half of the legacy split is believed not to work at all**, and
settling this is the first thing to do with the two phones — before any
detection-rate run, because a rate measured through a broken parser is a
measurement of the parser.

The two halves are both manufacturer-specific data under company id `0xFFFF`.
Android's `ScanRecord` parses manufacturer-specific data into a map keyed by
company id, so when the stack merges an advertisement with its scan response the
second structure overwrites the first. `BleRadio.scanCallback` then calls
`getManufacturerSpecificData(0xFFFF)` once and gets one of the halves: the tail
has no magic prefix and is rejected, the head is 24 bytes and is dropped later
for not being 32. Either way **no encounter token is produced**, silently, while
the app reports that it is advertising.

What has been done so far: `NativeBle.status()` now reports
`legacy_fallback_unverified` instead of claiming discovery works, so the
condition is visible rather than hidden. No fix has been written, because both
candidates are guesses about merge behaviour on hardware this project does not
have, and untested Kotlin written against a guess is what caused the two module
bugs in `DECISIONS_LOG.md` 27.

| Step | What to measure | Result |
|---|---|---|
| 2a-1 | Force layout 2 on phone A (skip `startExtended`). Log the full `ScanRecord.getBytes()` seen by phone B. Does it contain **both** `0xFFFF` structures, or only one? | |
| 2a-2 | Does `ScanFilter` on `(0xFFFF, magic‖version)` still match the merged record, or is the device filtered out entirely? | |
| 2a-3 | Are the advertisement and the scan response delivered as **one** merged `onScanResult`, or as two with the same device address? | |

The answer decides which of three things happens, and the choice is the
human's:

- **2a-1 shows both structures present** → fix is a parser change only: read
  `record.getBytes()` and join the two halves there. The bytes on air do not
  change, so this is not a protocol change.
- **2a-2 shows the filter rejects it** → the scan filter has to be relaxed for
  this path, which costs battery, and that trade belongs in `SPEC.md` §14.2.
- **Neither works** → the split layout is not implementable as specified. §14.2
  changes: either the tail moves to a service-data element (a protocol change
  under invariant 8, needing a `protocol_version` bump) or the fallback is
  dropped and devices without BLE 5 are declared unsupported, honestly, in the
  report.

Recorded as **Q10** on the `DECISIONS_LOG.md` Board.

---

## 2. What you need

- Two physical Android phones, both Android 12 (API 31) or newer. Note the
  brand and model of each: Android's background limits differ sharply between
  manufacturers, and a result from two phones of the same brand is a weaker
  result (risk R2).
- A dev build of the app installed on both (`npx expo run:android` from
  `app/`), which needs a JDK 17 and the Android SDK on the development
  machine.
- A pocket. Several of the measurements below are specifically about a phone
  in a pocket, because that is where a phone spends a campus day, and a phone
  on a desk is the easy case.
- About four hours, plus one 8-hour window with the phones left alone for the
  battery measurement, plus a second 8-hour control window.

---

## 3. Procedure

Record every measurement in the tables in §4 as you take it, including the
ones that come out badly. A spike that only records successes is not a spike.

### 3.1 Does detection work with `neverForLocation`? (the gating question)

1. Confirm the installed build's manifest: `npm run check:privacy -w app`
   must pass, which asserts `neverForLocation` is present and that no location
   permission is declared.
2. In Android settings, confirm neither phone has granted Mutual any location
   permission. There should be no location entry to grant.
3. Start discovery on both phones, 1 m apart, screens on.
4. Open the dev panel on each phone and watch the sighting count.

**Pass:** both phones accumulate sightings of the other. **Fail:** one or both
see nothing. On a fail, before escalating, try the other advertisement layout
and then 16-bit service data in place of manufacturer data (§5). If nothing
works, stop and escalate — do not grant a location permission to see whether
that fixes it, because a positive result from that experiment is not usable.

### 3.2 Which layout works

Note what `NativeBle.advertiseLayout()` reports on each phone: `EXTENDED`,
`LEGACY_SPLIT` or `UNSUPPORTED`. If the two phones differ, record both and
note that the fallback has to stay in the shipped code.

### 3.3 Detection rate at 1 m, 3 m and 10 m

For each distance, and for each of "on a desk" and "in a pocket":

1. Place the phones at the distance, both advertising and scanning.
2. Leave them for 10 minutes — that is 10 scan windows at the default
   60-second period.
3. Read the window count for that interval from the dev panel.
4. Detection rate = windows in which the peer was heard ÷ 10.

Do this for both directions (A hearing B, and B hearing A); they are not
always the same, because transmit power differs by phone.

### 3.4 Walk-past false-crossing rate

The question this answers: does a 30-second walk past a stranger produce a
crossing? It must not — a crossing is supposed to mean "you spent a little
time near this person".

1. Phone A stays still, advertising and scanning.
2. Carry phone B past it at ordinary walking pace, so the two are within a few
   metres for roughly 30 seconds. Both phones in pockets.
3. Repeat 20 times.
4. Count how many of the 20 passes produced **4 or more** qualifying windows
   in one interval, i.e. how many would have passed the dwell threshold
   `presence.min_qualified_windows`.

False-crossing rate = that count ÷ 20. If it is high, the threshold or the
scan period needs revising — as a proposed spec change, not a silent config
edit.

### 3.5 Scanning with the screen off

Repeat §3.3 at 3 m, pockets, with both screens off for the full 10 minutes
(lock the phones and do not touch them). This is the measurement most likely
to disappoint, and the one that matters most: a campus day is mostly
screen-off. Record the rate and note the manufacturer of each phone.

### 3.6 Does the device address rotate with the EID?

This decides whether EID rotation actually protects anyone. If the underlying
BLE device address stays the same across a rotation, a passive sniffer can
link one EID to the next and track the phone for as long as it stays in range
— which defeats the rotation entirely (`docs/THREAT_MODEL.md` §3.3).

1. Use a third device with a generic BLE scanner app (nRF Connect or similar),
   or a Linux machine with `btmon`.
2. Watch Mutual's advertisement from one phone across at least two 15-minute
   rotations — or force rotations by changing the phone's clock, which is
   quicker.
3. Record whether the advertiser address changes at the same time as the
   payload.

**If the address does not change: escalate as a spec decision.** It is not a
bug to patch around; it changes what claim the project can make.

### 3.7 Battery drain over 8 hours

1. Charge both phones to 100 %. Note the time.
2. Leave both untouched, screens off, discovery **on**, for 8 hours.
3. Record the remaining battery on each.
4. Repeat on another day with discovery **off** (the control), same 8-hour
   window, same conditions.
5. Drain attributable to Mutual = control remaining − discovery remaining.

If drain exceeds **10 % per 8 hours**, the duty cycle is revised through a
spec change (AC-T2-6), not accepted quietly.

---

## 4. Results

Fill in as measured. Leave a cell blank rather than estimating it. Where a
measurement failed or could not be taken, write why in the notes column.

### 4.1 Phones used

| | Brand and model | Android version | Chipset / BLE version | Notes |
|---|---|---|---|---|
| Phone A | | | | |
| Phone B | | | | |

### 4.2 The gating question

| Question | Result | Notes |
|---|---|---|
| Detection works with `neverForLocation` and no location permission | | |
| Any location permission present in the installed build | should be **none** | |

### 4.3 Advertisement layout

| | Layout achieved | Notes |
|---|---|---|
| Phone A | | |
| Phone B | | |

### 4.4 Detection rate (windows heard out of 10)

| Distance | Placement | A hears B | B hears A | Notes |
|---|---|---|---|---|
| 1 m | desk | | | |
| 1 m | pockets | | | |
| 3 m | desk | | | |
| 3 m | pockets | | | |
| 10 m | desk | | | |
| 10 m | pockets | | | |
| 3 m | pockets, **screens off** | | | |

### 4.5 Walk-past false crossings

| Passes | Passes reaching ≥ 4 windows | Rate | Notes |
|---|---|---|---|
| 20 | | | |

### 4.6 Device address rotation

| Question | Result | Notes |
|---|---|---|
| Advertiser address changes with each EID rotation | | |

### 4.7 Battery

| Day | Discovery | Start % | End % after 8 h | Notes |
|---|---|---|---|---|
| | on | | | |
| | off (control) | | | |

**Drain attributable to Mutual:** ___ % per 8 hours.
**Within the 10 % limit?** ___

---

## 5. If detection fails

In order, and never past the last one:

1. Try the other advertisement layout (§3.2). Extended advertising and the
   legacy split fail for different reasons.
2. Try 16-bit **service data** with a Mutual UUID instead of manufacturer-specific
   data. Some scan paths treat the two differently.
3. Try a scan filter on the service UUID rather than on manufacturer id.
4. Reduce the payload: the 2-byte magic exists to make filtering cheap and
   could be dropped if the format is otherwise unambiguous, which buys 2 bytes.
5. **Stop and escalate to the human as a spec decision.** Mutual's fallback is
   a protocol change, not a permission change. Adding a location permission is
   not on this list at any position.

---

## 6. What the spike's result changes

| Outcome | Consequence |
|---|---|
| Detection works, extended layout, acceptable screen-off rate | Phase 9b ships as written; thresholds confirmed as a spec change if the measured rates suggest different values |
| Detection works only with the legacy split | Both layouts stay in the code permanently; note the lower detection rate in the report's limitations |
| Screen-off detection is poor on one brand | Record the brand in the limitations; Tier 2's demo uses phones that work; the pilot's recruitment notes the constraint |
| Device address does not rotate | Escalate: the rotation claim in `docs/THREAT_MODEL.md` §3.3 has to be weakened in writing before anyone relies on it |
| Battery drain over 10 % per 8 h | Revise `ble.scan_period_seconds` / `scan_window_seconds` through a spec change, then re-measure |
| Detection needs a location permission | **Escalate.** Tier 2's discovery mechanism does not work as designed. Tier 1 stands on its own, which is the reason the tiers are ordered this way |
