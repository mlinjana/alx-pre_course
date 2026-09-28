import { defineConfig } from "vitest/config";

// Runs against a real Supabase. See tests/integration/phase1.test.ts.
export default defineConfig({
  test: { include: ["tests/integration/**/*.test.ts"], environment: "node", testTimeout: 30_000, fileParallelism: false },
});
