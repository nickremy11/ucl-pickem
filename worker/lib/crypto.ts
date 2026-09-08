/**
 * Password + token hashing on the Workers runtime (WebCrypto only).
 *
 * Iterations are set to OWASP's current recommendation for PBKDF2-HMAC-SHA256.
 * This costs ~400-500ms of CPU per verification, which is fine on Workers Paid
 * (30s budget, and password login is not a hot path since magic link is the
 * primary flow) but would blow the Free plan's 10ms budget.
 *
 * Magic links need none of this: link tokens are 160-bit random values, so a
 * single fast SHA-256 is the correct hash for them — there is nothing to
 * brute-force — and it costs microseconds.
 *
 * Because a KDF is inherently a CPU-burn vector, every endpoint that calls
 * `verifyPassword` must sit behind the rate limiter in `ratelimit.ts`.
 */

const PBKDF2_ITERATIONS = 600_000;
const SCHEME = "pbkdf2-sha256";

const enc = new TextEncoder();

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveBits(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
      key,
      256,
    ),
  );
}

/** Compare without leaking length or content through timing. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveBits(password, salt, PBKDF2_ITERATIONS);
  return `${SCHEME}$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== SCHEME) return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 1_000_000) return false;
  const bits = await deriveBits(password, fromB64(parts[2]), iterations);
  return timingSafeEqual(bits, fromB64(parts[3]));
}

/** 160 bits of entropy, base64url. Used for magic links and reset tokens. */
export function newSecretToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Tokens are stored only as this hash, so a DB leak yields no usable links. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
