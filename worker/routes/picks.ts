import { Hono } from "hono";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  rounds,
  contests,
  picks,
  teams,
  oddsSnapshots,
} from "../db/schema";
import { type AppEnv, requireAuth } from "../lib/app";
import { requireMembership } from "../lib/pool";
import { badRequest, forbidden, notFound, conflict } from "../lib/http";
import { SELECTIONS, allowedSelections, ROUND_CODES } from "../../shared/domain";

export const pickRoutes = new Hono<AppEnv>();
pickRoutes.use("*", requireAuth);

// -------------------------------------------------------------- round list

pickRoutes.get("/:slug/rounds", async (c) => {
  const { db, pool } = await requireMembership(c);
  const userId = c.get("userId");

  const roundRows = await db.query.rounds.findMany({
    where: eq(rounds.competitionId, pool.competitionId),
    orderBy: rounds.sequence,
  });

  const myPicks = await db.query.picks.findMany({
    where: and(eq(picks.poolId, pool.id), eq(picks.userId, userId)),
  });
  const pickedContestIds = new Set(myPicks.map((p) => p.contestId));

  const summary = [];
  for (const r of roundRows) {
    const cs = await db.query.contests.findMany({ where: eq(contests.roundId, r.id) });
    const now = Date.now();
    summary.push({
      code: r.code,
      name: r.name,
      kind: r.kind,
      pointsPerPick: r.pointsPerPick,
      sequence: r.sequence,
      status: r.status,
      firstKickoffAt: r.firstKickoffAt,
      contestCount: cs.length,
      // "Still pickable" is what the UI nudges on, so compute it from lock
      // times rather than the coarse round status.
      openCount: cs.filter((x) => x.locksAt.getTime() > now).length,
      pickedCount: cs.filter((x) => pickedContestIds.has(x.id)).length,
    });
  }

  return c.json({ pickMode: pool.pickMode, rounds: summary });
});

// ------------------------------------------------------------ round detail

pickRoutes.get("/:slug/rounds/:code", async (c) => {
  const { db, pool } = await requireMembership(c);
  const userId = c.get("userId");

  const code = c.req.param("code") as (typeof ROUND_CODES)[number];
  if (!ROUND_CODES.includes(code)) badRequest("Unknown round.");

  const round = await db.query.rounds.findFirst({
    where: and(eq(rounds.competitionId, pool.competitionId), eq(rounds.code, code)),
  });
  if (!round) notFound("That round is not part of this competition.");

  const contestRows = await db.query.contests.findMany({
    where: eq(contests.roundId, round.id),
    orderBy: contests.locksAt,
  });

  if (contestRows.length === 0) {
    return c.json({
      round: roundSummary(round, pool.pickMode),
      contests: [],
      // Knockout rounds exist before their draw does; say so explicitly rather
      // than rendering an empty list that looks like a bug.
      awaitingDraw: round.kind === "knockout",
    });
  }

  const teamIds = [
    ...new Set(contestRows.flatMap((x) => [x.sideATeamId, x.sideBTeamId])),
  ];
  const teamRows = await db.query.teams.findMany({ where: inArray(teams.id, teamIds) });
  const teamById = new Map(teamRows.map((t) => [t.id, t]));

  const contestIds = contestRows.map((x) => x.id);
  const myPicks = await db.query.picks.findMany({
    where: and(
      eq(picks.poolId, pool.id),
      eq(picks.userId, userId),
      inArray(picks.contestId, contestIds),
    ),
  });
  const pickByContest = new Map(myPicks.map((p) => [p.contestId, p]));

  // Handicaps only exist for simple-mode league contests, and only the locked
  // snapshot is authoritative.
  const lines = new Map<string, typeof oddsSnapshots.$inferSelect>();
  if (pool.pickMode === "simple" && round.kind === "league") {
    const snaps = await db.query.oddsSnapshots.findMany({
      where: and(
        inArray(oddsSnapshots.contestId, contestIds),
        eq(oddsSnapshots.isLocked, true),
      ),
    });
    for (const s of snaps) lines.set(s.contestId, s);
  }

  const now = Date.now();
  return c.json({
    round: roundSummary(round, pool.pickMode),
    awaitingDraw: false,
    contests: contestRows.map((x) => {
      const line = lines.get(x.id);
      const mine = pickByContest.get(x.id);
      const locked = x.locksAt.getTime() <= now;
      return {
        id: x.id,
        kind: x.kind,
        sideA: team(teamById.get(x.sideATeamId)),
        sideB: team(teamById.get(x.sideBTeamId)),
        locksAt: x.locksAt,
        locked,
        status: x.status,
        outcome: locked ? x.outcome : null,
        allowedSelections: allowedSelections(x.kind, pool.pickMode),
        line: line ? { sideA: line.sideAPoint, sideB: line.sideBPoint, book: line.bookmaker } : null,
        // Simple mode cannot accept picks until the Monday snapshot lands.
        awaitingLine: pool.pickMode === "simple" && x.kind === "fixture" && !line,
        myPick: mine
          ? {
              selection: mine.selection,
              lineAtPick: mine.lineAtPick,
              isCorrect: mine.isCorrect,
              pointsAwarded: mine.pointsAwarded,
            }
          : null,
      };
    }),
  });
});

