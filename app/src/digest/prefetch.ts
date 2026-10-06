/**
 * Eager media prefetch — the implementation of CLAUDE.md invariant 1.
 *
 * **This is the only code in the app that fetches media.** Everything else reads the local
 * cache. The rule it enforces:
 *
 *   > Never add a network request whose existence, timing, size, order or parameters depend
 *   > on which profile a user viewed, opened, scrolled to, played or signalled.
 *
 * So the prefetch fetches **every** item the digest lists, **in the order the digest lists
 * them** (which is the server's own sorted order, not the UI's), **before any card is
 * rendered**, and it does the same whether the user then opens one card, all of them, or
 * none. An observer watching the device's traffic sees one burst of fetches each morning
 * whose contents are a function of the digest alone.
 *
 * The consequence to keep in mind while changing this file: *any* lazy loading, any "fetch
 * on scroll", any retry triggered by a play button, breaks claim C1 from the client side
 * even though the server is unchanged. AC-T2-2 tests for exactly that.
 */

import { getMedia } from '@/api/endpoints';
import type { DigestResponse } from '@/api/types';

import { cachedMediaIds, pruneMediaExcept, storeMedia } from './cache';

/** `digest.media_prefetch_cap_mb` in server/config.yaml. */
export const DEFAULT_CAP_MB = 25;

export interface PrefetchResult {
  /** Items fetched in this pass. */
  fetched: number;
  /** Items already in the cache from a previous pass. */
  skipped: number;
  /** Items that failed, with the reason. The digest is still usable without them. */
  failed: { mediaId: string; reason: string }[];
  /** Items not attempted because the cap was reached. */
  overCap: number;
  /** Cached items removed because they are no longer in the digest. */
  pruned: number;
}

export interface PrefetchOptions {
  capMb?: number;
  now?: Date;
}

/**
 * Fetches every media item in `digest.media`, in order.
 *
 * Sequential rather than parallel, on purpose: a parallel burst is faster but makes the
 * per-item order observable only as a race, and the fixed order is part of what makes the
 * traffic independent of the UI. A morning's worth of voice notes is a few megabytes.
 *
 * **The cap.** `digest.media_prefetch_cap_mb` bounds how much is pulled. What happens at the
 * cap is a documented spec gap (PLAN.md deferred item 5), and the resolution used here is
 * the only one that preserves invariant 1: items are dropped **from the end of the digest's
 * own order**, never by what the user has looked at. The set of items fetched therefore
 * still depends only on the digest.
 */
export async function prefetchDigestMedia(
  digest: DigestResponse,
  { capMb = DEFAULT_CAP_MB, now = new Date() }: PrefetchOptions = {},
): Promise<PrefetchResult> {
  const alreadyCached = await cachedMediaIds();
  const capBytes = capMb * 1024 * 1024;
  const fetchedAt = now.toISOString();

  const result: PrefetchResult = {
    fetched: 0,
    skipped: 0,
    failed: [],
    overCap: 0,
    pruned: 0,
  };

  let budget = capBytes;

  for (const item of digest.media) {
    if (alreadyCached.has(item.media_id)) {
      result.skipped += 1;
      budget -= item.bytes;
      continue;
    }
    if (item.bytes > budget) {
      // Over the cap: counted and skipped, in digest order, so which items are missing is
      // still a function of the digest rather than of what anyone looked at.
      result.overCap += 1;
      continue;
    }
    try {
      const bytes = await getMedia(item.media_id);
      await storeMedia(item.media_id, bytes, item.sha256, fetchedAt);
      result.fetched += 1;
      budget -= item.bytes;
    } catch (error) {
      result.failed.push({
        mediaId: item.media_id,
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  result.pruned = await pruneMediaExcept(digest.media.map((m) => m.media_id));
  return result;
}
