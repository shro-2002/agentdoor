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
    ],
  },
});
