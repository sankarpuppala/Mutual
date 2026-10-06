/**
 * Performs the epoch's signal upload (SPEC.md §6.11), once the scheduler says it is due.
 *
 * The order of operations is the careful part. The device records what each token stood for
 * **before** the request, because a request that succeeds and a device that then crashes
 * would otherwise leave a match that can never be interpreted. Recording first can only
 * leave a harmless extra row.
 *
 * The ledger entry is written first of all, inside the same step, so two callers -- the
 * background task and an app that was just opened -- cannot both upload. The server would
 * reject the second with 409, but relying on that means the request was already sent, and
 * two requests in one epoch is itself a deviation from "exactly once".
 */

import { uploadSignals } from '@/api/endpoints';
import { ApiError } from '@/api/client';
import { hasUploaded, recordUpload } from '@/storage/localDb';

import { listSignals, recordSentTokens, type StoredSignal } from './db';
import { buildSignalSet, type PeerKey } from './setBuilder';
import { activeSignals } from './ttl';

export interface UploadContext {
  self: { userId: string; sk: string; pk: string };
  /** Identity keys for the peers currently in the digest. */
  peers: readonly PeerKey[];
  epoch: string;
  interestTtlDays: number;
  now: Date;
}

export type UploadResult =
  | { status: 'uploaded'; realCount: number; skipped: number }
  | { status: 'already_uploaded' }
  | { status: 'rejected'; code: string };

/**
 * Builds and uploads the set for `epoch`.
 *
 * Note what happens with **zero** active signals: the set still goes out, twenty
 * CSPRNG values and nothing else. That is not a wasted request -- it is the request that
 * makes the other nights unreadable, because a night with one real signal has to look
 * exactly like a night with none (claim C1).
 */
export async function uploadSignalSet(context: UploadContext): Promise<UploadResult> {
  const { self, peers, epoch, interestTtlDays, now } = context;

  // Claim the epoch first. An insert that changes nothing means someone else got there.
  if (await hasUploaded('signals', epoch)) return { status: 'already_uploaded' };
  if (!(await recordUpload('signals', epoch, now.toISOString()))) {
    return { status: 'already_uploaded' };
  }

  const stored: StoredSignal[] = await listSignals();
  const active = activeSignals(stored, epoch, interestTtlDays);
  const built = buildSignalSet(active, { self, epoch, peers });

  // Record the mapping before the request: a match for a token this device cannot interpret
  // is worse than an unused row.
  await recordSentTokens(
    epoch,
    built.real.map((t) => ({ ...t, epoch })),
  );

  try {
    await uploadSignals(epoch, { tokens: built.tokens });
  } catch (error) {
    if (error instanceof ApiError) {
      // 409 means the server already has this epoch's set -- consistent with the ledger,
      // so it is not a failure. Anything else is reported to the caller, which decides
      // whether to surface it; the set is never retried for a past epoch.
      if (error.status === 409) return { status: 'already_uploaded' };
      return { status: 'rejected', code: error.code };
    }
    throw error;
  }

  return { status: 'uploaded', realCount: built.real.length, skipped: built.skipped.length };
}
