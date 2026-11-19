import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDemoWorld } from "./demo-world.js";
import { loadWorkspaceConfig } from "../../apps/shop/src/workspace/config.js";
import { startFakeClaude } from "./fake-claude-server.js";
import { startShop, type RunningShop } from "./shop.js";

/** The access code of the e2e workspace shop (a throwaway value). */
export const WS_CODE = "e2e-workspace-code";
/** Long enough for a screenshot of the working state, short enough to keep the run quick. */
const FAKE_CLAUDE_DELAY_MS = 1500;

/**
 * One in-process shop for the whole run, built from a fixture-mode launch (recorded Claude fixtures,
 * no key). The URLs are handed to the specs through env; the second shop has no session file, to
 * show the "Replay unavailable" state. Both are closed in teardown: nothing is left running.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const world = await buildDemoWorld();
  const shop = await startShop(world);
  // A bundle with the same signed policy but no try/session.json.
  const emptyBundle = mkdtempSync(path.join(tmpdir(), "agentdoor-shop-nosession-"));
  for (const f of ["policy.json", "launch-record.json"]) cpSync(path.join(world.bundleDir, f), path.join(emptyBundle, f));
  const bare: RunningShop = await startShop(world, { bundleDir: emptyBundle });
  // The workspace shop talks to a local stand-in for Claude through the real SDK (no key, no network).
  const claude = await startFakeClaude(FAKE_CLAUDE_DELAY_MS);
  process.env.ANTHROPIC_BASE_URL = claude.baseUrl;
  const workspace = loadWorkspaceConfig({ WORKSPACE_ACCESS_CODE: WS_CODE, ANTHROPIC_API_KEY: "e2e-not-a-real-key", WORKSPACE_BUDGET_USD: "10" });
  const ws: RunningShop = await startShop(world, { workspace });
  process.env.SHOP_WS_URL = ws.baseUrl;
  process.env.SHOP_WS_CODE = WS_CODE;
  process.env.SHOP_URL = shop.baseUrl;
  process.env.SHOP_NOSESSION_URL = bare.baseUrl;
  process.env.SHOP_BUNDLE_DIR = world.bundleDir;
  return async () => {
    await shop.close();
    await bare.close();
    await ws.close();
    await claude.close();
    rmSync(world.dir, { recursive: true, force: true });
    rmSync(emptyBundle, { recursive: true, force: true });
  };
}
