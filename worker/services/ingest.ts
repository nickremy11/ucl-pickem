import { eq, and, ne, inArray, sql } from "drizzle-orm";
import type { Db } from "../db";
import { teams, rounds, fixtures, ties, contests, pools, competitions } from "../db/schema";
import {
  fetchCurrentSeason,
  fetchMatches,
  fetchMatchesLive,
  mapStatus,
  score90,
  type FdMatch,
  type FdTeam,
} from "./footballData";
import { ensureCompetition } from "./competition";
import { STAGE_TO_ROUND, type RoundCode } from "../../shared/domain";
import { inChunks } from "../db/batch";

export interface SyncReport {
  season: string;
  matchesSeen: number;
  teamsUpserted: number;
  fixturesUpserted: number;
  tiesBuilt: number;
  contestsBuilt: number;
  unmapped: string[];
}

/** football-data.org stage/matchday -> our round code. */
function roundCodeFor(match: FdMatch): RoundCode | null {
  const mapped = STAGE_TO_ROUND[match.stage];
  if (mapped) return mapped;
  // League phase arrives as LEAGUE_STAGE (older payloads: GROUP_STAGE) with a
  // matchday of 1-8.
  if (match.matchday && match.matchday >= 1 && match.matchday <= 8) {
    return `MD${match.matchday}` as RoundCode;
  }
  return null;
}

/**
 * Pull the whole competition from the provider and reconcile it into our
 * schema: teams, fixtures, knockout ties, and the contests that people
 * actually pick.
 *
 * Idempotent and safe to run on every cron tick — every write is an upsert
 * keyed on the provider's own ids.
 */