// ------------------------------------------------------------ submit picks

pickRoutes.post("/:slug/picks", async (c) => {
  const { db, pool } = await requireMembership(c);
  const userId = c.get("userId");

  const parsed = z
    .object({
      picks: z
        .array(z.object({ contestId: z.string().min(1), selection: z.enum(SELECTIONS) }))
        .min(1)
        .max(30),
    })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) badRequest("Send at least one pick.");

  const submitted = parsed.data.picks;
  const contestRows = await db.query.contests.findMany({
    where: inArray(
      contests.id,
      submitted.map((p) => p.contestId),
    ),
  });
  const contestById = new Map(contestRows.map((x) => [x.id, x]));

  const roundIds = [...new Set(contestRows.map((x) => x.roundId))];
  const roundRows = await db.query.rounds.findMany({ where: inArray(rounds.id, roundIds) });
  const roundById = new Map(roundRows.map((r) => [r.id, r]));

  const lines = new Map<string, typeof oddsSnapshots.$inferSelect>();
  if (pool.pickMode === "simple") {
    const snaps = await db.query.oddsSnapshots.findMany({
      where: and(
        inArray(
          oddsSnapshots.contestId,
          contestRows.map((x) => x.id),
        ),
        eq(oddsSnapshots.isLocked, true),
      ),
    });
    for (const s of snaps) lines.set(s.contestId, s);
  }

  const now = Date.now();
  const accepted: { contestId: string; selection: string }[] = [];

  for (const p of submitted) {
    const contest = contestById.get(p.contestId);
    if (!contest) badRequest("That contest does not exist.");

    const round = roundById.get(contest.roundId);
    if (!round || round.competitionId !== pool.competitionId) {
      forbidden("That contest is not part of this pool's competition.");
    }

    // The only lock that counts. Client timestamps are never consulted.
    if (contest.locksAt.getTime() <= now) {
      conflict(`Picks for that match closed at ${contest.locksAt.toISOString()}.`);
    }

    const allowed = allowedSelections(contest.kind, pool.pickMode);
    if (!allowed.includes(p.selection)) {
      badRequest(
        contest.kind === "tie"
          ? "Knockout ties are a straight pick of who advances — no draw."
          : `That selection is not valid for a ${pool.pickMode} pool.`,
      );
    }

    let lineAtPick: number | null = null;
    if (pool.pickMode === "simple" && contest.kind === "fixture") {
      const line = lines.get(contest.id);
      if (!line) {
        conflict("The betting line for that match has not been locked in yet.");
      }
      // Freeze the handicap onto the pick so later line movement cannot change
      // how an already-made pick is graded.
      lineAtPick = line.sideAPoint;
    }

    await db
      .insert(picks)
      .values({
        poolId: pool.id,
        userId,
        contestId: contest.id,
        selection: p.selection,
        lineAtPick,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [picks.poolId, picks.userId, picks.contestId],
        set: { selection: p.selection, lineAtPick, updatedAt: new Date() },
      });

    accepted.push({ contestId: contest.id, selection: p.selection });
  }

  return c.json({ accepted });
});

function roundSummary(round: typeof rounds.$inferSelect, pickMode: string) {
  return {
    code: round.code,
    name: round.name,
    kind: round.kind,
    pointsPerPick: round.pointsPerPick,
    status: round.status,
    firstKickoffAt: round.firstKickoffAt,
    oddsLockAt: round.oddsLockAt,
    pickMode,
  };
}

function team(t: typeof teams.$inferSelect | undefined) {
  return t
    ? { id: t.id, name: t.name, shortName: t.shortName, crestUrl: t.crestUrl }
    : { id: "", name: "TBD", shortName: "TBD", crestUrl: null };
}
