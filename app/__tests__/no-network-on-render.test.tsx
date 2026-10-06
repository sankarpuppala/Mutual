/**
 * AC-T2-2's last clause: "rendering `CrossingCard` and `VoicePlayer` performs no network
 * call".
 *
 * This is the client half of claim C1 and the easiest one to break by accident -- a lazily
 * loaded image, a retry on a failed play, a "fetch if missing" convenience. All three would
 * make the app's traffic depend on which card a user opened, which is exactly the
 * correlation the protocol exists to destroy.
 *
 * The test is blunt on purpose: it replaces `global.fetch` with a spy that fails the test if
 * it is called at all, renders the components, presses play, and asserts the spy never ran.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

import type { PeerCard } from '@/api/types';
import { ChatBubble } from '@/components/ChatBubble';
import { CrossingCard } from '@/components/CrossingCard';
import { GenerativeAvatar } from '@/components/GenerativeAvatar';
import { SignalDots } from '@/components/SignalDots';
import { VoicePlayer } from '@/components/VoicePlayer';
import { ThemeProvider } from '@/design/theme';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// expo-audio needs a native player; the component only has to not reach the network.
jest.mock('expo-audio', () => ({
  useAudioPlayer: () => ({ play: jest.fn(), pause: jest.fn(), seekTo: jest.fn() }),
  useAudioPlayerStatus: () => ({
    playing: false,
    duration: 18,
    currentTime: 0,
    didJustFinish: false,
  }),
}));

const card: PeerCard = {
  peer_id: 'peer-1',
  first_name: 'Meera',
  year_of_study: 3,
  identity_pk: 'cGstbWVlcmEtdGhpcnR5LXR3by1ieXRlcy1sb25nLXZhbA',
  prompts: [
    {
      prompt_id: 'simple_pleasures',
      text: 'The first sip of filter coffee before an 8 am lab.',
      voice_media_id: 'media-1',
      waveform: Array.from({ length: 48 }, (_, i) => (i * 7) % 100),
    },
  ],
};

function wrap(node: ReactNode): ReactElement {
  return <ThemeProvider>{node}</ThemeProvider>;
}

const realFetch = global.fetch;
let fetchSpy: jest.Mock;

beforeEach(() => {
  fetchSpy = jest.fn(() => {
    throw new Error('A component made a network request. See CLAUDE.md invariant 1.');
  });
  global.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
});

describe('no network on render (AC-T2-2, invariant 1)', () => {
  it('renders a CrossingCard without any request', async () => {
    await render(
      wrap(
        <CrossingCard
          card={card}
          timeLabel="Yesterday · evening"
          signalled={[]}
          voiceUri="file:///cache/media-1.m4a"
          questionFor={() => 'My simple pleasures'}
          onOpenProfile={jest.fn()}
          onSignal={jest.fn()}
        />,
      ),
    );
    expect(screen.getByText('Meera')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('renders a CrossingCard for a peer already signalled without any request', async () => {
    await render(
      wrap(
        <CrossingCard
          card={card}
          timeLabel="Yesterday · evening"
          signalled={['study', 'project']}
          voiceUri={null}
          questionFor={() => 'My simple pleasures'}
          onOpenProfile={jest.fn()}
          onSignal={jest.fn()}
        />,
      ),
    );
    expect(screen.getByText('Sent · Study, Project')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('presses play on a VoicePlayer without any request', async () => {
    await render(
      wrap(
        <VoicePlayer
          uri="file:///cache/media-1.m4a"
          waveform={card.prompts[0]!.waveform!}
          speakerName="Meera"
        />,
      ),
    );
    fireEvent.press(screen.getByLabelText("Play Meera's voice answer"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows a VoicePlayer with no cached file without trying to fetch it', async () => {
    // The honest failure mode: the prefetch did not get this item, so the player is
    // disabled. It must not quietly go and get it.
    await render(wrap(<VoicePlayer uri={null} waveform={[]} speakerName="Meera" />));
    const button = screen.getByLabelText("Play Meera's voice answer");
    fireEvent.press(button);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('renders an avatar, dots and a chat bubble without any request', async () => {
    await render(
      wrap(
        <>
          <GenerativeAvatar identityPk={card.identity_pk} size={44} />
          <SignalDots used={5} total={20} />
          <ChatBubble body="See you at the courts at 6 then?" fromMe={false} />
        </>,
      ),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('opens a profile and signals through callbacks, not requests', async () => {
    const onOpenProfile = jest.fn();
    const onSignal = jest.fn();
    await render(
      wrap(
        <CrossingCard
          card={card}
          timeLabel="Yesterday · evening"
          signalled={[]}
          voiceUri={null}
          questionFor={() => 'My simple pleasures'}
          onOpenProfile={onOpenProfile}
          onSignal={onSignal}
        />,
      ),
    );
    fireEvent.press(screen.getByLabelText('See all answers'));
    fireEvent.press(screen.getByLabelText('Send a signal to Meera'));
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
    expect(onSignal).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps font scaling on, so 200% OS text still works (SPEC §13.7)', async () => {
    await render(
      wrap(
        <CrossingCard
          card={card}
          timeLabel="Yesterday · evening"
          signalled={[]}
          voiceUri={null}
          questionFor={() => 'My simple pleasures'}
          onOpenProfile={jest.fn()}
          onSignal={jest.fn()}
        />,
      ),
    );
    // No component may set allowFontScaling={false}; the default is true, so no rendered
    // node should carry it as false. Read from the serialised tree rather than the internal
    // instance API, which @testing-library/react-native 14 no longer exposes.
    expect(JSON.stringify(screen.toJSON())).not.toContain('"allowFontScaling":false');
  });
});
