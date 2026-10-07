/**
 * The research consent screen must offer a way forward that is not consent
 * (SPEC.md §16, CLAUDE.md invariant 9, Board Q9).
 *
 * This screen cannot be inspected on a device without putting the server into study mode,
 * and study mode requires `study/APPROVAL.md` to exist — which invariant 9 says must not be
 * created before a real approval does. So the screen is checked here instead, where the
 * `study_enabled` flag can simply be asserted true without any of that machinery existing.
 *
 * What is being protected: until 2026-10-07 the only way off this screen was to consent or
 * to go back, and `POST /account` refused an account on a study campus without a consent
 * version. On a campus running the study, the price of using a campus social app was
 * agreeing to be a research subject. Consent obtained that way is not freely given, and an
 * ethics committee would be right to refuse it.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';

import ConsentScreen from '@/../app/(onboarding)/consent';
import type { ServerConfig } from '@/api/types';
import { ThemeProvider } from '@/design/theme';
import { useOnboarding } from '@/onboarding/store';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/api/endpoints', () => ({
  getConfig: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const endpoints = require('@/api/endpoints') as { getConfig: jest.Mock };

const STUDY_CAMPUS = { study_enabled: true } as unknown as ServerConfig;

async function mountConsent(): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ConsentScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  await screen.findByText('Taking part in the study');
}

async function tap(name: string): Promise<void> {
  const node = screen.getByText(name);
  await act(async () => {
    fireEvent.press(node);
  });
}

beforeEach(() => {
  useOnboarding.getState().setConsentVersion(null);
  endpoints.getConfig.mockResolvedValue(STUDY_CAMPUS);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('consent is optional, and declining goes forward', () => {
  it('offers a way to use Mutual without taking part', async () => {
    await mountConsent();
    expect(screen.getByText('Use Mutual without taking part')).toBeTruthy();
  });

  it('declining continues onboarding and records no consent version', async () => {
    await mountConsent();
    await tap('Use Mutual without taking part');

    expect(useOnboarding.getState().consentVersion).toBeNull();
    // Forward to the next onboarding step, not back the way they came.
    expect(router.push).toHaveBeenCalledWith('/(onboarding)/age');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('agreeing records a consent version, and only then', async () => {
    await mountConsent();
    expect(useOnboarding.getState().consentVersion).toBeNull();

    await tap('I agree to take part');
    expect(useOnboarding.getState().consentVersion).toBe('1');
  });

  it('says that the setting under study changes for everyone either way', async () => {
    await mountConsent();
    // Someone who declines still experiences the policy switch, because it is a campus
    // setting. They are told because it changes the product they use, not because they are
    // a subject -- and an ethics committee will look for exactly this sentence.
    expect(screen.getByText(/changes for everyone here during the study/i)).toBeTruthy();
  });

  it('asks nothing when the campus is not running a study', async () => {
    endpoints.getConfig.mockResolvedValue({ study_enabled: false } as unknown as ServerConfig);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await render(
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <ConsentScreen />
        </ThemeProvider>
      </QueryClientProvider>,
    );

    await screen.findByText('No study running');
    expect(screen.queryByText('I agree to take part')).toBeNull();
    expect(useOnboarding.getState().consentVersion).toBeNull();
  });
});
