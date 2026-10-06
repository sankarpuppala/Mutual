/**
 * Turning a match into something meaningful (SPEC.md §6.9, §6.10, claim C3).
 *
 * `GET /matches` returns a peer card and a list of `(epoch, token)` pairs. It does **not**
 * say what the match was for, because the server does not know: an intent exists only as a
 * label this device stored beside the token it built (`sent_tokens`).
 *
 * So resolution is a local lookup, and its failure mode matters. A token this device cannot
 * find is **not** displayed as some default intent -- it is reported as unresolved. A match
 * shown as "study" when it was really "date" would be worse than a match shown as unknown,
 * and the honest case does happen: a reinstall loses `sent_tokens` along with the identity
 * key, and the server will still deliver matches for epochs before it.
 *
 * Verification, as AC-T2-2 requires: a token only counts if **this device uploaded it**.
 * That is what stops a server (or anything upstream of one) inventing a match with someone
 * the user never signalled -- it would have to produce a token the device remembers sending,
 * which it cannot compute without the device's private key.
 */

import type { Intent, Match, MatchedToken } from '@/api/types';
import { lookupSentToken } from '@/signals/db';

export interface ResolvedIntent {
  intent: Intent;
  epoch: string;
  token: string;
}

export interface ResolvedMatch {
  match: Match;
  /** The intents this device can account for, oldest epoch first. */
  intents: ResolvedIntent[];
  /**
   * Tokens the server delivered that this device has no record of uploading. Expected after
   * a reinstall; otherwise a reason to be suspicious, which is why they are surfaced rather
   * than dropped.
   */
  unverified: MatchedToken[];
}

/**
 * Resolves one match's tokens against what this device uploaded.
 *
 * The peer id is checked too: a token this device sent to A cannot legitimately turn up in a
 * match with B. A mismatch means either a server mixing things up or an attempt to mislead,
 * and in both cases the right response is to not claim an intent.
 */
export async function resolveMatch(match: Match): Promise<ResolvedMatch> {
  const intents: ResolvedIntent[] = [];
  const unverified: MatchedToken[] = [];

  for (const matched of match.matched) {
    const sent = await lookupSentToken(matched.epoch, matched.token);
    if (!sent || sent.peerId !== match.peer.peer_id) {
      unverified.push(matched);
      continue;
    }
    intents.push({ intent: sent.intent, epoch: matched.epoch, token: matched.token });
  }

  intents.sort((a, b) => (a.epoch === b.epoch ? a.intent.localeCompare(b.intent) : a.epoch.localeCompare(b.epoch)));
  return { match, intents, unverified };
}

export async function resolveMatches(matches: readonly Match[]): Promise<ResolvedMatch[]> {
  return Promise.all(matches.map(resolveMatch));
}

/**
 * The line shown under a mutual: "study", "study and project", "study, project and date".
 *
 * Returns null when nothing resolved, so the caller shows the honest fallback rather than
 * an empty list that reads as "no reason".
 */
export function describeIntents(
  intents: readonly ResolvedIntent[],
  labels: Record<Intent, string>,
): string | null {
  const unique = [...new Set(intents.map((i) => i.intent))].map((i) => labels[i]);
  if (unique.length === 0) return null;
  if (unique.length === 1) return unique[0]!;
  return `${unique.slice(0, -1).join(', ')} and ${unique.at(-1)}`;
}

/** True when a match is still live: not ended by either side (SPEC §6.9). */
export function isActive(match: Match): boolean {
  return match.state === 'active';
}

/**
 * Whether photos are available (SPEC §11.2).
 *
 * Under M, as soon as the match is notified. Under C, once each side has sent
 * `reveal.conversation_messages_each` messages or both have consented. The server decides
 * and reports it in `reveal.state`; this is a readable wrapper, not a second opinion --
 * guessing locally and being wrong would mean showing a photo the server will not serve.
 */
export function photosAvailable(match: Match): boolean {
  return match.reveal.state === 'revealed';
}

/** Under policy C, how many more messages each side needs. Null when not applicable. */
export function messagesStillNeeded(match: Match): number | null {
  if (match.reveal.policy !== 'C' || match.reveal.state === 'revealed') return null;
  return match.reveal.messages_needed_each ?? null;
}
