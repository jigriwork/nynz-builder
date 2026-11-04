import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: { environment: "node", include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx", "tests/db/**/*.test.ts", "tests/concurrency/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 60_000 },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, ".") } },
});
