/**
 * The dev panel's "log in as a seeded account" action (not a shipped feature; a demo
 * convenience gated by `isDev()`, same as the rest of `app/dev.tsx`).
 *
 * What it must do: take one object from `server/demo_accounts.json`'s "users" list --
 * exactly the shape `POST /dev/seed` returns -- and make the *same three writes*
 * onboarding's code/basics screens make on success (`setSessionToken`, `setIdentity`,
 * `setUserId`), then send the device to `/(tabs)/today`. That is what lets a device show
 * up already populated with the crossings and matches `demo_seed.py` built for that
 * account, instead of a blank one.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';

import DevScreen from '@/../app/dev';
import { setIdentity, setSessionToken, setUserId } from '@/storage/secure';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// The full shape of ConfigOut: the Server State card reads every one of these fields once
// `config.data` is truthy, with no per-field fallback, so a partial mock throws past this
// screen's guard rather than inside it.
const FULL_CONFIG = {
  campus: null,
  server_time: '2026-10-08T09:00:00Z',
  epoch: '2026-10-08',
  protocol_version: 1,
  reveal_policy: 'M',
  next_policy_change: null,
  signal_upload_window: { start: '18:00', end: '23:30' },
  presence_upload_window: { start: '00:05', end: '06:00' },
  match_batch_time: '23:45',
  digest_release_time: '08:00',
  interest_ttl_days: 7,
  ble: {},
  study_enabled: false,
};

jest.mock('@/api/endpoints', () => ({
  getConfig: jest.fn(async () => FULL_CONFIG),
  dev: {
    setClockOffset: jest.fn(),
    makeCrossing: jest.fn(),
    seed: jest.fn(),
  },
}));

jest.mock('@/presence/schedule', () => ({
  plannedUploadMinute: jest.fn(async () => null),
  runNightlyWork: jest.fn(),
}));

// Mocked rather than exercised against the real expo-secure-store fake: that fake's Map is
// module-scoped and shared across every test in the run, so "nothing was written" cannot be
// asserted by reading it back without one test's writes leaking into the next.
jest.mock('@/storage/secure', () => ({
  getUserId: jest.fn(async () => null),
  setSessionToken: jest.fn(),
  setIdentity: jest.fn(),
  setUserId: jest.fn(),
}));

const ACCOUNT = {
  user_id: 'u-meera',
  session_token: 'sess-meera',
  identity_sk: 'c2stbWVlcmEtdGhpcnR5LXR3by1ieXRlcy1sb25n',
  identity_pk: 'cGstbWVlcmEtdGhpcnR5LXR3by1ieXRlcy1sb25n',
};

async function mount(): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <DevScreen />
    </QueryClientProvider>,
  );
  await screen.findByText('Log in as a seeded account');
}

afterEach(() => {
  jest.clearAllMocks();
});

async function fillAndSubmit(fields: Partial<typeof ACCOUNT>): Promise<void> {
  const byLabel: Record<string, string | undefined> = {
    user_id: fields.user_id,
    session_token: fields.session_token,
    identity_sk: fields.identity_sk,
    identity_pk: fields.identity_pk,
  };
  for (const [label, value] of Object.entries(byLabel)) {
    if (value === undefined) continue;
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText(label), value);
    });
  }
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Log in as this account' }));
  });
}

describe('logging in as a seeded demo account', () => {
  it('writes the session, identity and user id, then opens Today', async () => {
    await mount();
    await fillAndSubmit(ACCOUNT);

    expect(setSessionToken).toHaveBeenCalledWith('sess-meera');
    expect(setIdentity).toHaveBeenCalledWith({
      sk: ACCOUNT.identity_sk,
      pk: ACCOUNT.identity_pk,
    });
    expect(setUserId).toHaveBeenCalledWith('u-meera');
    expect(router.replace).toHaveBeenCalledWith('/(tabs)/today');
  });

  it('rejects a missing field, without writing anything', async () => {
    await mount();
    await fillAndSubmit({ user_id: ACCOUNT.user_id }); // the other three left blank

    expect(setSessionToken).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(
      screen.getByText('Fill in all four fields from one user in demo_accounts.json.'),
    ).toBeTruthy();
  });

  it('treats whitespace-only input the same as empty', async () => {
    await mount();
    await fillAndSubmit({ ...ACCOUNT, session_token: '   ' });

    expect(setSessionToken).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
