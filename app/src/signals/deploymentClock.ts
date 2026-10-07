/**
 * The deployment's wall clock, as opposed to the phone's (SPEC.md §6.3, §6.11).
 *
 * §6.3: "'Local' always means the deployment timezone. Devices read their clock corrected
 * by the `server_time` offset from `GET /v1/config`." §6.11: "The client uses the server's
 * current epoch from `GET /v1/config`, never its own clock."
 *
 * Why it is not a detail. Every "day" in this protocol is a date in the deployment
 * timezone: the epoch a signal set is addressed to, the day a presence upload covers, and
 * the 15-minute interval index two devices must agree on for the midnight rule in §6.13 to
 * put them on the same day. A phone in another timezone -- a traveller, a dual-SIM handset
 * that picked up the wrong network time, a device someone set by hand -- computes a
 * different answer for all three. The upload is then addressed to the wrong epoch and
 * rejected, while the local ledger has already recorded the day as claimed, so that epoch
 * is lost for good; and the random upload minute is drawn against the wrong wall clock,
 * which is a privacy parameter, not a convenience.
 *
 * Two values are needed and both come from `server_time`: the **skew** between the phone's
 * clock and the server's, and the deployment's **UTC offset**, which the ISO string carries
 * (`...+05:30`). Reading the offset from the string rather than hard-coding `Asia/Kolkata`
 * means a deployment elsewhere needs no code change -- and means the value is the server's
 * own answer, which is the point.
 *
 * Added to SPEC §20's file list in the same change that introduced it.
 */

export interface DeploymentClock {
  /** The deployment-local date at `at`, `YYYY-MM-DD`. This is what an epoch is. */
  day(at: Date): string;
  /** Minutes since deployment-local midnight at `at`, 0..1439. */
  minutes(at: Date): number;
}

/** The phone's own clock. The fallback when the server's time cannot be read. */
export const deviceClock: DeploymentClock = {
  day(at) {
    const y = at.getFullYear();
    const m = String(at.getMonth() + 1).padStart(2, '0');
    const d = String(at.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },
  minutes(at) {
    return at.getHours() * 60 + at.getMinutes();
  },
};

/**
 * The UTC offset an ISO 8601 timestamp declares, in minutes, or null when it declares
 * none. A string without an offset is ambiguous, and guessing at it is how a one-day error
 * gets in, so the caller falls back to the device instead.
 */
export function offsetMinutesOf(iso: string): number | null {
  if (/[Zz]$/.test(iso)) return 0;
  const match = /([+-])(\d{2}):?(\d{2})$/.exec(iso);
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/**
 * A clock reading the deployment's wall time.
 *
 * @param serverTime `server_time` from `GET /v1/config`, an ISO 8601 string carrying the
 *   deployment's UTC offset.
 * @param receivedAt the device's own time when that response arrived, so the skew between
 *   the two clocks can be carried forward. Passing `new Date()` at the point of use rather
 *   than at the point of fetch would measure nothing.
 *
 * Falls back to {@link deviceClock} when `serverTime` cannot be parsed: a clock that is
 * wrong by the device's timezone is recoverable, and one built on a misread string is not.
 */
export function deploymentClock(serverTime: string, receivedAt: Date): DeploymentClock {
  const instant = Date.parse(serverTime);
  const offset = offsetMinutesOf(serverTime);
  if (Number.isNaN(instant) || offset === null) return deviceClock;

  const skewMs = instant - receivedAt.getTime();
  const shift = (at: Date): Date => new Date(at.getTime() + skewMs + offset * 60_000);

  return {
    // Read back through the UTC getters: the shifted instant already *is* the deployment's
    // wall time, so applying the device's timezone a second time would undo the correction.
    day(at) {
      return shift(at).toISOString().slice(0, 10);
    },
    minutes(at) {
      const local = shift(at);
      return local.getUTCHours() * 60 + local.getUTCMinutes();
    },
  };
}
