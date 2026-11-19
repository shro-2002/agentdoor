import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDemoWorld } from "./demo-world.js";
import { startShop, type RunningShop } from "./shop.js";

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
  process.env.SHOP_URL = shop.baseUrl;
  process.env.SHOP_NOSESSION_URL = bare.baseUrl;
  process.env.SHOP_BUNDLE_DIR = world.bundleDir;
  return async () => {
    await shop.close();
    await bare.close();
    rmSync(world.dir, { recursive: true, force: true });
    rmSync(emptyBundle, { recursive: true, force: true });
  };
}