export async function syncFromProvider(db: Db, env: Env): Promise<SyncReport> {
  const season = await fetchCurrentSeason(env);
  const competition = await ensureCompetition(db, env, season);
  const matches = await fetchMatches(env);

  const report: SyncReport = {
    season,
    matchesSeen: matches.length,
    teamsUpserted: 0,
    fixturesUpserted: 0,
    tiesBuilt: 0,
    contestsBuilt: 0,
    unmapped: [],
  };

  // ---- teams -------------------------------------------------------------
  const seenTeams = new Map<number, FdTeam>();
  for (const m of matches) {
    if (m.homeTeam?.id) seenTeams.set(m.homeTeam.id, m.homeTeam);
    if (m.awayTeam?.id) seenTeams.set(m.awayTeam.id, m.awayTeam);
  }

  await inChunks([...seenTeams.values()], teams, async (chunk) => {
    await db
      .insert(teams)
      .values(
        chunk.map((t) => ({
          providerTeamId: t.id,
          name: t.name,
          shortName: t.shortName ?? t.tla ?? t.name,
          crestUrl: t.crest,
        })),
      )
      .onConflictDoUpdate({
        target: teams.providerTeamId,
        set: {
          name: sql`excluded.name`,
          shortName: sql`excluded.short_name`,
          crestUrl: sql`excluded.crest_url`,
        },
      });
  });
  report.teamsUpserted = seenTeams.size;

  const teamRows = await db.query.teams.findMany();
  const teamIdByProvider = new Map(teamRows.map((t) => [t.providerTeamId, t.id]));

  // ---- rounds ------------------------------------------------------------
  const roundRows = await db.query.rounds.findMany({
    where: eq(rounds.competitionId, competition.id),
  });
  const roundByCode = new Map(roundRows.map((r) => [r.code, r]));

  // ---- fixtures ----------------------------------------------------------
  interface Pending {
    match: FdMatch;
    roundId: string;
    roundKind: "league" | "knockout";
    homeTeamId: string;
    awayTeamId: string;
  }

  const pending: Pending[] = [];
  for (const m of matches) {
    const code = roundCodeFor(m);
    const round = code ? roundByCode.get(code) : undefined;
    const homeTeamId = teamIdByProvider.get(m.homeTeam?.id);
    const awayTeamId = teamIdByProvider.get(m.awayTeam?.id);

    if (!round || !homeTeamId || !awayTeamId) {
      report.unmapped.push(`${m.id} ${m.stage} md=${m.matchday ?? "-"}`);
      continue;
    }
    pending.push({ match: m, roundId: round.id, roundKind: round.kind, homeTeamId, awayTeamId });
  }

  await inChunks(pending, fixtures, async (chunk) => {
    await db
      .insert(fixtures)
      .values(
        chunk.map((p) => {
          const s90 = score90(p.match);
          return {
            roundId: p.roundId,
            providerFixtureId: p.match.id,
            homeTeamId: p.homeTeamId,
            awayTeamId: p.awayTeamId,
            kickoffAt: new Date(p.match.utcDate),
            status: mapStatus(p.match),
            homeScore90: s90.home,
            awayScore90: s90.away,
            homeScoreFt: p.match.score.fullTime.home,
            awayScoreFt: p.match.score.fullTime.away,
            homePens: p.match.score.penalties?.home ?? null,
            awayPens: p.match.score.penalties?.away ?? null,
            updatedAt: new Date(),
          };
        }),
      )
      .onConflictDoUpdate({
        target: fixtures.providerFixtureId,
        set: {
          kickoffAt: sql`excluded.kickoff_at`,
          status: sql`excluded.status`,
          homeScore90: sql`excluded.home_score_90`,
          awayScore90: sql`excluded.away_score_90`,
          homeScoreFt: sql`excluded.home_score_ft`,
          awayScoreFt: sql`excluded.away_score_ft`,
          homePens: sql`excluded.home_pens`,
          awayPens: sql`excluded.away_pens`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  });
  report.fixturesUpserted = pending.length;

  const fixtureRows = await db.query.fixtures.findMany({
    where: inArray(
      fixtures.roundId,
      roundRows.map((r) => r.id),
    ),
  });
  const fixtureByProvider = new Map(fixtureRows.map((f) => [f.providerFixtureId, f]));

  // ---- knockout ties -----------------------------------------------------
  // Legs of a tie are two provider fixtures with the same pair of teams in the
  // same round, with the venues reversed. Group on the unordered pair.
  const tieGroups = new Map<string, Pending[]>();
  for (const p of pending) {
    if (p.roundKind !== "knockout") continue;
    const pair = [p.homeTeamId, p.awayTeamId].sort().join("|");
    const key = `${p.roundId}|${pair}`;
    const group = tieGroups.get(key) ?? [];
    group.push(p);
    tieGroups.set(key, group);
  }

  for (const group of tieGroups.values()) {
    // Earliest kickoff is leg 1; side A is whoever hosts it.
    group.sort(
      (a, b) => new Date(a.match.utcDate).getTime() - new Date(b.match.utcDate).getTime(),
    );
    const [leg1, leg2] = group;
    const leg1Fixture = fixtureByProvider.get(leg1.match.id);
    if (!leg1Fixture) continue;
    const leg2Fixture = leg2 ? fixtureByProvider.get(leg2.match.id) : undefined;

    const teamAId = leg1.homeTeamId;
    const teamBId = leg1.awayTeamId;

    const existing = await db.query.ties.findFirst({
      where: and(
        eq(ties.roundId, leg1.roundId),
        eq(ties.teamAId, teamAId),
        eq(ties.teamBId, teamBId),
      ),
    });

    const tieValues = {
      roundId: leg1.roundId,
      teamAId,
      teamBId,
      singleLeg: !leg2Fixture,
      leg1FixtureId: leg1Fixture.id,
      leg2FixtureId: leg2Fixture?.id ?? null,
    };

    const tieId = existing
      ? (await db.update(ties).set(tieValues).where(eq(ties.id, existing.id)).returning())[0].id
      : (await db.insert(ties).values(tieValues).returning())[0].id;

    // Stamp the legs so scoring can find them without re-deriving the pairing.
    await db
      .update(fixtures)
      .set({ tieId, leg: 1 })
      .where(eq(fixtures.id, leg1Fixture.id));
    if (leg2Fixture) {
      await db.update(fixtures).set({ tieId, leg: 2 }).where(eq(fixtures.id, leg2Fixture.id));
    }

    // One contest for the whole tie: pick who advances. It locks at the first
    // leg's kickoff, because by the second leg you would know too much.
    await db
      .insert(contests)
      .values({
        roundId: leg1.roundId,
        kind: "tie",
        tieId,
        sideATeamId: teamAId,
        sideBTeamId: teamBId,
        locksAt: leg1Fixture.kickoffAt,
      })
      .onConflictDoUpdate({
        target: contests.tieId,
        set: { locksAt: sql`excluded.locks_at` },
      });

    report.tiesBuilt++;
  }

  // ---- league contests ---------------------------------------------------
  const leagueFixtures = pending.filter((p) => p.roundKind === "league");
  await inChunks(leagueFixtures, contests, async (chunk) => {
    const values = chunk
      .map((p) => {
        const f = fixtureByProvider.get(p.match.id);
        if (!f) return null;
        return {
          roundId: p.roundId,
          kind: "fixture" as const,
          fixtureId: f.id,
          sideATeamId: p.homeTeamId,
          sideBTeamId: p.awayTeamId,
          locksAt: f.kickoffAt,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    if (values.length === 0) return;
    await db
      .insert(contests)
      .values(values)
      .onConflictDoUpdate({
        target: contests.fixtureId,
        set: { locksAt: sql`excluded.locks_at` },
      });
  });
  report.contestsBuilt = report.tiesBuilt + leagueFixtures.length;

  await refreshRoundTiming(db, competition.id);
  return report;
}

/**
 * Recompute each round's first kickoff and lifecycle status, plus the
 * competition's overall first kickoff (which is the default pool join
 * deadline).
 */
export async function refreshRoundTiming(db: Db, competitionId: string) {
  const roundRows = await db.query.rounds.findMany({
    where: eq(rounds.competitionId, competitionId),
    orderBy: rounds.sequence,
  });

  let seasonFirstKickoff: Date | null = null;

  for (const round of roundRows) {
    const roundContests = await db.query.contests.findMany({
      where: eq(contests.roundId, round.id),
    });

    if (roundContests.length === 0) continue;

    const first = roundContests.reduce(
      (min, c) => (c.locksAt < min ? c.locksAt : min),
      roundContests[0].locksAt,
    );
    if (!seasonFirstKickoff || first < seasonFirstKickoff) seasonFirstKickoff = first;

    const now = Date.now();
    const allLocked = roundContests.every((c) => c.locksAt.getTime() <= now);
    const allSettled = roundContests.every((c) => c.status === "settled");

    const status = allSettled ? "scored" : allLocked ? "locked" : "open";

    await db
      .update(rounds)
      .set({ firstKickoffAt: first, status, picksOpenAt: round.picksOpenAt ?? new Date() })
      .where(eq(rounds.id, round.id));

    // Freeze pick modes once the season has actually kicked off — not merely
    // when round 1's fixtures load. Fixtures are published weeks ahead, and
    // locking on their arrival would stop anyone choosing simple mode during
    // the entire pre-season.
    if (round.sequence === 1 && first.getTime() <= Date.now()) {
      await db
        .update(pools)
        .set({ modeLocked: true })
        .where(eq(pools.competitionId, competitionId));
    }
  }

  if (seasonFirstKickoff) {
    await db
      .update(competitions)
      .set({ firstKickoffAt: seasonFirstKickoff })
      .where(eq(competitions.id, competitionId));
  }

  return seasonFirstKickoff;
}

/**
 * Refresh scores and statuses for matches currently in play.
 *
 * Distinct from `syncFromProvider`, which reconciles the whole competition and
 * rewrites 144 rows. This runs on the read path whenever someone is watching a
 * round with a live match, so it must be cheap: it writes only the fixtures
 * whose score or status actually moved, and leans on a 20-second upstream
 * cache so many viewers cost one request.
 */
export async function refreshLiveScores(db: Db, env: Env): Promise<number> {
  const matches = await fetchMatchesLive(env);
  if (matches.length === 0) return 0;

  const byProviderId = new Map(matches.map((m) => [m.id, m]));

  // Only consider fixtures we already know about that are not yet final.
  const candidates = await db.query.fixtures.findMany({
    where: ne(fixtures.status, "finished"),
  });

  let updated = 0;
  for (const fixture of candidates) {
    const match = byProviderId.get(fixture.providerFixtureId);
    if (!match) continue;

    const status = mapStatus(match);
    const s90 = score90(match);
    const next = {
      status,
      homeScore90: s90.home,
      awayScore90: s90.away,
      homeScoreFt: match.score.fullTime.home,
      awayScoreFt: match.score.fullTime.away,
      homePens: match.score.penalties?.home ?? null,
      awayPens: match.score.penalties?.away ?? null,
    };

    const unchanged =
      fixture.status === next.status &&
      fixture.homeScore90 === next.homeScore90 &&
      fixture.awayScore90 === next.awayScore90 &&
      fixture.homeScoreFt === next.homeScoreFt &&
      fixture.awayScoreFt === next.awayScoreFt;
    if (unchanged) continue;

    await db
      .update(fixtures)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(fixtures.id, fixture.id));
    updated++;
  }

  return updated;
}

/** True when a round has a fixture the provider considers in play. */
export async function roundHasLiveFixture(db: Db, roundId: string): Promise<boolean> {
  const rows = await db.query.fixtures.findMany({ where: eq(fixtures.roundId, roundId) });
  const now = Date.now();
  return rows.some(
    (f) =>
      f.status === "live" ||
      // Kicked off but not yet marked finished: still worth polling, since the
      // provider can lag the whistle.
      (f.status !== "finished" &&
        f.status !== "postponed" &&
        f.kickoffAt.getTime() <= now &&
        now - f.kickoffAt.getTime() < 3.5 * 60 * 60 * 1000),
  );
}
