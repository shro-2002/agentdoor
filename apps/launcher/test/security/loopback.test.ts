import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LAUNCHER_HOST, startLauncher } from "../../src/server.js";

const store = mkdtempSync(join(tmpdir(), "agentdoor-sec14-"));
afterAll(() => rmSync(store, { recursive: true, force: true }));

describe("SEC-14 the launcher is reachable on loopback only", () => {
  it("binds 127.0.0.1, never 0.0.0.0 or ::", async () => {
    expect(LAUNCHER_HOST).toBe("127.0.0.1");
    const server = await startLauncher({ port: 0, storeRoot: store });
    try {
      expect((server.address() as AddressInfo).address).toBe("127.0.0.1");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
