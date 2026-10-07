/**
 * Validation messages must not outlive the text they describe.
 *
 * Found by looking at the running app, not by a test: typing a bad address, pressing
 * "Send me a code", then correcting the address left the field red and the message
 * "That does not look like an email address." sitting under a perfectly good one. Every
 * onboarding form had the same shape -- the error was set on submit and only ever cleared
 * by the next submit.
 *
 * The rule these tests fix in place: a field's error disappears on the next keystroke, and
 * comes back only if the new text is still wrong. Nothing here touches the network; only
 * the client-side validation paths are exercised, and a request would mean validation
 * wrongly passed.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import AgeScreen from '@/../app/(onboarding)/age';
import BasicsScreen from '@/../app/(onboarding)/basics';
import CodeScreen from '@/../app/(onboarding)/code';
import EmailScreen from '@/../app/(onboarding)/email';
import { ThemeProvider } from '@/design/theme';
import { useOnboarding } from '@/onboarding/store';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// The first screen rendered in a worker pulls in the icon set, the fonts and the whole
// design system, which takes longer than the 5 s default when the suite runs in parallel.
jest.setTimeout(30_000);

const realFetch = global.fetch;

beforeEach(() => {
  global.fetch = jest.fn(() => {
    throw new Error('no request should be made from an invalid form');
  }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
  jest.clearAllMocks();
});

async function mount(node: ReactNode): Promise<void> {
  await render(<ThemeProvider>{node}</ThemeProvider>);
}

/** React 19 batches the state update, so each interaction is flushed before asserting. */
async function type(label: string, text: string): Promise<void> {
  const field = screen.getByLabelText(label);
  await act(async () => {
    fireEvent.changeText(field, text);
  });
}

async function tap(label: string): Promise<void> {
  const button = screen.getByRole('button', { name: label });
  await act(async () => {
    fireEvent.press(button);
  });
}

describe('a validation error clears on the next keystroke', () => {
  it('email', async () => {
    await mount(<EmailScreen />);

    await type('College email address', 'asha');
    await tap('Send me a code');
    expect(screen.getByText('That does not look like an email address.')).toBeTruthy();

    await type('College email address', 'asha@example.ac.in');
    expect(screen.queryByText('That does not look like an email address.')).toBeNull();
  });

  it('date of birth', async () => {
    await mount(<AgeScreen />);

    await type('Date of birth', '2005');
    await tap('Continue');
    expect(screen.getByText('Use the form YYYY-MM-DD.')).toBeTruthy();

    await type('Date of birth', '2005-04-17');
    expect(screen.queryByText('Use the form YYYY-MM-DD.')).toBeNull();
  });

  it('six-digit code', async () => {
    useOnboarding.setState({ email: 'asha@example.ac.in' });
    await mount(<CodeScreen />);

    await type('Six-digit code', '123');
    await tap('Continue');
    expect(screen.getByText('The code is six digits.')).toBeTruthy();

    await type('Six-digit code', '123456');
    expect(screen.queryByText('The code is six digits.')).toBeNull();
  });

  it('first name', async () => {
    await mount(<BasicsScreen />);

    await type('First name', ' ');
    await tap('Continue');
    expect(screen.getByText('Enter the name you want people to see.')).toBeTruthy();

    await type('First name', 'Asha');
    expect(screen.queryByText('Enter the name you want people to see.')).toBeNull();
  });
});
