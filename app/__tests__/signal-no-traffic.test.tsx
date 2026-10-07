/**
 * Sending, changing or withdrawing a signal must produce no network traffic at all
 * (CLAUDE.md invariant 1; claim C1, SPEC.md §7.4; AC-T2-2's client half).
 *
 * This is the test that was missing when `useMorningLetter().refresh()` called
 * `digest.refetch()`. `refetch` is imperative, so it ignores `staleTime: Infinity` and the
 * other defaults `query-defaults.test.ts` checks; the Today screen called `refresh()` at
 * the end of every signal confirmation, which put a `GET /v1/digest` in the server's log
 * at the exact second a one-sided signal was created, changed or withdrawn. Distinguishing
 * the two worlds of claim C1 then needs nothing more than a timestamp.
 *
 * The assertion is the blunt one: a spy on `global.fetch` that must not be called.
 * `query-defaults.test.ts` asserts the declarative half; this asserts the imperative half,
 * which no configuration can protect.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Text } from 'react-native';

import type { DigestResponse } from '@/api/types';
import { useMorningLetter } from '@/digest/useDigest';
import { setSignalsForPeer, withdrawPeer } from '@/signals/db';
import { wipeLocalDatabase } from '@/storage/localDb';

jest.mock('@/digest/prefetch', () => ({
  prefetchDigestMedia: jest.fn(async () => undefined),
}));

const DIGEST: DigestResponse = {
  release_day: '2026-10-06',
  peers: [
    {
      card: {
        peer_id: 'peer-1',
        first_name: 'Meera',
        year_of_study: 3,
        identity_pk: 'cGstbWVlcmEtdGhpcnR5LXR3by1ieXRlcy1sb25nLXZhbA',
        prompts: [],
      },
      last_day: '2026-10-05',
      encounter: 'ZW5jb3VudGVyLXRva2VuLXZhbHVlLWZvci10aGUtdGVzdA',
    },
  ],
  media: [],
};

/** Answers the two queries the hook makes on mount, and records every call. */
function serve(): jest.Mock {
  return jest.fn(async (input: unknown) => {
    const url = String(input);
    const body = url.includes('/digest') ? DIGEST : { prompts: [] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as jest.Mock;
}

function Harness({ onReady }: { onReady: (refresh: () => void) => void }): ReactNode {
  const letter = useMorningLetter();
  if (!letter.loading) onReady(letter.refresh);
  return <Text>{letter.loading ? 'loading' : `entries:${letter.today.length}`}</Text>;
}

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  jest.clearAllMocks();
});

it('a signal written to the device causes no request', async () => {
  await wipeLocalDatabase();
  const fetchSpy = serve();
  global.fetch = fetchSpy as unknown as typeof fetch;

  let refresh = (): void => undefined;
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY, refetchOnMount: false },
    },
  });

  await render(
    <QueryClientProvider client={client}>
      <Harness
        onReady={(r) => {
          refresh = r;
        }}
      />
    </QueryClientProvider>,
  );

  // The letter has loaded; everything after this point is the user interacting with it.
  await screen.findByText('entries:1');
  const callsAfterLoad = fetchSpy.mock.calls.length;
  expect(callsAfterLoad).toBeGreaterThan(0); // the digest really was fetched

  // Send, change, then withdraw -- the three branches of the Today screen's `confirm`.
  for (const intents of [['study'], ['study', 'project']] as const) {
    await act(async () => {
      await setSignalsForPeer('peer-1', [...intents], {
        lastCrossingDay: '2026-10-05',
        now: '2026-10-06T09:00:00.000Z',
        peerName: 'Meera',
        peerIdentityPk: DIGEST.peers[0]!.card.identity_pk,
      });
      refresh();
    });
  }
  await act(async () => {
    await withdrawPeer('peer-1');
    refresh();
  });

  expect(fetchSpy.mock.calls.length).toBe(callsAfterLoad);
});
