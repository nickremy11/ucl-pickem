import { Hono } from "hono";
import { eq, and, inArray } from "drizzle-orm";
import { rounds, standingsRounds, users, poolMembers, picks, contests } from "../db/schema";
import { type AppEnv, requireAuth } from "../lib/app";
import { requireMembership } from "../lib/pool";

export const standingsRoutes = new Hono<AppEnv>();
standingsRoutes.use("*", requireAuth);

standingsRoutes.get("/:slug/standings", async (c) => {
  const { db, pool } = await requireMembership(c);

  const roundRows = await db.query.rounds.findMany({
    where: eq(rounds.competitionId, pool.competitionId),
    orderBy: rounds.sequence,
  });

  const memberRows = await db
    .select({
      userId: users.id,
      username: users.username,
      email: users.email,
      displayName: poolMembers.displayName,
    })
    .from(poolMembers)
    .innerJoin(users, eq(users.id, poolMembers.userId))
    .where(eq(poolMembers.poolId, pool.id));

  const rows = await db.query.standingsRounds.findMany({
    where: eq(standingsRounds.poolId, pool.id),
  });

  const byUser = new Map<string, Map<string, (typeof rows)[number]>>();
  for (const r of rows) {
    const m = byUser.get(r.userId) ?? new Map();
    m.set(r.roundId, r);
    byUser.set(r.userId, m);
  }

  // The last round that has actually been scored decides the headline total.
  const scoredRounds = roundRows.filter((r) => r.status === "scored" || r.status === "locked");
  const latest = scoredRounds[scoredRounds.length - 1] ?? roundRows[0];

  const table = memberRows
    .map((m) => {
      const perRound = byUser.get(m.userId);
      const latestRow = perRound?.get(latest?.id ?? "");
      return {
        userId: m.userId,
        name: m.displayName ?? m.username ?? m.email.split("@")[0],
        total: latestRow?.cumulativePoints ?? 0,
        rank: latestRow?.rank ?? null,
        rounds: Object.fromEntries(
          roundRows.map((r) => {
            const row = perRound?.get(r.id);
            return [
              r.code,
              row
                ? {
                    points: row.points,
                    cumulative: row.cumulativePoints,
                    rank: row.rank,
                    picksMade: row.picksMade,
                    picksPossible: row.picksPossible,
                  }
                : null,
            ];
          }),
        ),
      };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  return c.json({
    pool: { slug: pool.slug, name: pool.name, pickMode: pool.pickMode },
    rounds: roundRows.map((r) => ({
      code: r.code,
      name: r.name,
      kind: r.kind,
      pointsPerPick: r.pointsPerPick,
      status: r.status,
    })),
    standings: table,
  });
});

/**
 * Everyone's picks for one round — but only for contests that have locked.
 * Revealing an open contest would let a late picker copy the room.
 */
standingsRoutes.get("/:slug/rounds/:code/picks", async (c) => {
  const { db, pool } = await requireMembership(c);

  const round = await db.query.rounds.findFirst({
    where: and(
      eq(rounds.competitionId, pool.competitionId),
      eq(rounds.code, c.req.param("code") as never),
    ),
  });
  if (!round) return c.json({ contests: [], picks: [] });

  const contestRows = await db.query.contests.findMany({
    where: eq(contests.roundId, round.id),
    orderBy: contests.locksAt,
  });

  const now = Date.now();
  const revealed = contestRows.filter((x) => x.locksAt.getTime() <= now);
  if (revealed.length === 0) return c.json({ contests: [], picks: [] });

  const pickRows = await db.query.picks.findMany({
    where: and(
      eq(picks.poolId, pool.id),
      inArray(
        picks.contestId,
        revealed.map((x) => x.id),
      ),
    ),
  });

  return c.json({
    contests: revealed.map((x) => ({ id: x.id, outcome: x.outcome, status: x.status })),
    picks: pickRows.map((p) => ({
      userId: p.userId,
      contestId: p.contestId,
      selection: p.selection,
      isCorrect: p.isCorrect,
      pointsAwarded: p.pointsAwarded,
    })),
  });
});
