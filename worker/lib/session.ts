import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { newSecretToken, hashToken } from "./crypto";
import { DAY } from "./time";

export const SESSION_COOKIE = "ucl_session";
const SESSION_TTL_SEC = 30 * 24 * 60 * 60; // 30 days, sliding
const REFRESH_AFTER_MS = 7 * DAY;

interface SessionRecord {
  userId: string;
  createdAt: number;
  refreshedAt: number;
}

/**
 * These helpers only touch `c.env`, cookies and `executionCtx`, so they are
 * generic over the app's Variables rather than pinned to one Hono env — a
 * concrete `Context<AppEnv>` is not assignable to `Context<{Bindings: Env}>`.
 */
type SessionCtx = { Bindings: Env; Variables: any };

/**
 * Opaque session tokens in KV rather than a signed JWT: sessions must be
 * revocable server-side (sign-out everywhere, removing a member), and a JWT
 * cannot be withdrawn before it expires.
 *
 * KV stores only the hash of the token, so read access to the namespace does
 * not hand over usable sessions.
 */
export async function createSession<E extends SessionCtx>(c: Context<E>, userId: string) {
  const token = newSecretToken();
  const record: SessionRecord = {
    userId,
    createdAt: Date.now(),
    refreshedAt: Date.now(),
  };

  await c.env.SESSIONS.put(`sess:${await hashToken(token)}`, JSON.stringify(record), {
    expirationTtl: SESSION_TTL_SEC,
  });

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });

  return token;
}

export async function readSession<E extends SessionCtx>(
  c: Context<E>,
): Promise<{ userId: string } | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;

  const kvKey = `sess:${await hashToken(token)}`;
  const raw = await c.env.SESSIONS.get(kvKey);
  if (!raw) return null;

  const record = JSON.parse(raw) as SessionRecord;

  // Slide the window, but only occasionally — rewriting KV on every request
  // would be a needless write per page load.
  if (Date.now() - record.refreshedAt > REFRESH_AFTER_MS) {
    record.refreshedAt = Date.now();
    c.executionCtx.waitUntil(
      c.env.SESSIONS.put(kvKey, JSON.stringify(record), { expirationTtl: SESSION_TTL_SEC }),
    );
  }

  return { userId: record.userId };
}

export async function destroySession<E extends SessionCtx>(c: Context<E>) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.SESSIONS.delete(`sess:${await hashToken(token)}`);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}
