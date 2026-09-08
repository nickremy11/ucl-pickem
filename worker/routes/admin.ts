import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { type AppEnv } from "../lib/app";
import { forbidden, badRequest } from "../lib/http";
import { timingSafeEqual } from "../lib/crypto";
import { syncFromProvider, refreshRoundTiming } from "../services/ingest";
import { getActiveCompetition } from "../services/competition";
import { settleAndScore } from "../services/scoring";
import { refreshContestLocks } from "../services/jobs";
import { rounds, contests } from "../db/schema";

export const adminRoutes = new Hono<AppEnv>();

const enc = new TextEncoder();

/**
 * Maintenance endpoints are gated by a shared secret rather than a user role:
 * they exist to bootstrap and repair the competition, including before any
 * account exists. Compared in constant time so the header cannot be probed
 * byte by byte.
 */
adminRoutes.use("*", async (c, next) => {
  const expected = c.env.ADMIN_TOKEN;
  const provided = c.req.header("x-admin-token") ?? "";
  if (!expected) forbidden("ADMIN_TOKEN is not configured.");
  if (!timingSafeEqual(enc.encode(provided), enc.encode(expected))) {
    forbidden("Bad admin token.");
  }
  await next();
});

/** Pull teams, fixtures, ties and contests from football-data.org. */
adminRoutes.post("/sync", async (c) => {
  const report = await syncFromProvider(c.get("db"), c.env);
  return c.json(report);
});

/** Recompute round timing and lifecycle status without re-fetching. */
adminRoutes.post("/refresh-rounds", async (c) => {
  const db = c.get("db");
  const competition = await getActiveCompetition(db, c.env);
  if (!competition) badRequest("No competition loaded. Run /api/admin/sync first.");
  const firstKickoff = await refreshRoundTiming(db, competition.id);
  return c.json({ competitionId: competition.id, firstKickoff });
});

/** Settle finished contests, grade picks, rebuild standings. */
adminRoutes.post("/score", async (c) => {
  const db = c.get("db");
  const competition = await getActiveCompetition(db, c.env);
  if (!competition) badRequest("No competition loaded. Run /api/admin/sync first.");
  await refreshContestLocks(db);
  const report = await settleAndScore(db, competition.id);
  await refreshRoundTiming(db, competition.id);
  return c.json(report);
});

/** Snapshot of what the season currently looks like in our database. */
adminRoutes.get("/status", async (c) => {
  const db = c.get("db");
  const competition = await getActiveCompetition(db, c.env);
  if (!competition) return c.json({ competition: null });

  const roundRows = await db.query.rounds.findMany({
    where: eq(rounds.competitionId, competition.id),
    orderBy: rounds.sequence,
  });

  const summary = [];
  for (const r of roundRows) {
    const cs = await db.query.contests.findMany({ where: eq(contests.roundId, r.id) });
    summary.push({
      code: r.code,
      name: r.name,
      kind: r.kind,
      points: r.pointsPerPick,
      status: r.status,
      contests: cs.length,
      firstKickoffAt: r.firstKickoffAt,
    });
  }

  return c.json({
    competition: {
      season: competition.season,
      displayTz: competition.displayTz,
      firstKickoffAt: competition.firstKickoffAt,
    },
    rounds: summary,
    totalPointsAvailable: summary.reduce((n, r) => n + r.points * r.contests, 0),
  });
});
