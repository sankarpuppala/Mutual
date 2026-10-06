/**
 * The local signal store (SPEC.md §6.10, §13.8).
 *
 * Everything about a signal lives on the device: the peer, the intent, when it was created,
 * and the last day a crossing with that peer happened (which is what the TTL counts from).
 * The server holds only 20 opaque token values per epoch and cannot map any of them to a
 * peer or an intent.
 *
 * The one subtlety worth stating twice: **withdrawing a signal frees its slot immediately
 * and makes no network request** (SPEC §13.6, AC-T2-2). An "undo" request would be
 * attention-dependent traffic, and would also tell the server that *something* was
 * withdrawn, which is a fact about one-sided interest.
 */

import { SIGNAL_SET_SIZE } from '@mutual/protocol';

import type { Intent } from '@/api/types';
import { db } from '@/storage/localDb';

/** The cap on real signals per epoch: `signal_set_size` from constants.json (20). */
export const SIGNAL_CAP = SIGNAL_SET_SIZE;

export interface StoredSignal {
  peerId: string;
  intent: Intent;
  /** ISO timestamp. */
  createdAt: string;
  /** `YYYY-MM-DD`: the most recent crossing with this peer when the signal was made. */
  lastCrossingDay: string;
  /**
   * The peer's first name and identity key, copied from the digest when the signal was made.
   *
   * Kept locally so the Signals tab can show a name and an avatar without asking the server
   * anything: a per-peer request would be attention-dependent traffic (invariant 1), and
   * there is no per-peer endpoint before a match in any case (invariant 10).
   */
  peerName: string;
  peerIdentityPk: string;
}

interface Row {
  peer_id: string;
  intent: string;
  created_at: string;
  last_crossing_day: string;
  peer_name: string;
  peer_identity_pk: string;
}

const COLUMNS =
  'peer_id, intent, created_at, last_crossing_day, peer_name, peer_identity_pk';

const toSignal = (row: Row): StoredSignal => ({
  peerId: row.peer_id,
  intent: row.intent as Intent,
  createdAt: row.created_at,
  lastCrossingDay: row.last_crossing_day,
  peerName: row.peer_name,
  peerIdentityPk: row.peer_identity_pk,
});

/** Every active signal, oldest first. */
export async function listSignals(): Promise<StoredSignal[]> {
  const database = await db();
  const rows = await database.getAllAsync<Row>(
    `SELECT ${COLUMNS} FROM signals ORDER BY created_at`,
  );
  return rows.map(toSignal);
}

/** The intents signalled to one peer. Empty when none. */
export async function signalsForPeer(peerId: string): Promise<Intent[]> {
  const database = await db();
  const rows = await database.getAllAsync<Row>(
    `SELECT ${COLUMNS} FROM signals WHERE peer_id = ?`,
    [peerId],
  );
  return rows.map((r) => r.intent as Intent);
}

/** How many of the 20 slots are in use. */
export async function signalCount(): Promise<number> {
  const database = await db();
  const row = await database.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM signals');
  return row?.n ?? 0;
}

export class SignalCapReached extends Error {
  constructor() {
    super(`All ${SIGNAL_CAP} signals are out. Withdraw one to send another.`);
    this.name = 'SignalCapReached';
  }
}

/**
 * Replaces the set of intents signalled to one peer, in a single transaction.
 *
 * Called by the signal sheet, which lets someone pick several intents at once and change
 * them later. Passing an empty list is a withdrawal.
 *
 * Throws `SignalCapReached` if the change would exceed the cap -- checked inside the
 * transaction, so two sheets cannot both squeeze past it.
 */
