import { eq, and, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db";
import {
  contests,
  fixtures,
  ties,
  rounds,
  picks,
  pools,
  poolMembers,
  standingsRounds,
  auditLog,
} from "../db/schema";
import { inChunks } from "../db/batch";
import type { Selection } from "../../shared/domain";

export interface ScoreReport {
  contestsSettled: number;
  /** Already-settled contests whose result changed underneath us. */
  outcomesCorrected: number;
  picksGraded: number;
  poolsRestated: number;
}

/**
 * Settle finished contests, grade the picks against them, and rebuild
 * standings. Safe to run repeatedly: a contest is only settled once, and
 * grading only touches picks whose `pointsAwarded` is still null.
 */
export async function settleAndScore(db: Db, competitionId: string): Promise<ScoreReport> {
  const report: ScoreReport = {
    contestsSettled: 0,
    outcomesCorrected: 0,
    picksGraded: 0,
    poolsRestated: 0,
  };

  const roundRows = await db.query.rounds.findMany({
    where: eq(rounds.competitionId, competitionId),
  });
  if (roundRows.length === 0) return report;
  const roundById = new Map(roundRows.map((r) => [r.id, r]));

  const roundIds = roundRows.map((r) => r.id);
  const allContests = await db.query.contests.findMany({
    where: inArray(contests.roundId, roundIds),
  });

  /*
   * Which contests need evaluating?
   *
   * The obvious answer — "the unsettled ones" — is wrong. Providers correct
   * scores after full time (a disputed goal, a data fix), and our own polling
   * can briefly see a wrong state. A contest that settled on a score which has
   * since changed would keep its original outcome forever, silently paying out
   * the wrong points with nothing to signal it. So a settled contest is
   * re-evaluated whenever its underlying fixture changed after it settled.
   */
  const pending: typeof allContests = [];
  for (const contest of allContests) {
    if (contest.status !== "settled") {
      pending.push(contest);
      continue;
    }
    const settledAt = contest.settledAt?.getTime() ?? 0;
    const touched = await fixtureTouchedAfter(db, contest, settledAt);
    if (touched) pending.push(contest);
  }

  for (const contest of pending) {
    const outcome = await resolveOutcome(db, contest);
    if (!outcome) continue;

    const changed = contest.status === "settled" && contest.outcome !== outcome.selection;

    await db
      .update(contests)
      .set({ outcome: outcome.selection, status: "settled", settledAt: new Date() })
      .where(eq(contests.id, contest.id));

    if (contest.tieId && outcome.winnerTeamId) {
      await db
        .update(ties)
        .set({
          winnerTeamId: outcome.winnerTeamId,
          aggA: outcome.aggA ?? null,
          aggB: outcome.aggB ?? null,
        })
        .where(eq(ties.id, contest.tieId));
    }

    if (changed) {
      // The result moved after we had already paid it out. Clear the grades so
      // the pass below re-scores every pick against the corrected outcome, and
      // record it — a score silently changing under people is exactly the kind
      // of thing a pool will argue about.
      await db
        .update(picks)
        .set({ isCorrect: null, pointsAwarded: null })
        .where(eq(picks.contestId, contest.id));

      await db.insert(auditLog).values({
        action: "contest.outcome.corrected",
        target: contest.id,
        before: { outcome: contest.outcome },
        after: { outcome: outcome.selection },
      });

      report.outcomesCorrected++;
    }

    if (contest.status !== "settled") report.contestsSettled++;
  }

  // ---- grade picks -------------------------------------------------------
  const settled = await db.query.contests.findMany({
    where: and(
      inArray(
        contests.roundId,
        roundRows.map((r) => r.id),
      ),
      eq(contests.status, "settled"),
    ),
  });

  for (const contest of settled) {
    if (!contest.outcome) continue;
    const round = roundById.get(contest.roundId);
    if (!round) continue;

    const pending = await db.query.picks.findMany({
      where: and(eq(picks.contestId, contest.id), isNull(picks.pointsAwarded)),
    });
    if (pending.length === 0) continue;

    // Fetch the margin once per contest, not once per pick.
    const margin = await marginFor(db, contest);

    for (const pick of pending) {
      const correct = gradePick(pick, contest.outcome, margin);
      await db
        .update(picks)
        .set({
          isCorrect: correct,
          pointsAwarded: correct ? round.pointsPerPick : 0,
          lockedAt: pick.lockedAt ?? contest.locksAt,
        })
        .where(eq(picks.id, pick.id));

      report.picksGraded++;
    }
  }

  // ---- standings ---------------------------------------------------------
  const poolRows = await db.query.pools.findMany({
    where: eq(pools.competitionId, competitionId),
  });
  for (const pool of poolRows) {
    await rebuildStandings(db, pool.id, roundRows);
    report.poolsRestated++;
  }

  return report;
}

interface Outcome {
  selection: Selection;
  winnerTeamId?: string;
  aggA?: number;
  aggB?: number;
}

/**
 * Minimal shapes the pure resolvers need. Declared structurally so tests can
 * build scenarios without constructing whole database rows — the knockout
 * paths below cannot be exercised by live data until February, so they have to
 * be provable in isolation.
 */
export interface FixtureLike {
  homeTeamId: string;
  awayTeamId: string;
  status: string;
  kickoffAt: Date;
  homeScore90: number | null;
  awayScore90: number | null;
  homeScoreFt: number | null;
  awayScoreFt: number | null;
  homePens: number | null;
  awayPens: number | null;
}

export interface TieLike {
  teamAId: string;
  teamBId: string;
  singleLeg: boolean;
}

/** Null means "not decided yet" — the contest stays open. */
async function resolveOutcome(
  db: Db,
  contest: typeof contests.$inferSelect,
): Promise<Outcome | null> {
  if (contest.kind === "fixture") {
    if (!contest.fixtureId) return null;
    const fixture = await db.query.fixtures.findFirst({
      where: eq(fixtures.id, contest.fixtureId),
    });
    return fixture ? resolveFixtureOutcome(fixture) : null;
  }

  if (!contest.tieId) return null;
  const tie = await db.query.ties.findFirst({ where: eq(ties.id, contest.tieId) });
  if (!tie) return null;

  const legFixtures = await db.query.fixtures.findMany({ where: eq(fixtures.tieId, tie.id) });
  return resolveTieOutcome(tie, legFixtures);
}

/** League-phase result, graded on the 90-minute score. */
export function resolveFixtureOutcome(fixture: FixtureLike): Outcome | null {
  if (fixture.status !== "finished") return null;
  if (fixture.homeScore90 === null || fixture.awayScore90 === null) return null;

  if (fixture.homeScore90 > fixture.awayScore90) return { selection: "SIDE_A" };
  if (fixture.homeScore90 < fixture.awayScore90) return { selection: "SIDE_B" };
  return { selection: "DRAW" };
}

/**
 * Whoever advances from a knockout tie, across both legs including extra time
 * and, if still level, penalties.
 *
 * There is no away-goals rule — UEFA abolished it in 2021 — so a level
 * aggregate goes straight to the deciding leg's shootout.
 */
export function resolveTieOutcome(tie: TieLike, legFixtures: FixtureLike[]): Outcome | null {
  const expectedLegs = tie.singleLeg ? 1 : 2;
  const finished = legFixtures.filter((f) => f.status === "finished");
  if (finished.length < expectedLegs) return null;

  let aggA = 0;
  let aggB = 0;
  for (const f of finished) {
    // Full-time includes extra time, which is what an aggregate must count.
    const home = f.homeScoreFt ?? f.homeScore90;
    const away = f.awayScoreFt ?? f.awayScore90;
    if (home === null || away === null) return null;
    // Side A hosted leg 1, so it is the away side in leg 2.
    if (f.homeTeamId === tie.teamAId) {
      aggA += home;
      aggB += away;
    } else {
      aggA += away;
      aggB += home;
    }
  }

  const win = (aWins: boolean): Outcome => ({
    selection: aWins ? "SIDE_A" : "SIDE_B",
    winnerTeamId: aWins ? tie.teamAId : tie.teamBId,
    aggA,
    aggB,
  });

  if (aggA !== aggB) return win(aggA > aggB);

  // Level on aggregate: penalties from the last leg played.
  const decider = [...finished].sort((a, b) => b.kickoffAt.getTime() - a.kickoffAt.getTime())[0];
  if (decider.homePens === null || decider.awayPens === null) return null;

  const homeIsA = decider.homeTeamId === tie.teamAId;
  const aPens = homeIsA ? decider.homePens : decider.awayPens;
  const bPens = homeIsA ? decider.awayPens : decider.homePens;
  if (aPens === bPens) return null;

  return win(aPens > bPens);
}

/** True when a contest's underlying fixture(s) changed after it was settled. */
async function fixtureTouchedAfter(
  db: Db,
  contest: typeof contests.$inferSelect,
  settledAtMs: number,
): Promise<boolean> {
  const rows = contest.fixtureId
    ? await db.query.fixtures.findMany({ where: eq(fixtures.id, contest.fixtureId) })
    : contest.tieId
      ? await db.query.fixtures.findMany({ where: eq(fixtures.tieId, contest.tieId) })
      : [];
  return rows.some((f) => f.updatedAt.getTime() > settledAtMs);
}

/** Goal margin (side A minus side B) after 90, for handicap grading. */
async function marginFor(db: Db, contest: typeof contests.$inferSelect): Promise<number | null> {
  if (contest.kind !== "fixture" || !contest.fixtureId) return null;
  const fixture = await db.query.fixtures.findFirst({
    where: eq(fixtures.id, contest.fixtureId),
  });
  if (!fixture || fixture.homeScore90 === null || fixture.awayScore90 === null) return null;
  return fixture.homeScore90 - fixture.awayScore90;
}

/**
 * A pick carrying a frozen handicap is graded against the spread; otherwise it
 * is a straight comparison to the outcome. Keying on `lineAtPick` rather than
 * re-reading the pool's mode means a pick is always graded by the rules that
 * were in force when it was made.
 */
export function gradePick(
  pick: Pick<typeof picks.$inferSelect, "selection" | "lineAtPick">,
  outcome: Selection,
  margin: number | null,
): boolean {
  if (pick.lineAtPick !== null && margin !== null) {
    const adjusted = margin + pick.lineAtPick;
    // Exactly zero is a push: nobody covered, so nobody scores.
    if (adjusted === 0) return false;
    return pick.selection === "SIDE_A" ? adjusted > 0 : adjusted < 0;
  }
  return pick.selection === outcome;
}

/**
 * Recompute one pool's per-round and cumulative standings.
 *
 * Materialised rather than computed on read: the standings table is the most
 * requested screen in the app, and this keeps it a single indexed lookup.
 */
export async function rebuildStandings(
  db: Db,
  poolId: string,
  roundRows?: (typeof rounds.$inferSelect)[],
) {
  const pool = await db.query.pools.findFirst({ where: eq(pools.id, poolId) });
  if (!pool) return;

  const allRounds =
    roundRows ??
    (await db.query.rounds.findMany({ where: eq(rounds.competitionId, pool.competitionId) }));
  const ordered = [...allRounds].sort((a, b) => a.sequence - b.sequence);

  const members = await db.query.poolMembers.findMany({
    where: eq(poolMembers.poolId, poolId),
  });
  if (members.length === 0) return;

  const allPicks = await db.query.picks.findMany({ where: eq(picks.poolId, poolId) });

  const contestRows = await db.query.contests.findMany({
    where: inArray(
      contests.roundId,
      ordered.map((r) => r.id),
    ),
  });
  const roundByContest = new Map(contestRows.map((x) => [x.id, x.roundId]));
  const contestCountByRound = new Map<string, number>();
  for (const x of contestRows) {
    contestCountByRound.set(x.roundId, (contestCountByRound.get(x.roundId) ?? 0) + 1);
  }

  const cumulative = new Map<string, number>();
  const rows: (typeof standingsRounds.$inferInsert)[] = [];

  for (const round of ordered) {
    const perUser = new Map<string, { points: number; made: number }>();
    for (const m of members) perUser.set(m.userId, { points: 0, made: 0 });

    for (const p of allPicks) {
      if (roundByContest.get(p.contestId) !== round.id) continue;
      const agg = perUser.get(p.userId);
      if (!agg) continue;
      agg.made++;
      agg.points += p.pointsAwarded ?? 0;
    }

    const standings = members.map((m) => {
      const agg = perUser.get(m.userId)!;
      const total = (cumulative.get(m.userId) ?? 0) + agg.points;
      cumulative.set(m.userId, total);
      return { userId: m.userId, points: agg.points, made: agg.made, total };
    });

    // Standard competition ranking: equal totals share a rank, and the next
    // distinct total skips ahead (1, 2, 2, 4).
    standings.sort((a, b) => b.total - a.total);
    let rank = 0;
    let seen = 0;
    let prevTotal: number | null = null;
    for (const s of standings) {
      seen++;
      if (prevTotal === null || s.total !== prevTotal) {
        rank = seen;
        prevTotal = s.total;
      }
      rows.push({
        poolId,
        userId: s.userId,
        roundId: round.id,
        points: s.points,
        cumulativePoints: s.total,
        rank,
        picksMade: s.made,
        picksPossible: contestCountByRound.get(round.id) ?? 0,
        updatedAt: new Date(),
      });
    }
  }

  await db.delete(standingsRounds).where(eq(standingsRounds.poolId, poolId));
  await inChunks(rows, standingsRounds, (chunk) =>
    db.insert(standingsRounds).values(chunk),
  );
}
