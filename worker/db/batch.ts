import { getTableColumns } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

/**
 * D1 allows at most 100 bound parameters per query — a much tighter ceiling
 * than SQLite's own 999, and the one that actually bites on multi-row inserts.
 * A 13-row insert into an 8-column table is already over it.
 *
 * Bulk writes must therefore be chunked by *parameter count*, not row count.
 * Hand-counting the columns is a trap: generated ids and defaulted columns are
 * bound too, so the real width is always larger than the object literal
 * suggests. Deriving the width from the table definition removes that guesswork
 * and stays correct when columns are added.
 */
export const D1_MAX_PARAMS = 90; // headroom under the hard limit of 100

/** Max rows per INSERT for this table, based on its full column count. */
export function rowsPerStatement(table: SQLiteTable): number {
  const columns = Object.keys(getTableColumns(table)).length;
  return Math.max(1, Math.floor(D1_MAX_PARAMS / Math.max(1, columns)));
}

/**
 * Run `fn` over parameter-safe chunks of `items`, in order.
 *
 * Chunk size is derived from `table`'s column count, which over-estimates when
 * some columns are omitted (those become SQL literals, not parameters). That
 * error is in the safe direction: smaller chunks, never an oversized query.
 */
export async function inChunks<T>(
  items: T[],
  table: SQLiteTable,
  fn: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  const size = rowsPerStatement(table);
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    if (chunk.length > 0) await fn(chunk);
  }
}
