import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDemoWorld, type DemoWorld } from "../../../e2e/support/demo-world.js";
import { runLive } from "../src/services/try-live.js";
import { sessionLoader, type TrySession } from "../src/services/try-session.js";
import { startShop } from "./integration/http-helpers.js";

const MINUTE_MS = 60_000;

let world: DemoWorld;
let session: TrySession;
beforeAll(async () => {
  world = await buildDemoWorld();
  const loaded = sessionLoader(world.bundleDir)();
  if (!loaded.ok) throw new Error("demo session did not load");
  session = loaded.session;
});
afterAll(() => rmSync(world.dir, { recursive: true, force: true }));

describe("runLive memoisation", () => {
  it("reuses one run inside a minute and recomputes in a later minute", () => {
    const t0 = 1_800_000_000_000;
    const first = runLive(session, 1, t0);
    expect(runLive(session, 1, t0 + MINUTE_MS / 2 - 1)).toBe(first);
    expect(runLive(session, 1, t0 + 2 * MINUTE_MS)).not.toBe(first);
  });
});

describe("/launch-report rate limit", () => {
  it("shares the /try bucket: the 61st request in a minute is refused", async () => {
    const shop = await startShop();
    try {
      let last = 0;
      for (let i = 0; i < 61; i += 1) {
        last = (await fetch(`${shop.base}/launch-report`, { headers: { "x-forwarded-for": "198.51.100.77" } })).status;
      }
      expect(last).toBe(429);
    } finally {
      await shop.close();
    }
  });
});
