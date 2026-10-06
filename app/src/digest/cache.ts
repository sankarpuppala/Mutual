/**
 * The local media cache (SPEC.md §13.8, CLAUDE.md invariant 1).
 *
 * Voice notes live on the filesystem, indexed in `media_cache`. UI components read from
 * here and only from here: `VoicePlayer` takes a local URI, and there is no code path by
 * which opening a card can produce a request.
 *
 * The cache records the server's `sha256` and checks it on write. A corrupt file is dropped
 * rather than played: a silent zero-length voice note reads as a bug in someone's recording
 * rather than a transfer failure, and the digest already told us what the bytes should be.
 *
 * Written against expo-file-system's `File`/`Directory` API (SDK 54+), not the legacy
 * `documentDirectory` helpers -- `Uint8Array` goes straight to `write()` with no base64 trip.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { Directory, File, Paths } from 'expo-file-system';

import { db } from '@/storage/localDb';

/** Where cached voice notes live. Under `document`, so the OS does not evict them mid-day. */
function mediaDirectory(): Directory {
  return new Directory(Paths.document, 'mutual-media');
}

function mediaFile(mediaId: string): File {
  return new File(mediaDirectory(), `${mediaId}.m4a`);
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** The local URI for a cached media item, or null when it is not cached. */
export async function cachedMediaUri(mediaId: string): Promise<string | null> {
  const database = await db();
  const row = await database.getFirstAsync<{ path: string }>(
    'SELECT path FROM media_cache WHERE media_id = ?',
    [mediaId],
  );
  if (!row) return null;
  if (!mediaFile(mediaId).exists) {
    // The index and the filesystem disagreed: drop the row so the next prefetch refetches.
    await database.runAsync('DELETE FROM media_cache WHERE media_id = ?', [mediaId]);
    return null;
  }
  return row.path;
}

export class MediaIntegrityError extends Error {
  constructor(mediaId: string) {
    super(`Media ${mediaId} did not match its hash and was discarded.`);
    this.name = 'MediaIntegrityError';
  }
}

/** Writes one media item to the cache, verifying the server's hash first. */
export async function storeMedia(
  mediaId: string,
  bytes: ArrayBuffer,
  expectedSha256: string,
  fetchedAt: string,
): Promise<string> {
  const data = new Uint8Array(bytes);
  const actual = toHex(sha256(data));
  if (expectedSha256 && actual !== expectedSha256.toLowerCase()) {
    throw new MediaIntegrityError(mediaId);
  }

  const directory = mediaDirectory();
  if (!directory.exists) directory.create({ intermediates: true });

  const file = mediaFile(mediaId);
  if (file.exists) file.delete();
  file.create();
  file.write(data);

  const database = await db();
  await database.runAsync(
    `INSERT OR REPLACE INTO media_cache (media_id, path, sha256, bytes, fetched_at)
     VALUES (?, ?, ?, ?, ?)`,
    [mediaId, file.uri, actual, data.byteLength, fetchedAt],
  );
  return file.uri;
}

/** Media ids already cached, so a prefetch can skip them. */
export async function cachedMediaIds(): Promise<Set<string>> {
  const database = await db();
  const rows = await database.getAllAsync<{ media_id: string }>(
    'SELECT media_id FROM media_cache',
  );
  return new Set(rows.map((r) => r.media_id));
}

/**
 * Deletes cached media that is no longer in the digest.
 *
 * Nothing is kept "just in case": a voice note from a peer who has left the digest is a
 * recording of someone who may have paused, blocked you or deleted their account.
 */
export async function pruneMediaExcept(keep: readonly string[]): Promise<number> {
  const database = await db();
  const keepSet = new Set(keep);
  const rows = await database.getAllAsync<{ media_id: string }>(
    'SELECT media_id FROM media_cache',
  );
  let removed = 0;
  for (const row of rows) {
    if (keepSet.has(row.media_id)) continue;
    const file = mediaFile(row.media_id);
    if (file.exists) file.delete();
    await database.runAsync('DELETE FROM media_cache WHERE media_id = ?', [row.media_id]);
    removed += 1;
  }
  return removed;
}

/** Total bytes held, for the prefetch cap. */
export async function cachedBytes(): Promise<number> {
  const database = await db();
  const row = await database.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(bytes) AS total FROM media_cache',
  );
  return row?.total ?? 0;
}
