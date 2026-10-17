import { inArray, sql } from "drizzle-orm";
import type { Db } from "../db";
import { teams, teamContext, type FormEntry } from "../db/schema";
import { inChunks } from "../db/batch";
import {
  fetchCompetitionTeams,
  fetchStandings,
  fetchFinishedMatches,
  type FdMatch,
  type FdStandingRow,
} from "./footballData";

/**
 * Domestic leagues the football-data.org free tier will serve. Anything else
 * answers 403, so asking would only burn the 10 req/min budget. A team whose
 * league is not listed simply has no domestic standing or league form. Widen
 * this list if the plan is ever upgraded.
 */
export const FREE_TIER_LEAGUES = ["PL", "PD", "SA", "BL1", "FL1", "DED", "PPL"];

/** Free tier is 10 requests/minute; stay safely under it. */
const REQUEST_GAP_MS = 6_500;
const RATE_LIMIT_BACKOFF_MS = 30_000;

const FORM_LENGTH = 5;

export interface ContextReport {
  teams: number;
  requests: number;
  leaguesRefreshed: string[];
  failures: string[];
}

/**
 * Last `limit` finished results for one team, oldest first, drawn from any
 * number of competitions' match lists.
 *
 * Judged on the full-time score: the provider's `winner` field reflects a
 * penalty shoot-out, which would turn a 1-1 cup draw into a win or loss.
 */
