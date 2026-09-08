import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "d1-http",
  schema: "./worker/db/schema.ts",
  out: "./migrations",
  // Must match the `casing` passed to drizzle() in worker/db/index.ts.
  // Without it, columns whose names are inferred from the property (rather
  // than passed explicitly) generate as camelCase here but are queried as
  // snake_case at runtime — the table exists but the column does not.
  casing: "snake_case",
});
