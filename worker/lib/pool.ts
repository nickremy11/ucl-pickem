import type { Context } from "hono";
import { eq, and } from "drizzle-orm";
import { pools, poolMembers } from "../db/schema";
import { forbidden, notFound } from "./http";
import type { AppEnv } from "./app";

/**
 * Resolve the pool from the `:slug` route param and assert the caller belongs
 * to it. Every pool-scoped read and write goes through this, so membership is
 * never assumed from the URL alone.
 */
export async function requireMembership(c: Context<AppEnv>) {
  const db = c.get("db");
  const slug = c.req.param("slug");
  if (!slug) notFound("That pool does not exist.");

  const pool = await db.query.pools.findFirst({ where: eq(pools.slug, slug) });
  if (!pool) notFound("That pool does not exist.");

  const member = await db.query.poolMembers.findFirst({
    where: and(eq(poolMembers.poolId, pool.id), eq(poolMembers.userId, c.get("userId"))),
  });
  if (!member) forbidden("You are not a member of this pool.");

  return { db, pool, member };
}
