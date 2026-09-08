import { tooManyRequests } from "./http";

/**
 * Fixed-window counter in KV.
 *
 * Deliberately simple: the goal is to blunt credential stuffing and stop
 * PBKDF2 verification from becoming a CPU-burn vector, not to be a precise
 * quota system. A fixed window can allow up to 2x `limit` across a boundary;
 * that is acceptable here and far cheaper than a sliding log.
 */
export interface RateLimitRule {
  /** Max attempts allowed inside the window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
}

export const RATE_LIMITS = {
  /** Requesting a magic link — per email address. */
  magicLinkPerEmail: { limit: 5, windowSec: 15 * 60 },
  /** Requesting a magic link — per IP, to stop mass enumeration. */
  magicLinkPerIp: { limit: 20, windowSec: 15 * 60 },
  /** Password login attempts — per email. Gates the expensive KDF. */
  passwordPerEmail: { limit: 10, windowSec: 15 * 60 },
  /** Password login attempts — per IP. */
  passwordPerIp: { limit: 30, windowSec: 15 * 60 },
  /** Pool join attempts — per user, per pool. */
  poolJoin: { limit: 10, windowSec: 10 * 60 },
} as const satisfies Record<string, RateLimitRule>;

export async function consume(
  env: Env,
  bucket: string,
  key: string,
  rule: RateLimitRule,
): Promise<void> {
  const window = Math.floor(Date.now() / 1000 / rule.windowSec);
  const kvKey = `rl:${bucket}:${key}:${window}`;

  const current = Number((await env.SESSIONS.get(kvKey)) ?? 0);
  if (current >= rule.limit) tooManyRequests();

  // Not atomic — KV has no increment. A determined attacker racing many
  // concurrent requests can overshoot slightly, which is tolerable for this
  // purpose. TTL is padded so the key outlives its window.
  await env.SESSIONS.put(kvKey, String(current + 1), {
    expirationTtl: rule.windowSec + 60,
  });
}

/** Best-effort client IP from Cloudflare's header. */
export function clientIp(req: Request): string {
  return req.headers.get("CF-Connecting-IP") ?? "unknown";
}
