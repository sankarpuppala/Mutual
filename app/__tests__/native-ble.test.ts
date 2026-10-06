/**
 * The TypeScript wrapper around the native BLE module (PLAN.md Phase 9b "Done when":
 * `npm test -w app` covers the wrapper).
 *
 * The Kotlin itself can only be judged on two physical phones (Phase 9a). What *can* be
 * tested here is the part most likely to go quietly wrong: that the wrapper refuses a
 * location permission, that it degrades instead of crashing with no native module, and that
 * it reports the radio's real state rather than an optimistic one.
 */

import type { NativeAdvertiseLayout } from '../modules/mutual-ble';

const mockNative = {
  isSupported: jest.fn(() => true),
  hasPermissions: jest.fn(() => true),
  requiredPermissions: jest.fn(() => [
    'android.permission.BLUETOOTH_ADVERTISE',
    'android.permission.BLUETOOTH_SCAN',
    'android.permission.BLUETOOTH_CONNECT',
    'android.permission.POST_NOTIFICATIONS',
  ]),
  setSchedule: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(),
  drain: jest.fn(() => []),
  // Annotated so each test can return any layout; `as const` here would pin it to EXTENDED.
  status: jest.fn(
    (): {
      advertising: boolean;
      scanning: boolean;
      layout: NativeAdvertiseLayout;
      bluetoothOn: boolean;
      scheduledThrough: string | null;
      scheduleSize: number;
    } => ({
      advertising: true,
      scanning: true,
      layout: 'EXTENDED',
      bluetoothOn: true,
      scheduledThrough: '2026-10-07',
      scheduleSize: 192,
    }),
  ),
  peek: jest.fn(() => []),
};

let mockPresentModule: typeof mockNative | null = mockNative;

jest.mock('../modules/mutual-ble', () => ({
  get MutualBle() {
    return mockPresentModule;
  },
}));

const mockRequestMultiple = jest.fn(async () => ({
  'android.permission.BLUETOOTH_ADVERTISE': 'granted',
  'android.permission.BLUETOOTH_SCAN': 'granted',
  'android.permission.BLUETOOTH_CONNECT': 'granted',
  'android.permission.POST_NOTIFICATIONS': 'granted',
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  PermissionsAndroid: {
    get requestMultiple() {
      return mockRequestMultiple;
    },
  },
}));

// Imported after the mocks so the wrapper sees them.
// eslint-disable-next-line import/first
import { NativeBle } from '@/presence/nativeBle';

beforeEach(() => {
  mockPresentModule = mockNative;
  jest.clearAllMocks();
  mockNative.status.mockReturnValue({
    advertising: true,
    scanning: true,
    layout: 'EXTENDED',
    bluetoothOn: true,
    scheduledThrough: '2026-10-07',
    scheduleSize: 192,
  });
  mockNative.hasPermissions.mockReturnValue(true);
});

describe('NativeBle', () => {
  it('refuses to request a location permission even if the module asks for one', async () => {
    mockNative.requiredPermissions.mockReturnValueOnce([
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.ACCESS_FINE_LOCATION',
    ]);
    await expect(new NativeBle().requestPermissions()).rejects.toThrow(/invariant 3/);
    expect(mockRequestMultiple).not.toHaveBeenCalled();
  });

  it('requests exactly the Bluetooth and notification permissions', async () => {
    await expect(new NativeBle().requestPermissions()).resolves.toBe(true);
    expect(mockRequestMultiple).toHaveBeenCalledWith([
      'android.permission.BLUETOOTH_ADVERTISE',
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.POST_NOTIFICATIONS',
    ]);
  });

  it('passes the server-configured radio settings down to native', async () => {
    const ble = new NativeBle({ scanWindowSeconds: 8, scanPeriodSeconds: 60 });
    ble.configure({ rssiThresholdDbm: -75 });
    await ble.start();
    expect(mockNative.start).toHaveBeenCalledWith({
      scanPeriodSeconds: 60,
      scanWindowSeconds: 8,
      rssiThresholdDbm: -75,
    });
  });

  it('reports bluetooth being off rather than claiming to be advertising', async () => {
    mockNative.status.mockReturnValue({
      advertising: true,
      scanning: false,
      layout: 'EXTENDED',
      bluetoothOn: false,
      scheduledThrough: null,
      scheduleSize: 10,
    });
    expect(await new NativeBle().status()).toMatchObject({ reason: 'bluetooth_off' });
  });

  it('reports an exhausted schedule, which is the fail-safe state (SPEC §14.5)', async () => {
    mockNative.status.mockReturnValue({
      advertising: false,
      scanning: true,
      layout: 'EXTENDED',
      bluetoothOn: true,
      scheduledThrough: null,
      scheduleSize: 0,
    });
    expect(await new NativeBle().status()).toMatchObject({
      advertising: false,
      reason: 'schedule_exhausted',
    });
  });

  it('does not claim to be advertising when neither layout worked (D23, R12)', async () => {
    mockNative.status.mockReturnValue({
      advertising: true,
      scanning: true,
      layout: 'UNSUPPORTED',
      bluetoothOn: true,
      scheduledThrough: '2026-10-07',
      scheduleSize: 192,
    });
    const ble = new NativeBle();
    const status = await ble.status();
    expect(status.advertising).toBe(false);
    expect(status.reason).toBe('unsupported_device');
    expect(ble.advertiseLayout()).toBe('UNSUPPORTED');
  });

  it('notices missing permissions even while the service thinks it is running', async () => {
    mockNative.hasPermissions.mockReturnValue(false);
    expect(await new NativeBle().status()).toMatchObject({ reason: 'permissions_missing' });
  });

  it('forwards the schedule as plain (day, interval, eid) triples and nothing else', async () => {
    await new NativeBle().setSchedule([{ day: '2026-10-06', interval: 40, eid: 'AAAA' }]);
    expect(mockNative.setSchedule).toHaveBeenCalledWith([
      { day: '2026-10-06', interval: 40, eid: 'AAAA' },
    ]);
  });

  it('returns drained sightings with no field beyond the five the interface allows', async () => {
    mockNative.drain.mockReturnValueOnce([
      {
        day: '2026-10-06',
        interval: 40,
        ownEid: 'own',
        heardEid: 'heard',
        windows: 7,
        // A stray field from a future native change must not pass through: RSSI or a
        // timestamp reaching the upload path would break invariant 3.
        rssi: -62,
      } as never,
    ]);
    const [sighting] = await new NativeBle().drain();
    expect(Object.keys(sighting ?? {}).sort()).toEqual([
      'day',
      'heardEid',
      'interval',
      'ownEid',
      'windows',
    ]);
  });

  it('degrades to unsupported with no crash when the native module is absent', async () => {
    mockPresentModule = null;
    const ble = new NativeBle();
    expect(await ble.isSupported()).toBe(false);
    expect(await ble.requestPermissions()).toBe(false);
    expect(await ble.drain()).toEqual([]);
    expect(await ble.status()).toEqual({
      advertising: false,
      scanning: false,
      reason: 'unsupported_device',
    });
    await expect(ble.start()).resolves.toBeUndefined();
    await expect(ble.stop()).resolves.toBeUndefined();
  });
});
