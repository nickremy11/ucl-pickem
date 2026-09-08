/**
 * Match clock.
 *
 * football-data.org exposes no `minute` field — only kickoff time, status, and
 * the running score. So the minute is *derived*, and it is an estimate, not a
 * fact: the half-time break varies, stoppage time is unknown, and delays are
 * invisible to us. Everything here is labelled with a `~` in the UI for that
 * reason, and the clock is never used for anything that decides points. Picks
 * lock on kickoff time; grading uses the final score.
 *
 * Computed on the client from values the server already sends, so it advances
 * every minute without refetching anything.
 */

export type MatchPeriod = "PRE" | "1H" | "HT" | "2H" | "FT";

export interface MatchClock {
  period: MatchPeriod;
  /** Approximate match minute; null outside play. */
  minute: number | null;
  /** Short display string: "~37'", "HT", "90+", "FT". */
  label: string;
  live: boolean;
}

/** Nominal length of the half-time interval, in minutes. */
const HALF_TIME_BREAK = 15;
const HALF = 45;
const FULL = 90;

export function matchClock(
  kickoffIso: string,
  status: "scheduled" | "live" | "finished" | "postponed",
  now: number = Date.now(),
): MatchClock {
  if (status === "finished") return { period: "FT", minute: null, label: "FT", live: false };
  if (status !== "live") return { period: "PRE", minute: null, label: "", live: false };

  const elapsed = (now - new Date(kickoffIso).getTime()) / 60_000;

  // Kickoff has not visibly happened yet, but the provider says it is running.
  if (elapsed < 0) return { period: "1H", minute: 1, label: "~1'", live: true };

  if (elapsed <= HALF) {
    const minute = Math.max(1, Math.ceil(elapsed));
    return { period: "1H", minute, label: `~${minute}'`, live: true };
  }

  // Between the end of the first half and the restart, we cannot tell added
  // time from the interval, so treat the whole window as half-time.
  if (elapsed <= HALF + HALF_TIME_BREAK) {
    return { period: "HT", minute: HALF, label: "HT", live: true };
  }

  const minute = Math.ceil(elapsed - HALF_TIME_BREAK);
  if (minute >= FULL) return { period: "2H", minute: FULL, label: "90+", live: true };

  return { period: "2H", minute, label: `~${minute}'`, live: true };
}
