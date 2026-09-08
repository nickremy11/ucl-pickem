import { and, eq, lte, gt, ne, sql } from "drizzle-orm";
import { getDb, type Db } from "../db";
import { contests, fixtures } from "../db/schema";
import { getActiveCompetition } from "./competition";
import { syncFromProvider, refreshRoundTiming } from "./ingest";
import { settleAndScore } from "./scoring";
import { isWeekdayHour, isHour, MONDAY, HOUR } from "../lib/time";

/**
 * Two cron triggers drive everything.
 *
 * `*­/5 * * * *` — the tick: keep contest lock states honest, and poll results
 * while matches are actually being played.
 *
 * `0 * * * *` — hourly: fires every hour but acts only when the wall clock in
 * the competition timezone matches, so schedules stay put across DST.
 */
export async function runScheduled(env: Env, cron: string): Promise<void> {
  const db = getDb(env);

  if (cron === "0 * * * *") {
    await runHourly(db, env);
    return;
  }
  await runTick(db, env);
}

/** How long after kickoff we keep polling a match for its result. */
const MATCH_WINDOW_MS = 3.5 * HOUR;

async function runTick(db: Db, env: Env) {
  await refreshContestLocks(db);

  const competition = await getActiveCompetition(db, env);
  if (!competition) return;

  // Only spend a provider request when something is plausibly in play.
  if (!(await inMatchWindow(db))) return;

  await syncFromProvider(db, env);
  await settleAndScore(db, competition.id);
  await refreshRoundTiming(db, competition.id);
}

async function runHourly(db: Db, env: Env) {
  const now = new Date();
  const tz = env.COMPETITION_TZ;

  // Daily schedule reconciliation: picks up knockout draws, kickoff changes and
  // postponements without burning provider quota all day.
  if (isHour(now, tz, 6)) {
    const competition = await getActiveCompetition(db, env);
    await syncFromProvider(db, env);
    if (competition) {
      await settleAndScore(db, competition.id);
      await refreshRoundTiming(db, competition.id);
    }
  }

  // Monday 08:00 in the competition timezone — the betting-line freeze for the
  // coming week. Checked against the wall clock rather than a fixed UTC hour so
  // it does not drift an hour when the US changes clocks.
  if (isWeekdayHour(now, tz, MONDAY, 8)) {
    await lockWeeklyOdds(db, env);
  }
}

/**
 * Keep `contests.status` consistent with the clock.
 *
 * Purely cosmetic: pick submission is rejected by comparing against
 * `locks_at` on every write, so a missed tick can never let a late pick
 * through. This just keeps list queries cheap and the UI honest.
 */
export async function refreshContestLocks(db: Db) {
  const now = new Date();

  await db
    .update(contests)
    .set({ status: "locked" })
    .where(and(lte(contests.locksAt, now), eq(contests.status, "open")));

  await db
    .update(contests)
    .set({ status: "locked" })
    .where(and(lte(contests.locksAt, now), eq(contests.status, "scheduled")));

  await db
    .update(contests)
    .set({ status: "open" })
    .where(and(gt(contests.locksAt, now), eq(contests.status, "scheduled")));
}

/** True when any fixture kicked off recently enough to still be running. */
async function inMatchWindow(db: Db): Promise<boolean> {
  const now = Date.now();
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(fixtures)
    .where(
      and(
        lte(fixtures.kickoffAt, new Date(now)),
        gt(fixtures.kickoffAt, new Date(now - MATCH_WINDOW_MS)),
        ne(fixtures.status, "finished"),
      ),
    );
  return (rows[0]?.n ?? 0) > 0;
}

/**
 * Placeholder for the Monday odds freeze. Implemented alongside the Odds API
 * client; simple-mode pools cannot accept picks for a round until this has run,
 * which is enforced in the picks route rather than here.
 */
async function lockWeeklyOdds(_db: Db, env: Env): Promise<void> {
  if (!env.ODDS_API_KEY) return;
  // TODO: snapshot spreads for the coming week and mark them locked.
}
