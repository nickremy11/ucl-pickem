import { matchClock } from "@shared/matchClock";
import type { MatchState } from "../lib/api";
import { useNow } from "../lib/useNow";

/**
 * Live score and match clock.
 *
 * The minute is derived from kickoff time, not reported by the data provider —
 * see `shared/matchClock.ts`. It is prefixed with `~` everywhere so nobody
 * mistakes an estimate for the official clock, and it recomputes locally each
 * second rather than needing a refetch.
 */
export function MatchScore({ match }: { match: MatchState }) {
  // The minute only changes once a minute, so a 20s tick is ample; the score
  // itself arrives through the query's refetch.
  const now = useNow(20_000);
  const clock = matchClock(match.kickoffAt, match.status, now);

  if (clock.period === "PRE") return null;

  const hasScore = match.home !== null && match.away !== null;

  return (
    <span className="inline-flex items-center gap-2">
      {clock.live && (
        <span className="inline-flex items-center gap-1.5">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-lose-500 opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-lose-500" />
          </span>
          <span className="text-[10px] font-bold tracking-wide text-lose-500">
            {clock.label}
          </span>
        </span>
      )}

      {hasScore && (
        <span
          className={`tnum rounded-md px-1.5 py-0.5 text-xs font-black ${
            clock.live ? "bg-lose-500/15 text-chalk-50" : "bg-pitch-800 text-chalk-200"
          }`}
        >
          {match.home}–{match.away}
        </span>
      )}

      {!clock.live && clock.period === "FT" && (
        <span className="text-[10px] font-bold text-chalk-500">FT</span>
      )}
    </span>
  );
}
