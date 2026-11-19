import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

/** Test port: 4321 is the owner's real launcher, so e2e uses its own (overridable). */
const PORT = Number(process.env.AGENTDOOR_E2E_PORT ?? 4399);
const STORE = process.env.AGENTDOOR_E2E_STORE ?? mkdtempSync(path.join(tmpdir(), "agentdoor-e2e-"));

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "off" },
  webServer: {
    // Fixture mode: replay never calls Claude and needs no key; the deploy is the stub.
    command: "npx tsx apps/launcher/src/server.ts",
    url: `http://127.0.0.1:${PORT}/rules`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      AGENTDOOR_LLM_MODE: "replay",
      AGENTDOOR_LAUNCHER_PORT: String(PORT),
      AGENTDOOR_STORE_DIR: STORE,
      AGENTDOOR_STUB_STEP_MS: "150",
    },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