export function buildForm(
  providerTeamId: number,
  matches: FdMatch[],
  competitionOf: (m: FdMatch) => string,
  limit = FORM_LENGTH,
): FormEntry[] {
  const played = matches
    .filter(
      (m) =>
        m.status === "FINISHED" &&
        (m.homeTeam?.id === providerTeamId || m.awayTeam?.id === providerTeamId) &&
        m.score.fullTime.home !== null &&
        m.score.fullTime.away !== null,
    )
    .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime())
    .slice(-limit);

  return played.map((m) => {
    const home = m.homeTeam.id === providerTeamId;
    const mine = (home ? m.score.fullTime.home : m.score.fullTime.away) as number;
    const theirs = (home ? m.score.fullTime.away : m.score.fullTime.home) as number;
    const opp = home ? m.awayTeam : m.homeTeam;
    return {
      result: mine > theirs ? "W" : mine < theirs ? "L" : "D",
      opponent: opp.shortName ?? opp.tla ?? opp.name,
      home,
      score: `${mine}-${theirs}`,
      competition: competitionOf(m),
      date: m.utcDate.slice(0, 10),
    };
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Refresh country, standings and recent form for every team.
 *
 * Each league is fetched independently and a failure only leaves that league's
 * teams on their previous values, so one 429 or outage never blanks the page.
 * Requests are spaced to respect the provider's rate limit, so a full run takes
 * a couple of minutes: fine for a cron, far too slow for a request handler.
 */
export async function refreshTeamContext(db: Db, env: Env): Promise<ContextReport> {
  const report: ContextReport = { teams: 0, requests: 0, leaguesRefreshed: [], failures: [] };
  let first = true;

  async function call<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    if (!first) await sleep(REQUEST_GAP_MS);
    first = false;
    report.requests++;
    try {
      return await fn();
    } catch (err) {
      // The limit is a rolling minute that other jobs (the schedule sync that
      // runs just before this) also spend from. Waiting it out once is cheaper
      // than leaving a whole league stale until tomorrow.
      if (String(err).includes("rate limit")) {
        await sleep(RATE_LIMIT_BACKOFF_MS);
        report.requests++;
        try {
          return await fn();
        } catch (retryErr) {
          err = retryErr;
        }
      }
      report.failures.push(`${label}: ${String(err).slice(0, 160)}`);
      return null;
    }
  }

  const competitionTeams = await call("teams", () => fetchCompetitionTeams(env));
  if (!competitionTeams) return report;

  const ours = await db.select().from(teams);
  const idByProvider = new Map(ours.map((t) => [t.providerTeamId, t.id]));
  const existing = new Map(
    (await db.select().from(teamContext)).map((r) => [r.teamId, r]),
  );

  const uclTable = await call("ucl standings", () => fetchStandings(env, env.COMPETITION_CODE));
  const uclByTeam = new Map<number, FdStandingRow>();
  for (const row of uclTable ?? []) uclByTeam.set(row.team.id, row);

  const uclMatches =
    (await call("ucl matches", () => fetchFinishedMatches(env, env.COMPETITION_CODE))) ?? [];
  const uclMatchSet = new Set(uclMatches);

  // Only leagues that actually contain one of our teams are worth a request.
  const leagueOf = new Map<number, { code: string; name: string }>();
  for (const t of competitionTeams) {
    const league = t.runningCompetitions?.find(
      (c) => c.type === "LEAGUE" && FREE_TIER_LEAGUES.includes(c.code),
    );
    if (league) leagueOf.set(t.id, { code: league.code, name: league.name });
  }
  const leagueCodes = [...new Set([...leagueOf.values()].map((l) => l.code))];

  const tableByLeague = new Map<string, Map<number, FdStandingRow>>();
  const matchesByLeague = new Map<string, FdMatch[]>();
  for (const code of leagueCodes) {
    const table = await call(`${code} standings`, () => fetchStandings(env, code));
    const matches = await call(`${code} matches`, () => fetchFinishedMatches(env, code));
    if (table && matches) {
      tableByLeague.set(code, new Map(table.map((r) => [r.team.id, r])));
      matchesByLeague.set(code, matches);
      report.leaguesRefreshed.push(code);
    }
  }

  const refreshedAt = new Date();
  const rows: (typeof teamContext.$inferInsert)[] = [];

  for (const t of competitionTeams) {
    const teamId = idByProvider.get(t.id);
    if (!teamId) continue;

    const prev = existing.get(teamId);
    const league = leagueOf.get(t.id);
    const leagueFresh = !!league && tableByLeague.has(league.code);
    const leagueRow = league ? tableByLeague.get(league.code)?.get(t.id) : undefined;
    const ucl = uclByTeam.get(t.id);

    // Form is only rebuilt when every list it depends on was fetched, otherwise
    // a half-built list would read as a team that has barely played.
    const formReady = uclTable !== null && (!league || leagueFresh);
    const form = formReady
      ? buildForm(
          t.id,
          [...uclMatches, ...(league ? (matchesByLeague.get(league.code) ?? []) : [])],
          (m) => (uclMatchSet.has(m) ? "UCL" : (league?.code ?? "")),
        )
      : (prev?.form ?? null);

    rows.push({
      teamId,
      country: t.area?.name ?? prev?.country ?? null,
      flagUrl: t.area?.flag ?? prev?.flagUrl ?? null,
      leagueCode: league?.code ?? null,
      leagueName: league?.name ?? null,
      leaguePosition: leagueFresh ? (leagueRow?.position ?? null) : (prev?.leaguePosition ?? null),
      leaguePlayed: leagueFresh ? (leagueRow?.playedGames ?? null) : (prev?.leaguePlayed ?? null),
      leaguePoints: leagueFresh ? (leagueRow?.points ?? null) : (prev?.leaguePoints ?? null),
      uclPosition: uclTable ? (ucl?.position ?? null) : (prev?.uclPosition ?? null),
      uclPlayed: uclTable ? (ucl?.playedGames ?? null) : (prev?.uclPlayed ?? null),
      uclPoints: uclTable ? (ucl?.points ?? null) : (prev?.uclPoints ?? null),
      form,
      refreshedAt,
    });
  }

  await inChunks(rows, teamContext, async (chunk) => {
    await db
      .insert(teamContext)
      .values(chunk)
      .onConflictDoUpdate({
        target: teamContext.teamId,
        set: {
          country: sql`excluded.country`,
          flagUrl: sql`excluded.flag_url`,
          leagueCode: sql`excluded.league_code`,
          leagueName: sql`excluded.league_name`,
          leaguePosition: sql`excluded.league_position`,
          leaguePlayed: sql`excluded.league_played`,
          leaguePoints: sql`excluded.league_points`,
          uclPosition: sql`excluded.ucl_position`,
          uclPlayed: sql`excluded.ucl_played`,
          uclPoints: sql`excluded.ucl_points`,
          form: sql`excluded.form`,
          refreshedAt: sql`excluded.refreshed_at`,
        },
      });
  });

  report.teams = rows.length;
  return report;
}

export async function getContextFor(db: Db, teamIds: string[]) {
  if (teamIds.length === 0) return new Map<string, typeof teamContext.$inferSelect>();
  const rows = await db.select().from(teamContext).where(inArray(teamContext.teamId, teamIds));
  return new Map(rows.map((r) => [r.teamId, r]));
}
