/**
 * The deployment clock (SPEC.md §6.3, §6.11).
 *
 * Every "day" in this protocol is a date in the deployment timezone: the epoch a signal set
 * is addressed to, the day a presence upload covers, and the interval index two devices
 * must agree on for the midnight rule (§6.13). Before `deploymentClock.ts` existed the app
 * computed all three from the phone's own clock, so a device in another timezone addressed
 * its upload to a day the server would reject -- after the local ledger had already recorded
 * that day as claimed, which loses the epoch outright rather than retrying it.
 *
 * The cases below are the ones that actually bite: a phone some hours behind or ahead of the
 * deployment, around the hours where the two disagree about what day it is.
 */

import { deploymentClock, deviceClock, offsetMinutesOf } from '@/signals/deploymentClock';

/** `GET /v1/config`'s `server_time` for a deployment at +05:30, at a given instant. */
const KOLKATA = '2026-10-07T00:30:00+05:30'; // 2026-10-06T19:00:00Z

describe('offsetMinutesOf', () => {
  it('reads an offset in either direction and in either spelling', () => {
    expect(offsetMinutesOf('2026-10-07T00:30:00+05:30')).toBe(330);
    expect(offsetMinutesOf('2026-10-07T00:30:00+0530')).toBe(330);
    expect(offsetMinutesOf('2026-10-06T19:00:00-04:00')).toBe(-240);
    expect(offsetMinutesOf('2026-10-06T19:00:00Z')).toBe(0);
  });

  it('returns null when the string declares none, rather than assuming one', () => {
    expect(offsetMinutesOf('2026-10-06T19:00:00')).toBeNull();
  });
});

describe('deploymentClock', () => {
  it('reports the deployment day, not the device day', () => {
    // The device is in UTC and still thinks it is the 6th; the deployment is past midnight.
    const deviceNow = new Date('2026-10-06T19:00:00Z');
    const clock = deploymentClock(KOLKATA, deviceNow);

    // Asserted against the deployment, not against the device: the machine running this
    // test could itself be in Asia/Kolkata, and a test that only passes elsewhere is worse
    // than no test.
    expect(clock.day(deviceNow)).toBe('2026-10-07');
    expect(clock.minutes(deviceNow)).toBe(30);
  });

  it('carries the skew forward, so a wrong device clock does not move the epoch', () => {
    // This phone's clock is forty minutes fast.
    const deviceNow = new Date('2026-10-06T19:40:00Z');
    const clock = deploymentClock(KOLKATA, deviceNow);

    // At the moment the config arrived, the deployment said 00:30 on the 7th.
    expect(clock.day(deviceNow)).toBe('2026-10-07');
    expect(clock.minutes(deviceNow)).toBe(30);

    // Ten real minutes later it says 00:40, not 01:20.
    const later = new Date(deviceNow.getTime() + 10 * 60_000);
    expect(clock.minutes(later)).toBe(40);
  });

  it('rolls over at the deployment midnight', () => {
    const received = new Date('2026-10-06T18:29:00Z'); // 23:59 on the 6th, Kolkata
    const clock = deploymentClock('2026-10-06T23:59:00+05:30', received);

    expect(clock.day(received)).toBe('2026-10-06');
    expect(clock.minutes(received)).toBe(23 * 60 + 59);

    const oneMinuteLater = new Date(received.getTime() + 60_000);
    expect(clock.day(oneMinuteLater)).toBe('2026-10-07');
    expect(clock.minutes(oneMinuteLater)).toBe(0);
  });

  it('falls back to the device rather than guessing at an offset it cannot read', () => {
    const now = new Date();
    const clock = deploymentClock('2026-10-06T19:00:00', now); // no offset declared
    expect(clock.day(now)).toBe(deviceClock.day(now));
    expect(clock.minutes(now)).toBe(deviceClock.minutes(now));

    const nonsense = deploymentClock('not a timestamp', now);
    expect(nonsense.day(now)).toBe(deviceClock.day(now));
  });
});
