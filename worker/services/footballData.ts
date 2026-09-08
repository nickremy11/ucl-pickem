/**
 * football-data.org v4 client.
 *
 * Free tier allows 10 requests/minute; a full sync costs two, so the cron
 * cadence is never close to the ceiling. Responses are cached briefly in KV so
 * a burst of manual syncs cannot trip the limit either.
 */

const BASE = "https://api.football-data.org/v4";
const CACHE_TTL_SEC = 60;

export interface FdTeam {
  id: number;
  name: string;
  shortName: string | null;
  tla: string | null;
  crest: string | null;
}

export interface FdScorePair {
  home: number | null;
  away: number | null;
}

export interface FdMatch {
  id: number;
  utcDate: string;
  status: "SCHEDULED" | "TIMED" | "IN_PLAY" | "PAUSED" | "FINISHED" | "POSTPONED" | "SUSPENDED" | "CANCELLED";
  stage: string;
  matchday: number | null;
  homeTeam: FdTeam;
  awayTeam: FdTeam;
  score: {
    winner: "HOME_TEAM" | "AWAY_TEAM" | "DRAW" | null;
    duration: "REGULAR" | "EXTRA_TIME" | "PENALTY_SHOOTOUT";
    fullTime: FdScorePair;
    halfTime: FdScorePair;
    regularTime?: FdScorePair;
    extraTime?: FdScorePair;
    penalties?: FdScorePair;
  };
}

async function get<T>(env: Env, path: string): Promise<T> {
  if (!env.FOOTBALL_DATA_TOKEN) {
    throw new Error(
      "FOOTBALL_DATA_TOKEN is not set. Add it to .dev.vars locally, or via `wrangler secret put`.",
    );
  }

  const cacheKey = `fd:${path}`;
  const cached = await env.SESSIONS.get(cacheKey);
  if (cached) return JSON.parse(cached) as T;

  const res = await fetch(`${BASE}${path}`, {
    headers: { "X-Auth-Token": env.FOOTBALL_DATA_TOKEN },
  });

  if (res.status === 429) {
    throw new Error("football-data.org rate limit hit (10 req/min on the free tier).");
  }
  if (!res.ok) {
    throw new Error(`football-data.org ${path} failed (${res.status}): ${await res.text()}`);
  }

  const body = (await res.json()) as T;
  await env.SESSIONS.put(cacheKey, JSON.stringify(body), { expirationTtl: CACHE_TTL_SEC });
  return body;
}

/** The season string we key our competition row on, e.g. "2026-27". */
export async function fetchCurrentSeason(env: Env): Promise<string> {
  const body = await get<{ currentSeason: { startDate: string; endDate: string } }>(
    env,
    `/competitions/${env.COMPETITION_CODE}`,
  );
  const startYear = Number(body.currentSeason.startDate.slice(0, 4));
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export async function fetchMatches(env: Env): Promise<FdMatch[]> {
  const body = await get<{ matches: FdMatch[] }>(
    env,
    `/competitions/${env.COMPETITION_CODE}/matches`,
  );
  return body.matches ?? [];
}

/**
 * The score after 90 minutes, which is what league-phase picks are graded on.
 *
 * League matches never go to extra time, so `fullTime` is already the 90-minute
 * score there. Knockout matches that ran long expose `regularTime` separately;
 * when the provider omits it we fall back to `fullTime` rather than guessing,
 * and knockout grading does not depend on this value anyway — it uses the
 * aggregate winner.
 */
export function score90(match: FdMatch): FdScorePair {
  if (match.score.duration === "REGULAR") return match.score.fullTime;
  return match.score.regularTime ?? match.score.fullTime;
}

export function isFinished(match: FdMatch): boolean {
  return match.status === "FINISHED";
}

/** Map provider status onto ours. */
export function mapStatus(match: FdMatch): "scheduled" | "live" | "finished" | "postponed" {
  switch (match.status) {
    case "FINISHED":
      return "finished";
    case "IN_PLAY":
    case "PAUSED":
      return "live";
    case "POSTPONED":
    case "SUSPENDED":
    case "CANCELLED":
      return "postponed";
    default:
      return "scheduled";
  }
}
