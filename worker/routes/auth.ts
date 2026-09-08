import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { users, authTokens } from "../db/schema";
import { type AppEnv, requireAuth } from "../lib/app";
import { createSession, destroySession, readSession } from "../lib/session";
import {
  hashPassword,
  verifyPassword,
  newSecretToken,
  hashToken,
} from "../lib/crypto";
import { consume, RATE_LIMITS, clientIp } from "../lib/ratelimit";
import { badRequest, conflict, unauthorized, GENERIC_AUTH_ERROR } from "../lib/http";
import { sendEmail, magicLinkEmail, passwordResetEmail } from "../services/mail";
import { safeRedirect } from "../lib/redirect";
import { isUniqueViolation } from "../db/errors";
import { MINUTE } from "../lib/time";

const TOKEN_TTL_MS = 15 * MINUTE;

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(10).max(200);
const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .regex(/^[a-zA-Z0-9_-]+$/, "Letters, numbers, underscore and hyphen only");

export const authRoutes = new Hono<AppEnv>();

/** Consistent response so callers cannot tell which emails have accounts. */
const OK = { ok: true } as const;

async function issueToken(
  db: AppEnv["Variables"]["db"],
  userId: string,
  kind: "magic_link" | "password_reset",
  ip: string,
  redirectTo: string | null = null,
) {
  const token = newSecretToken();
  await db.insert(authTokens).values({
    userId,
    kind,
    tokenHash: await hashToken(token),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    requestIp: ip,
    redirectTo,
  });
  return token;
}

// ------------------------------------------------------------- magic link

authRoutes.post("/magic-link", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = z
    .object({ email: emailSchema, next: z.string().optional() })
    .safeParse(body);
  if (!parsed.success) badRequest("Enter a valid email address.");
  const { email } = parsed.data;

  // Anything that fails validation is dropped rather than rejected: a bad
  // `next` should not stop someone signing in.
  const redirectTo = safeRedirect(parsed.data.next);

  const ip = clientIp(c.req.raw);
  await consume(c.env, "magic-ip", ip, RATE_LIMITS.magicLinkPerIp);
  await consume(c.env, "magic-email", email, RATE_LIMITS.magicLinkPerEmail);

  const db = c.get("db");
  let user = await db.query.users.findFirst({ where: eq(sql`lower(${users.email})`, email) });

  // Requesting a link for an unknown address signs you up. The row is created
  // here (unverified) so the token has something to reference; it becomes a
  // real account only once the link is clicked.
  const isNew = !user;
  if (!user) {
    const [created] = await db.insert(users).values({ email }).returning();
    user = created;
  }

  const token = await issueToken(db, user.id, "magic_link", ip, redirectTo);
  const url = `${c.env.APP_URL}/api/auth/callback?token=${encodeURIComponent(token)}`;

  await sendEmail(c.env, { to: email, ...magicLinkEmail(url, isNew) });
  return c.json(OK);
});

authRoutes.get("/callback", async (c) => {
  const token = c.req.query("token");
  const fail = (reason: string) => c.redirect(`/login?error=${reason}`, 302);
  if (!token) return fail("missing");

  const db = c.get("db");
  const row = await db.query.authTokens.findFirst({
    where: eq(authTokens.tokenHash, await hashToken(token)),
  });

  if (!row || row.kind !== "magic_link") return fail("invalid");
  if (row.consumedAt) return fail("used");
  if (row.expiresAt.getTime() < Date.now()) return fail("expired");

  // Single-use: burn the token before establishing the session, so a replayed
  // link cannot mint a second session even under concurrent requests.
  await db
    .update(authTokens)
    .set({ consumedAt: new Date() })
    .where(eq(authTokens.id, row.id));

  await db
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(users.id, row.userId));

  await createSession(c, row.userId);
  // Re-validate on the way out: the column is only ever written through
  // safeRedirect, but this is the point where the value becomes a Location
  // header, so it is the point worth being certain.
  return c.redirect(safeRedirect(row.redirectTo) ?? "/", 302);
});

// --------------------------------------------------------------- password

