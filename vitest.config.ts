import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["worker/**/*.test.ts", "shared/**/*.test.ts"],
    environment: "node",
  },
});