export async function setSignalsForPeer(
  peerId: string,
  intents: readonly Intent[],
  options: {
    lastCrossingDay: string;
    now: string;
    /** From the digest card, so the Signals tab needs no network request. */
    peerName: string;
    peerIdentityPk: string;
  },
): Promise<void> {
  const database = await db();
  await database.withTransactionAsync(async () => {
    const others = await database.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM signals WHERE peer_id != ?',
      [peerId],
    );
    if ((others?.n ?? 0) + intents.length > SIGNAL_CAP) throw new SignalCapReached();

    const existing = await database.getAllAsync<Row>(
      `SELECT ${COLUMNS} FROM signals WHERE peer_id = ?`,
      [peerId],
    );
    const keep = new Set(intents);
    for (const row of existing) {
      if (!keep.has(row.intent as Intent)) {
        await database.runAsync('DELETE FROM signals WHERE peer_id = ? AND intent = ?', [
          peerId,
          row.intent,
        ]);
      }
    }
    for (const intent of intents) {
      // INSERT OR IGNORE, so re-confirming the sheet does not reset `created_at` and with
      // it the TTL the user has already partly used.
      await database.runAsync(
        `INSERT OR IGNORE INTO signals
           (peer_id, intent, created_at, last_crossing_day, peer_name, peer_identity_pk)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          peerId,
          intent,
          options.now,
          options.lastCrossingDay,
          options.peerName,
          options.peerIdentityPk,
        ],
      );
      // The name and key are refreshed even on an existing row: a peer can change their
      // first name, and a key change would otherwise leave a stale avatar.
      await database.runAsync(
        'UPDATE signals SET peer_name = ?, peer_identity_pk = ? WHERE peer_id = ? AND intent = ?',
        [options.peerName, options.peerIdentityPk, peerId, intent],
      );
    }
  });
}

/**
 * Withdraws every signal to a peer. Frees the slots at once and sends nothing (SPEC §13.6).
 *
 * If tonight's set has already gone out, the token is still in it and can still match
 * tonight -- which the UI says in so many words, because quietly implying otherwise would
 * be a lie about a privacy property.
 */
export async function withdrawPeer(peerId: string): Promise<void> {
  const database = await db();
  await database.runAsync('DELETE FROM signals WHERE peer_id = ?', [peerId]);
}

/** Refreshes the TTL anchor after a new crossing with a peer already signalled. */
export async function touchCrossing(peerId: string, day: string): Promise<void> {
  const database = await db();
  await database.runAsync(
    'UPDATE signals SET last_crossing_day = ? WHERE peer_id = ? AND last_crossing_day < ?',
    [day, peerId, day],
  );
}

// -------------------------------------------------------------- sent tokens

export interface SentToken {
  epoch: string;
  token: string;
  peerId: string;
  intent: Intent;
}

/**
 * Records what each uploaded token stood for.
 *
 * This is the only way a match can ever be interpreted: `GET /matches` returns
 * `(epoch, token)` pairs, and the device looks them up here to find the peer and the intent
 * (`src/matches/resolve.ts`). The server cannot do that lookup, which is claim C3.
 *
 * Rows are kept after a withdrawal and after a peer key change: a token uploaded last night
 * can match tonight, and the match has to stay interpretable (AC-T2-2).
 */
export async function recordSentTokens(epoch: string, tokens: readonly SentToken[]): Promise<void> {
  const database = await db();
  await database.withTransactionAsync(async () => {
    for (const t of tokens) {
      await database.runAsync(
        'INSERT OR REPLACE INTO sent_tokens (epoch, token, peer_id, intent) VALUES (?, ?, ?, ?)',
        [epoch, t.token, t.peerId, t.intent],
      );
    }
  });
}

/** What an uploaded token stood for, or null if this device never uploaded it. */
export async function lookupSentToken(
  epoch: string,
  token: string,
): Promise<SentToken | null> {
  const database = await db();
  const row = await database.getFirstAsync<{
    epoch: string;
    token: string;
    peer_id: string;
    intent: string;
  }>('SELECT epoch, token, peer_id, intent FROM sent_tokens WHERE epoch = ? AND token = ?', [
    epoch,
    token,
  ]);
  return row
    ? { epoch: row.epoch, token: row.token, peerId: row.peer_id, intent: row.intent as Intent }
    : null;
}

/**
 * Drops sent-token rows for epochs older than `before`.
 *
 * Kept for longer than the signal TTL on purpose: a match for an old epoch that was never
 * fetched (the device was offline for a week) must still resolve. The server deletes an
 * unfetched ended match after 30 days, so that is the horizon.
 */
export async function pruneSentTokens(before: string): Promise<void> {
  const database = await db();
  await database.runAsync('DELETE FROM sent_tokens WHERE epoch < ?', [before]);
}
