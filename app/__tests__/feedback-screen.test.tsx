/**
 * The Send feedback screen (SPEC.md §11.4). The only network call is the one Send makes,
 * with the chosen category and the trimmed text, and nothing is sent for an empty message.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import FeedbackScreen from '@/../app/feedback';
import { sendFeedback } from '@/api/endpoints';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/api/endpoints', () => ({
  sendFeedback: jest.fn(async () => undefined),
}));

afterEach(() => {
  jest.clearAllMocks();
});

describe('Send feedback', () => {
  it('sends the chosen category and the trimmed message, then thanks the student', async () => {
    await render(<FeedbackScreen />);
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Something’s wrong' }));
      fireEvent.changeText(screen.getByLabelText('Your message'), '  The map icon is confusing.  ');
    });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    });

    expect(sendFeedback).toHaveBeenCalledTimes(1);
    expect(sendFeedback).toHaveBeenCalledWith('problem', 'The map icon is confusing.');
    expect(await screen.findByText('Thank you')).toBeTruthy();
  });

  it('sends nothing for an empty message', async () => {
    await render(<FeedbackScreen />);
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Your message'), '   ');
      fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    });

    expect(sendFeedback).not.toHaveBeenCalled();
    expect(screen.getByText('Write a few words first.')).toBeTruthy();
  });

  it('makes no network call just by opening', async () => {
    await render(<FeedbackScreen />);
    expect(sendFeedback).not.toHaveBeenCalled();
  });
});
