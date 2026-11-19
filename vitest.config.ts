import { defineConfig } from "vitest/config";

// Vitest 5 replaced `vitest.workspace.ts` with `test.projects`.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "core",
          root: "packages/core",
          include: ["test/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "launcher",
          root: "apps/launcher",
          include: ["test/**/*.test.ts"],
          environment: "node",
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: "shop",
          root: "apps/shop",
          include: ["test/**/*.test.ts"],
          environment: "node",
          // Integration tests share one MySQL schema, so files must not overlap.
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
