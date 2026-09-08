import { describe, it, expect } from "vitest";
import { isUniqueViolation } from "./errors";

/** Shape Drizzle actually produces over D1, reproduced from a real failure. */
function drizzleUniqueError(indexName: string): Error {
  const sqlite = new Error(
    `UNIQUE constraint failed: index '${indexName}': SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)`,
  );
  const d1 = new Error(
    `D1_ERROR: UNIQUE constraint failed: index '${indexName}': SQLITE_CONSTRAINT`,
    { cause: sqlite },
  );
  // The outermost message is only the SQL — this is the whole trap.
  return new Error(
    `Failed query: update "users" set "username" = ? where "users"."id" = ?`,
    { cause: d1 },
  );
}

describe("isUniqueViolation", () => {
  it("sees through Drizzle's wrapper to the constraint", () => {
    expect(isUniqueViolation(drizzleUniqueError("users_username_idx"))).toBe(true);
  });

  it("does not match on the outermost message alone", () => {
    // Guards the original bug: the wrapper says nothing about UNIQUE.
    const outerOnly = drizzleUniqueError("users_username_idx");
    expect(outerOnly.message).not.toContain("UNIQUE");
    expect(isUniqueViolation(outerOnly)).toBe(true);
  });

  it("distinguishes between indexes when asked", () => {
    const err = drizzleUniqueError("pools_name_idx");
    expect(isUniqueViolation(err, "pools_name_idx")).toBe(true);
    expect(isUniqueViolation(err, "pools_slug_idx")).toBe(false);
  });

  it("ignores unrelated failures", () => {
    expect(isUniqueViolation(new Error("NOT NULL constraint failed: users.email"))).toBe(false);
    expect(isUniqueViolation(new Error("D1_ERROR: no such table: pools"))).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("a string")).toBe(false);
  });

  it("terminates on a cyclic cause chain", () => {
    const a = new Error("outer");
    const b = new Error("inner", { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(isUniqueViolation(a)).toBe(false);
  });
});
