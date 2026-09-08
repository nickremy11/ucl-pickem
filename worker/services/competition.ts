import { eq, desc, and } from "drizzle-orm";
import type { Db } from "../db";
import { competitions, rounds } from "../db/schema";
import { ROUND_DEFS } from "../../shared/domain";
import { inChunks } from "../db/batch";

/**
 * The competition currently being played. There is only ever one active
 * Champions League season, so "latest season for this provider code" is the
 * whole selection rule.
 */
export async function getActiveCompetition(db: Db, env: Env) {
  return (
    (await db.query.competitions.findFirst({
      where: eq(competitions.providerCode, env.COMPETITION_CODE),
      orderBy: desc(competitions.season),
    })) ?? null
  );
}

/**
 * Create the competition and its 13 rounds if they do not exist yet.
 *
 * Rounds are seeded up front — including the knockout rounds whose draws have
 * not happened — so the UI can show the full season shape from day one and
 * ingestion has somewhere to attach fixtures the moment a draw lands.
 * Idempotent: safe to call from any cron tick.
 */
export async function ensureCompetition(db: Db, env: Env, season: string) {
  const existing = await db.query.competitions.findFirst({
    where: and(
      eq(competitions.providerCode, env.COMPETITION_CODE),
      eq(competitions.season, season),
    ),
  });

  const comp =
    existing ??
    (
      await db
        .insert(competitions)
        .values({
          providerCode: env.COMPETITION_CODE,
          season,
          displayTz: env.COMPETITION_TZ,
        })
        .returning()
    )[0];

  // Always reconcile rounds, even for a competition that already exists. D1 has
  // no multi-statement transaction here, so a half-finished bootstrap can leave
  // a competition row with no rounds; short-circuiting on `existing` would make
  // that state permanent.
  await ensureRounds(db, comp.id);
  return comp;
}

/** Insert any round definitions missing for this competition. Idempotent. */
async function ensureRounds(db: Db, competitionId: string) {
  const existing = await db.query.rounds.findMany({
    where: eq(rounds.competitionId, competitionId),
  });
  const have = new Set(existing.map((r) => r.code));
  const missing = ROUND_DEFS.filter((r) => !have.has(r.code));
  if (missing.length === 0) return;

  // Chunked because 13 rounds at this table width exceeds D1's 100-param cap.
  await inChunks(
    missing.map((r) => ({
      competitionId,
      code: r.code,
      name: r.name,
      kind: r.kind,
      pointsPerPick: r.pointsPerPick,
      sequence: r.sequence,
    })),
    rounds,
    (chunk) => db.insert(rounds).values(chunk),
  );
}

export async function getRounds(db: Db, competitionId: string) {
  return db.query.rounds.findMany({
    where: eq(rounds.competitionId, competitionId),
    orderBy: rounds.sequence,
  });
}
