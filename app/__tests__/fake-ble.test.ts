/**
 * The fake adapter is what every phase except 9a develops against, so its behaviour has to
 * be right: deterministic, midnight-rule-respecting, and draining exactly once.
 */
import { FakeBle } from '@/presence/fakeBle';

const DAY = '2026-10-05';

function schedule(day: string, intervals: number[]) {
  return intervals.map((interval) => ({ day, interval, eid: `eid-${interval}` }));
}

describe('FakeBle', () => {
  it('produces nothing until a schedule exists', async () => {
    const ble = new FakeBle({ seed: 7 });
    expect(ble.generateDay(DAY)).toEqual([]);
    expect(await ble.drain()).toEqual([]);
  });

  it('is deterministic for a given seed', async () => {
    const run = async () => {
      const ble = new FakeBle({ seed: 42, peers: 5 });
      await ble.setSchedule(schedule(DAY, [10, 30, 50, 70]));
      ble.generateDay(DAY);
      return ble.drain();
    };
    expect(await run()).toEqual(await run());
  });

  it('never reports the midnight intervals (SPEC §6.13)', async () => {
    const ble = new FakeBle({ seed: 3, peers: 6 });
    await ble.setSchedule(schedule(DAY, [0, 95]));
    ble.generateDay(DAY);
    expect(await ble.drain()).toEqual([]);
  });

  it('keeps window counts in the real 1..15 range', async () => {
    const ble = new FakeBle({ seed: 11, peers: 6 });
    await ble.setSchedule(schedule(DAY, [5, 20, 40, 60, 80]));
    const sightings = ble.generateDay(DAY);
    expect(sightings.length).toBeGreaterThan(0);
    for (const s of sightings) {
      expect(s.windows).toBeGreaterThanOrEqual(1);
      expect(s.windows).toBeLessThanOrEqual(15);
    }
  });

  it('can produce only brush-pasts, so the dwell filter is actually exercised', async () => {
    const ble = new FakeBle({ seed: 5, peers: 6, brushPastShare: 1 });
    await ble.setSchedule(schedule(DAY, [12, 24, 36, 48]));
    const sightings = ble.generateDay(DAY);
    expect(sightings.length).toBeGreaterThan(0);
    for (const s of sightings) expect(s.windows).toBeLessThan(4);
  });

  it('drains exactly once: the raw pairs must not outlive the upload', async () => {
    const ble = new FakeBle({ seed: 9, peers: 4 });
    await ble.setSchedule(schedule(DAY, [15, 45]));
    ble.generateDay(DAY);
    expect((await ble.drain()).length).toBeGreaterThan(0);
    expect(await ble.drain()).toEqual([]);
  });

  it('reports an exhausted schedule rather than inventing EIDs (SPEC §14.5)', async () => {
    const ble = new FakeBle({ seed: 1 });
    await ble.start();
    expect(await ble.status()).toMatchObject({ advertising: false, reason: 'schedule_exhausted' });
    await ble.setSchedule(schedule(DAY, [30]));
    expect(await ble.status()).toMatchObject({ advertising: true, scheduledThrough: DAY });
  });

  it('emits 32-byte base64url EIDs, the shape the real adapter reports', async () => {
    const ble = new FakeBle({ seed: 2, peers: 3 });
    await ble.setSchedule(schedule(DAY, [20, 40]));
    for (const s of ble.generateDay(DAY)) {
      expect(s.heardEid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });
});
