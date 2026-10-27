/**
 * Photo sources for a revealed match (SPEC.md §11.2).
 *
 * `GET /matches/{id}/photos/{index}` needs the session bearer token, and React Native's
 * `Image` can send headers with its source, so the photo is loaded by the image pipeline
 * rather than through `api/client.ts`. That is deliberate: images are streamed and cached by
 * the platform, and routing megabytes of JPEG through a JSON client would be worse on both
 * counts.
 *
 * It does not weaken invariant 1. The invariant forbids attention-dependent traffic
 * **before a match exists**; these requests only happen inside a notified, revealed match,
 * where both parties already know about each other by construction. The server's own route
 * audit enforces the same boundary from its side (`test_route_audit.py`).
 *
 * Added to SPEC §20's file list in the same change that introduced it (Phase 11).
 */

import { baseUrl } from '@/api/client';
import { matchPhotoPath } from '@/api/endpoints';
import { getSessionToken } from '@/storage/secure';

export interface PhotoSource {
  uri: string;
  headers: Record<string, string>;
}

/** An `Image` source for one of a match's photos, with the session token attached. */
export async function matchPhotoSource(
  matchId: string,
  index: number,
): Promise<PhotoSource | null> {
  const token = await getSessionToken();
  if (!token) return null;
  return {
    uri: `${baseUrl()}/v1${matchPhotoPath(matchId, index)}`,
    headers: { Authorization: `Bearer ${token}` },
  };
}

/** An `Image` source for one of the user's own photos, with the session token attached. */
export async function ownPhotoSource(index: number): Promise<PhotoSource | null> {
  const token = await getSessionToken();
  if (!token) return null;
  return {
    uri: `${baseUrl()}/v1/profile/photos/${index}`,
    headers: { Authorization: `Bearer ${token}` },
  };
}
