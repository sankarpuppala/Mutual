/**
 * Signal lifetime (SPEC.md §6.10).
 *
 * A signal is active from when it is made until `interest_ttl_days` (7) after the most
 * recent crossing with that peer, or until it is withdrawn, or until a match arrives for
 * its `(peer, intent)`.
 *
 * The TTL counts from the **crossing**, not from the signal, so a signal to someone you keep
 * seeing stays alive while one to someone who has left your routine quietly expires. That
 * matters for the cap: twenty slots would otherwise fill up with people you no longer cross.
 *
 * Pure date arithmetic on `YYYY-MM-DD` strings, with no timezone handling: every "day" in
 * this project is already a local day in the configured timezone (CLAUDE.md §6), and parsing
 * these into `Date` objects is how off-by-one bugs get in.
 */

import type { StoredSignal } from './db';

/** `YYYY-MM-DD` plus `days`. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const parse = (day: string): number => {
    const [y, m, d] = day.split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/** The day a signal stops being active, inclusive of that day. */
export function expiryDay(signal: StoredSignal, interestTtlDays: number): string {
  return addDays(signal.lastCrossingDay, interestTtlDays);
}

/** True when the signal is still active on `today`. */
export function isActive(
  signal: StoredSignal,
  today: string,
  interestTtlDays: number,
): boolean {
  return daysBetween(today, expiryDay(signal, interestTtlDays)) >= 0;
}

/** The active signals, as of `today`. */
export function activeSignals(
  signals: readonly StoredSignal[],
  today: string,
  interestTtlDays: number,
): StoredSignal[] {
  return signals.filter((s) => isActive(s, today, interestTtlDays));
}

/** The expired ones, so the caller can delete them and free their slots. */
export function expiredSignals(
  signals: readonly StoredSignal[],
  today: string,
  interestTtlDays: number,
): StoredSignal[] {
  return signals.filter((s) => !isActive(s, today, interestTtlDays));
}

/**
 * The human phrasing used on the Signals tab ("until Sunday", "until tomorrow").
 *
 * An exact countdown is avoided on purpose: "6 days 4 hours left" is the urgency copy this
 * product does not use (SPEC §13.6), and the TTL moves anyway every time you cross the
 * person again.
 */
export function expiryLabel(
  signal: StoredSignal,
  today: string,
  interestTtlDays: number,
  weekdayName: (day: string) => string,
): string {
  const expires = expiryDay(signal, interestTtlDays);
  const days = daysBetween(today, expires);
  if (days < 0) return 'expired';
  if (days === 0) return 'until the end of today';
  if (days === 1) return 'until tomorrow';
  if (days <= 6) return `until ${weekdayName(expires)}`;
  return `until ${weekdayName(expires)} next week`;
}
