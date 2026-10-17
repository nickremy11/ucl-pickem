/**
 * football-data.org v4 client.
 *
 * Free tier allows 10 requests/minute; a full sync costs two, so the cron
 * cadence is never close to the ceiling. Responses are cached briefly in KV so
 * a burst of manual syncs cannot trip the limit either.
 */

const BASE = "https://api.football-data.org/v4";
const CACHE_TTL_SEC = 60;
/**
 * Live polling cache. Short enough that a watching viewer sees a goal within
 * half a minute, long enough that a hundred viewers still cost one upstream
 * request — comfortably inside the free tier's 10 req/min.
 */
const LIVE_CACHE_TTL_SEC = 20;

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

export interface FdArea {
  name: string;
  code: string;
  flag: string | null;
}

export interface FdCompetitionTeam extends FdTeam {
  area: FdArea;
  runningCompetitions?: { code: string; name: string; type: string }[];
}

export interface FdStandingRow {
  position: number;
  team: FdTeam;
  playedGames: number;
  points: number;
}

async function get<T>(env: Env, path: string, ttlSec = CACHE_TTL_SEC): Promise<T> {
  if (!env.FOOTBALL_DATA_TOKEN) {
    throw new Error(
      "FOOTBALL_DATA_TOKEN is not set. Add it to .dev.vars locally, or via `wrangler secret put`.",
    );
  }

  // ttlSec 0 bypasses the cache. The team-context refresh makes ~17 requests in
  // one invocation; KV reads and writes count as subrequests too, so caching
  // them would triple the cost against Workers' per-invocation ceiling.
  const cacheKey = `fd:${ttlSec}:${path}`;
  if (ttlSec > 0) {
    const cached = await env.SESSIONS.get(cacheKey);
    if (cached) return JSON.parse(cached) as T;
  }

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
  if (ttlSec > 0) {
    await env.SESSIONS.put(cacheKey, JSON.stringify(body), { expirationTtl: ttlSec });
  }
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

/** Same payload, but cached briefly so live scores stay current. */
export async function fetchMatchesLive(env: Env): Promise<FdMatch[]> {
  const body = await get<{ matches: FdMatch[] }>(
    env,
    `/competitions/${env.COMPETITION_CODE}/matches`,
    LIVE_CACHE_TTL_SEC,
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

// ---- team context ----------------------------------------------------------
// Uncached on purpose (see `get`); callers pace themselves.

export async function fetchCompetitionTeams(env: Env): Promise<FdCompetitionTeam[]> {
  const body = await get<{ teams: FdCompetitionTeam[] }>(
    env,
    `/competitions/${env.COMPETITION_CODE}/teams`,
    0,
  );
  return body.teams ?? [];
}

/** The first (overall) table of a competition's standings. */
export async function fetchStandings(env: Env, code: string): Promise<FdStandingRow[]> {
  const body = await get<{ standings: { type: string; table: FdStandingRow[] }[] }>(
    env,
    `/competitions/${code}/standings`,
    0,
  );
  const total = body.standings?.find((s) => s.type === "TOTAL") ?? body.standings?.[0];
  return total?.table ?? [];
}

export async function fetchFinishedMatches(env: Env, code: string): Promise<FdMatch[]> {
  const body = await get<{ matches: FdMatch[] }>(
    env,
    `/competitions/${code}/matches?status=FINISHED`,
    0,
  );
  return body.matches ?? [];
}