authRoutes.post("/password/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = z
    .object({ email: emailSchema, password: z.string().max(200) })
    .safeParse(body);
  if (!parsed.success) badRequest(GENERIC_AUTH_ERROR);
  const { email, password } = parsed.data;

  const ip = clientIp(c.req.raw);
  await consume(c.env, "pw-ip", ip, RATE_LIMITS.passwordPerIp);
  await consume(c.env, "pw-email", email, RATE_LIMITS.passwordPerEmail);

  const db = c.get("db");
  const user = await db.query.users.findFirst({
    where: eq(sql`lower(${users.email})`, email),
  });

  // Only run the KDF when there is a hash to check. The rate limiter above is
  // what keeps this from being an oracle for which accounts have passwords.
  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    unauthorized(GENERIC_AUTH_ERROR);
  }

  await createSession(c, user.id);
  return c.json(OK);
});

authRoutes.post("/password/forgot", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({ email: emailSchema }).safeParse(body);
  if (!parsed.success) badRequest("Enter a valid email address.");
  const { email } = parsed.data;

  const ip = clientIp(c.req.raw);
  await consume(c.env, "magic-ip", ip, RATE_LIMITS.magicLinkPerIp);
  await consume(c.env, "magic-email", email, RATE_LIMITS.magicLinkPerEmail);

  const db = c.get("db");
  const user = await db.query.users.findFirst({
    where: eq(sql`lower(${users.email})`, email),
  });

  // Unknown address: return the same shape without sending anything.
  if (user) {
    const token = await issueToken(db, user.id, "password_reset", ip);
    const url = `${c.env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
    await sendEmail(c.env, { to: email, ...passwordResetEmail(url) });
  }

  return c.json(OK);
});

authRoutes.post("/password/reset", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = z
    .object({ token: z.string().min(1), password: passwordSchema })
    .safeParse(body);
  if (!parsed.success) badRequest("Password must be at least 10 characters.");
  const { token, password } = parsed.data;

  const db = c.get("db");
  const row = await db.query.authTokens.findFirst({
    where: eq(authTokens.tokenHash, await hashToken(token)),
  });

  if (!row || row.kind !== "password_reset" || row.consumedAt) {
    badRequest("That reset link is no longer valid. Request a new one.");
  }
  if (row.expiresAt.getTime() < Date.now()) {
    badRequest("That reset link has expired. Request a new one.");
  }

  await db.update(authTokens).set({ consumedAt: new Date() }).where(eq(authTokens.id, row.id));
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), emailVerifiedAt: new Date() })
    .where(eq(users.id, row.userId));

  await createSession(c, row.userId);
  return c.json(OK);
});

// ---------------------------------------------------------------- session

authRoutes.get("/me", async (c) => {
  const session = await readSession(c);
  if (!session) return c.json({ user: null });

  const user = await c
    .get("db")
    .query.users.findFirst({ where: eq(users.id, session.userId) });
  if (!user) return c.json({ user: null });

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      timezone: user.timezone,
      hasPassword: Boolean(user.passwordHash),
      notifPrefs: user.notifPrefs,
    },
  });
});

authRoutes.post("/logout", async (c) => {
  await destroySession(c);
  return c.json(OK);
});

authRoutes.patch("/profile", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = z
    .object({
      username: usernameSchema.nullish(),
      timezone: z.string().max(64).optional(),
      password: passwordSchema.optional(),
      notifPrefs: z.object({ reminders: z.boolean(), digests: z.boolean() }).optional(),
    })
    .safeParse(body);
  if (!parsed.success) badRequest(parsed.error.issues[0]?.message ?? "Invalid profile update.");

  const { username, timezone, password, notifPrefs } = parsed.data;
  const db = c.get("db");
  const userId = c.get("userId");

  const update: Partial<typeof users.$inferInsert> = {};
  if (username !== undefined) update.username = username;
  if (timezone !== undefined) update.timezone = timezone;
  if (notifPrefs !== undefined) update.notifPrefs = notifPrefs;
  if (password !== undefined) update.passwordHash = await hashPassword(password);

  if (Object.keys(update).length === 0) return c.json(OK);

  try {
    await db.update(users).set(update).where(eq(users.id, userId));
  } catch (err) {
    // The only unique constraint reachable here is the username index. Note
    // it is on lower(username), so casing does not make a name available.
    if (isUniqueViolation(err, "users_username_idx")) {
      conflict("That username is already taken.");
    }
    throw err;
  }

  return c.json(OK);
});
