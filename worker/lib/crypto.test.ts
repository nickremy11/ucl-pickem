import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  hashToken,
  newSecretToken,
  timingSafeEqual,
  MAX_PBKDF2_ITERATIONS,
} from "./crypto";

describe("password hashing", () => {
  /**
   * The regression that motivated this file: 600k iterations passed every
   * local test and then threw `NotSupportedError` in production, because the
   * Workers runtime caps PBKDF2 at 100k and the local runtime does not enforce
   * it. Node cannot reproduce the cap either — so assert the embedded work
   * factor directly.
   */
  it("never exceeds the Workers PBKDF2 ceiling", async () => {
    const stored = await hashPassword("correct horse battery staple");
    const iterations = Number(stored.split("$")[1]);

    expect(iterations).toBeLessThanOrEqual(MAX_PBKDF2_ITERATIONS);
    expect(MAX_PBKDF2_ITERATIONS).toBe(100_000);
    // Guard the other direction too: a typo dropping a zero must fail loudly.
    expect(iterations).toBeGreaterThanOrEqual(100_000);
  });

  it("round-trips a correct password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("Correct horse battery staple", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("salts, so identical passwords hash differently", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  it("refuses a stored hash the runtime could not recompute", async () => {
    // Above the cap: must return false rather than throwing out of the handler.
    const stored = `pbkdf2-sha256$600000$c2FsdA==$aGFzaA==`;
    await expect(verifyPassword("anything", stored)).resolves.toBe(false);
  });

  it("refuses malformed or unknown-scheme hashes", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$10$salt$hash")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2-sha256$abc$salt$hash")).toBe(false);
  });
});

describe("tokens", () => {
  it("hashes deterministically and irreversibly", async () => {
    const token = newSecretToken();
    expect(await hashToken(token)).toBe(await hashToken(token));
    expect(await hashToken(token)).not.toBe(token);
    expect(await hashToken(token)).toHaveLength(64); // SHA-256 hex
  });

  it("produces unique, URL-safe tokens", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newSecretToken()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("timingSafeEqual", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  it("compares content, not identity", () => {
    expect(timingSafeEqual(bytes("abc"), bytes("abc"))).toBe(true);
    expect(timingSafeEqual(bytes("abc"), bytes("abd"))).toBe(false);
    expect(timingSafeEqual(bytes("abc"), bytes("abcd"))).toBe(false);
    expect(timingSafeEqual(bytes(""), bytes(""))).toBe(true);
  });
});
