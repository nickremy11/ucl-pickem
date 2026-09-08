/**
 * Recognising a unique-constraint violation from D1.
 *
 * Drizzle wraps driver failures in a `DrizzleQueryError` whose own message is
 * only the SQL that failed:
 *
 *   DrizzleQueryError: Failed query: update "users" set "username" = ? ...
 *
 * The text that identifies the constraint sits further down the `cause` chain:
 *
 *   D1_ERROR: UNIQUE constraint failed: index 'users_username_idx'
 *
 * So the obvious `String(err).includes("UNIQUE")` never matches, and what
 * should be a 409 surfaces to the user as "something went wrong on our end".
 * Walk the chain instead.
 */
const MAX_DEPTH = 6;

export function isUniqueViolation(err: unknown, indexName?: string): boolean {
  let current: unknown = err;

  for (let depth = 0; current != null && depth < MAX_DEPTH; depth++) {
    const message = current instanceof Error ? current.message : String(current);

    if (message.includes("UNIQUE constraint failed")) {
      // When several unique indexes exist on one table, the caller needs to
      // know which one fired to write an accurate message.
      return indexName ? message.includes(indexName) : true;
    }

    current = current instanceof Error ? (current as { cause?: unknown }).cause : undefined;
  }

  return false;
}
