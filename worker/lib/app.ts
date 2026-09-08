import type { Context, MiddlewareHandler } from "hono";
import { getDb, type Db } from "../db";
import { readSession } from "./session";
import { unauthorized } from "./http";

export interface AppEnv {
  Bindings: Env;
  Variables: {
    db: Db;
    /** Present only after `requireAuth`. */
    userId: string;
  };
}

export type Ctx = Context<AppEnv>;

/** Attach a Drizzle client once per request rather than per handler. */
export const withDb: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("db", getDb(c.env));
  await next();
};

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await readSession(c);
  if (!session) unauthorized();
  c.set("userId", session.userId);
  await next();
};
