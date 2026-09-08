import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb(env: Env) {
  return drizzle(env.DB, { schema, casing: "snake_case" });
}

export type Db = ReturnType<typeof getDb>;
export { schema };
