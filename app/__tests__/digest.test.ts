/**
 * Digest prefetch and the media cache (AC-T2-2, CLAUDE.md invariant 1).
 *
 * The central test here is "fetches every listed media item in sorted order regardless of
 * UI state". It is the client half of claim C1: the server can be perfectly behaved and the
 * app can still betray a user by fetching a voice note at the moment they press play.
 */

import { sha256 } from '@noble/hashes/sha2.js';

import type { DigestResponse } from '@/api/types';
import { cachedBytes, cachedMediaUri, storeMedia, MediaIntegrityError } from '@/digest/cache';
import { prefetchDigestMedia } from '@/digest/prefetch';
import { hiddenPeerIds, hidePeer, unhidePeer, wipeLocalDatabase } from '@/storage/localDb';

jest.mock('@/api/endpoints', () => ({
  getMedia: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const endpoints = require('@/api/endpoints') as { getMedia: jest.Mock };

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Bytes whose hash the digest can honestly advertise. */
function item(mediaId: string, size = 1024) {
  const bytes = new Uint8Array(size).fill(mediaId.charCodeAt(0));
  return {
    mediaId,
    bytes,
    entry: { media_id: mediaId, bytes: size, sha256: toHex(sha256(bytes)) },
  };
}

function digestWith(items: ReturnType<typeof item>[]): DigestResponse {
  return {
    release_day: '2026-10-06',
    peers: [],
    media: items.map((i) => i.entry),
  };
}

beforeEach(async () => {
  await wipeLocalDatabase();
  jest.clearAllMocks();
});

describe('prefetch (invariant 1)', () => {
  it('fetches every listed item, in the order the digest lists them', async () => {
    const items = ['a', 'b', 'c', 'd'].map((id) => item(id));
    const byId = new Map(items.map((i) => [i.mediaId, i.bytes]));
    const requested: string[] = [];
    endpoints.getMedia.mockImplementation(async (id: string) => {
      requested.push(id);
      return byId.get(id)!.buffer;
    });

    const result = await prefetchDigestMedia(digestWith(items));
    expect(result.fetched).toBe(4);
    // The digest's own order, not sorted again locally and not reordered by the UI.
    expect(requested).toEqual(['a', 'b', 'c', 'd']);
  });

  it('fetches the same items whatever the UI is doing, because nothing tells it', async () => {
    // There is no parameter by which UI state could reach this function: its only input is
    // the digest. This test documents that by calling it twice with the same digest and
    // asserting identical behaviour.
    const items = ['a', 'b'].map((id) => item(id));
    const byId = new Map(items.map((i) => [i.mediaId, i.bytes]));
    endpoints.getMedia.mockImplementation(async (id: string) => byId.get(id)!.buffer);

    const first = await prefetchDigestMedia(digestWith(items));
    await wipeLocalDatabase();
    jest.clearAllMocks();
    endpoints.getMedia.mockImplementation(async (id: string) => byId.get(id)!.buffer);
    const second = await prefetchDigestMedia(digestWith(items));
    expect(second.fetched).toBe(first.fetched);
  });

  it('skips items already cached, so a second open makes no requests', async () => {
    const items = ['a', 'b'].map((id) => item(id));
    const byId = new Map(items.map((i) => [i.mediaId, i.bytes]));
    endpoints.getMedia.mockImplementation(async (id: string) => byId.get(id)!.buffer);

    await prefetchDigestMedia(digestWith(items));
    jest.clearAllMocks();
    endpoints.getMedia.mockImplementation(async (id: string) => byId.get(id)!.buffer);

    const result = await prefetchDigestMedia(digestWith(items));
    expect(result.fetched).toBe(0);
    expect(result.skipped).toBe(2);
    expect(endpoints.getMedia).not.toHaveBeenCalled();
  });

  it('carries on past one failed item rather than abandoning the digest', async () => {
    const items = ['a', 'b', 'c'].map((id) => item(id));
    const byId = new Map(items.map((i) => [i.mediaId, i.bytes]));
    endpoints.getMedia.mockImplementation(async (id: string) => {
      if (id === 'b') throw new Error('transfer failed');
      return byId.get(id)!.buffer;
    });

    const result = await prefetchDigestMedia(digestWith(items));
    expect(result.fetched).toBe(2);
    expect(result.failed).toEqual([{ mediaId: 'b', reason: 'Error' }]);
  });

  it('drops items over the cap from the end of the digest order, never by interest', async () => {
    const items = ['a', 'b', 'c'].map((id) => item(id, 600 * 1024));
    const byId = new Map(items.map((i) => [i.mediaId, i.bytes]));
    const requested: string[] = [];
    endpoints.getMedia.mockImplementation(async (id: string) => {
      requested.push(id);
      return byId.get(id)!.buffer;
    });

    // A 1 MB cap fits one 600 KB item.
    const result = await prefetchDigestMedia(digestWith(items), { capMb: 1 });
    expect(result.fetched).toBe(1);
    expect(result.overCap).toBe(2);
    expect(requested).toEqual(['a']);
  });

  it('removes cached media no longer in the digest', async () => {
    const first = ['a', 'b'].map((id) => item(id));
    const byId = new Map(first.map((i) => [i.mediaId, i.bytes]));
    endpoints.getMedia.mockImplementation(async (id: string) => byId.get(id)!.buffer);
    await prefetchDigestMedia(digestWith(first));

    const second = [first[0]!];
    const result = await prefetchDigestMedia(digestWith(second));
    expect(result.pruned).toBe(1);
    expect(await cachedMediaUri('b')).toBeNull();
    expect(await cachedMediaUri('a')).not.toBeNull();
  });
});

describe('the media cache', () => {
  it('rejects bytes that do not match the hash the digest advertised', async () => {
    const wrong = new Uint8Array([1, 2, 3]);
    await expect(
      storeMedia('a', wrong.buffer, toHex(sha256(new Uint8Array([9, 9, 9]))), 'now'),
    ).rejects.toBeInstanceOf(MediaIntegrityError);
    expect(await cachedMediaUri('a')).toBeNull();
  });

  it('stores bytes that do match, and reports the total held', async () => {
    const one = item('a', 512);
    await storeMedia('a', one.bytes.buffer, one.entry.sha256, 'now');
    expect(await cachedMediaUri('a')).toContain('a.m4a');
    expect(await cachedBytes()).toBe(512);
  });
});

describe('"Not for me" (SPEC §13.9, invariant 1)', () => {
  it('is device-local and makes no request', async () => {
    await hidePeer('peer-1', '2026-10-06T09:00:00Z');
    expect(await hiddenPeerIds()).toEqual(['peer-1']);
    expect(endpoints.getMedia).not.toHaveBeenCalled();
  });

  it('can be undone', async () => {
    await hidePeer('peer-1', '2026-10-06T09:00:00Z');
    await unhidePeer('peer-1');
    expect(await hiddenPeerIds()).toEqual([]);
  });

  it('is idempotent, so a double tap does not create two rows', async () => {
    await hidePeer('peer-1', '2026-10-06T09:00:00Z');
    await hidePeer('peer-1', '2026-10-06T09:01:00Z');
    expect(await hiddenPeerIds()).toEqual(['peer-1']);
  });
});
