/**
 * The TanStack Query defaults are a privacy setting (CLAUDE.md invariant 1), so they get a
 * test rather than a comment.
 *
 * The failure this guards against: with a finite `staleTime`, opening a profile card
 * remounts a `useQuery(['digest'])` whose data has aged out, and the library issues a
 * `GET /digest`. The request does not say which card was opened, but its existence and its
 * timing depend on a card having been opened — and invariant 1 forbids a request whose
 * "existence, timing, size, order or parameters" depend on which profile a user viewed.
 *
 * Nothing is lost: the digest is byte-identical between release times (claim C5), so a
 * refetch inside a day cannot return anything new.
 */

import { QueryClient } from '@tanstack/react-query';

/**
 * The same construction as `app/_layout.tsx`.
 *
 * Duplicated rather than imported because importing the layout pulls in expo-router, the
 * font loader and the whole navigation tree. The values are asserted against the layout's
 * source below, so the two cannot drift apart silently.
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        retry: 1,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });
}

describe('query defaults (invariant 1)', () => {
  it('never refetches on mount, so opening a card issues no request', () => {
    const defaults = makeQueryClient().getDefaultOptions().queries;
    expect(defaults?.refetchOnMount).toBe(false);
    expect(defaults?.staleTime).toBe(Number.POSITIVE_INFINITY);
  });

  it('never refetches on focus or reconnect', () => {
    const defaults = makeQueryClient().getDefaultOptions().queries;
    expect(defaults?.refetchOnWindowFocus).toBe(false);
    expect(defaults?.refetchOnReconnect).toBe(false);
  });

  it('matches what app/_layout.tsx actually configures', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('node:path') as typeof import('node:path');
    const layout = readFileSync(join(__dirname, '..', 'app', '_layout.tsx'), 'utf8');
    for (const line of [
      'refetchOnWindowFocus: false',
      'refetchOnReconnect: false',
      'refetchOnMount: false',
      'staleTime: Number.POSITIVE_INFINITY',
    ]) {
      expect(layout).toContain(line);
    }
  });
});
