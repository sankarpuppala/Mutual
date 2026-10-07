/**
 * The morning letter, assembled for the Today screen.
 *
 * This hook is where the digest meets everything that is device-local: the prompt library,
 * the prefetched media cache, the coarse time blocks, the signals already sent, and the
 * peers hidden with "Not for me". None of that second group exists on the server.
 *
 * The prefetch runs **as soon as the digest arrives**, before the screen renders a card, and
 * not again for anything the user does (CLAUDE.md invariant 1).
 *
 * Added to SPEC §20's file list in the same change that introduced it (Phase 11).
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { getDigest, getPromptLibrary } from '@/api/endpoints';
import type { DigestPeer, Intent } from '@/api/types';
import { listSignals, touchCrossing } from '@/signals/db';
import { hiddenPeerIds, getEncounterTime, type TimeBlock } from '@/storage/localDb';

import { cachedMediaUri } from './cache';
import { prefetchDigestMedia } from './prefetch';

/** How a crossing's time is described on a card. Never finer than this (invariant 4). */
const BLOCK_LABEL: Record<TimeBlock, string> = {
  morning: 'morning',
  afternoon: 'afternoon',
  evening: 'evening',
  night: 'night',
};

export interface LetterEntry {
  peer: DigestPeer;
  /** "Yesterday · evening", or just the day when no local time block is known. */
  timeLabel: string;
  /** Intents already signalled to this peer. Sender-only (claim C1). */
  signalled: Intent[];
  /** Local URI of the first prompt's voice note, from the cache. */
  voiceUri: string | null;
}

export interface MorningLetter {
  releaseDay: string;
  /** Crossings from the most recent release day. */
  today: LetterEntry[];
  /** Crossings from earlier in the week, collapsed behind a disclosure. */
  earlier: LetterEntry[];
  /** True until the digest has been fetched at least once. */
  loading: boolean;
  error: unknown;
  /** Resolves a prompt id to its question text. */
  questionFor: (promptId: string) => string;
  /**
   * Rebuild the letter from the device's own database — the signals table and the hidden
   * peers — after the user has changed one of them.
   *
   * **This must never touch the network** (invariant 1). A request here would exist only
   * because the user signalled, so its presence and timing in the server's log would mark
   * the moment a one-sided signal was created, changed or withdrawn, which is exactly the
   * fact claim C1 says the server cannot learn. Nothing on the server can have changed
   * either: the digest is byte-identical until the next release (claim C5).
   */
  refresh: () => void;
}

/** "Yesterday", "Monday", or the date for anything older than a week. */
function dayLabel(day: string, releaseDay: string): string {
  const parse = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
  const diff = Math.round((parse(releaseDay) - parse(day)) / 86_400_000);
  if (diff === 1) return 'Yesterday';
  if (diff <= 0) return 'Today';
  if (diff < 7) {
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
      new Date(`${day}T00:00:00Z`).getUTCDay()
    ]!;
  }
  return day;
}

export function useMorningLetter(): MorningLetter {
  const digest = useQuery({ queryKey: ['digest'], queryFn: getDigest });
  const library = useQuery({ queryKey: ['prompts'], queryFn: getPromptLibrary });

  const [entries, setEntries] = useState<LetterEntry[] | null>(null);
  const [prefetched, setPrefetched] = useState<string | null>(null);
  // Bumped by `refresh()`. It is in the local-rebuild effect's dependencies and nowhere
  // near the query, so changing it re-reads SQLite and sends nothing.
  const [localRevision, setLocalRevision] = useState(0);

  // One eager prefetch per release, before any card is shown.
  useEffect(() => {
    const data = digest.data;
    if (!data || prefetched === data.release_day) return;
    let cancelled = false;
    void (async () => {
      await prefetchDigestMedia(data).catch(() => undefined);
      if (!cancelled) setPrefetched(data.release_day);
    })();
    return () => {
      cancelled = true;
    };
  }, [digest.data, prefetched]);

  // Everything device-local, recomputed when the digest or the prefetch changes, and when
  // `refresh()` says the signals table has been written to.
  useEffect(() => {
    const data = digest.data;
    if (!data) return;
    let cancelled = false;
    void (async () => {
      const [signals, hidden] = await Promise.all([listSignals(), hiddenPeerIds()]);
      const hiddenSet = new Set(hidden);
      const signalsByPeer = new Map<string, Intent[]>();
      for (const signal of signals) {
        signalsByPeer.set(signal.peerId, [
          ...(signalsByPeer.get(signal.peerId) ?? []),
          signal.intent,
        ]);
      }

      const built: LetterEntry[] = [];
      for (const peer of data.peers) {
        // Move the TTL anchor forward for anyone already signalled. SPEC §6.10 counts the
        // seven days from the *most recent* crossing, so that a signal to someone you keep
        // seeing stays alive and one to someone who has left your routine quietly expires.
        // Until this call existed the anchor was written once, at signal creation, so every
        // signal expired seven days after the first crossing no matter how often you
        // crossed afterwards -- the opposite of the documented behaviour, and silent,
        // because the only visible effect was that the signal stopped being uploaded.
        //
        // This is a local write, triggered by the digest arriving rather than by anything
        // the user does with a card, so it adds no traffic of any kind (invariant 1).
        if (signalsByPeer.has(peer.card.peer_id)) {
          await touchCrossing(peer.card.peer_id, peer.last_day);
        }
        if (hiddenSet.has(peer.card.peer_id)) continue;
        const stored = await getEncounterTime(peer.encounter);
        const when = dayLabel(peer.last_day, data.release_day);
        const timeLabel = stored ? `${when} · ${BLOCK_LABEL[stored.block]}` : when;
        const firstVoice = peer.card.prompts[0]?.voice_media_id ?? null;
        built.push({
          peer,
          timeLabel,
          signalled: signalsByPeer.get(peer.card.peer_id) ?? [],
          voiceUri: firstVoice ? await cachedMediaUri(firstVoice) : null,
        });
      }
      if (!cancelled) setEntries(built);
    })();
    return () => {
      cancelled = true;
    };
  }, [digest.data, prefetched, localRevision]);

  const questionFor = useMemo(() => {
    const byId = new Map((library.data?.prompts ?? []).map((p) => [p.id, p.text]));
    return (promptId: string): string => byId.get(promptId) ?? '';
  }, [library.data]);

  const releaseDay = digest.data?.release_day ?? '';
  const all = entries ?? [];
  const mostRecent = all.filter((e) => e.peer.last_day === latestDay(all));

  return {
    releaseDay,
    today: mostRecent,
    earlier: all.filter((e) => !mostRecent.includes(e)),
    loading: digest.isLoading || entries === null,
    error: digest.error,
    questionFor,
    refresh: () => {
      setLocalRevision((n) => n + 1);
    },
  };
}

/** The most recent crossing day in the letter; everything else is "earlier this week". */
function latestDay(entries: readonly LetterEntry[]): string {
  return entries.reduce((best, e) => (e.peer.last_day > best ? e.peer.last_day : best), '');
}
