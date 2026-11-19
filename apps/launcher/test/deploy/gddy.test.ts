import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Gddy, parseStdoutJson, type ExecFn } from "../../src/deploy/gddy.js";
import { REAL_ROOT } from "./helpers.js";

const scripted = (res: Partial<Awaited<ReturnType<ExecFn>>>, seen: { args?: string[]; opts?: unknown } = {}): ExecFn =>
  async (_file, args, opts) => {
    seen.args = args;
    seen.opts = opts;
    return { stdout: "", failed: false, killed: false, ...res };
  };

describe("parseStdoutJson (stdout only)", () => {
  it("skips notices before the JSON", () => {
    expect(parseStdoutJson('update available [see notes]\n{"data":{"a":1}}\n')).toEqual({ data: { a: 1 } });
  });
  it("throws a coded error when there is no JSON", () => {
    expect(() => parseStdoutJson("just text")).toThrowError(/no JSON/);
  });
});

describe("Gddy wrapper", () => {
  it("passes argv as an array with a timeout, never through a shell", async () => {
    const seen: { args?: string[]; opts?: { timeout: number } } = {};
    const g = new Gddy({ bin: "/fake/gddy", exec: scripted({ stdout: '{"data":{}}' }, seen), log: () => undefined, timeoutMs: 1234 });
    await g.call("hosting app list", ["hosting", "app", "list"]);
    expect(seen.args).toEqual(["hosting", "app", "list"]);
    expect(seen.opts?.timeout).toBe(1234);
  });

  it("maps a kill to GDDY_TIMEOUT and logs the label only", async () => {
    const logs: unknown[] = [];
    const g = new Gddy({ bin: "/fake/gddy", exec: scripted({ killed: true, failed: true }), log: (e) => logs.push(e) });
    await expect(g.call("hosting source upload", ["--file", "/secret/path.zip"])).rejects.toMatchObject({ code: "GDDY_TIMEOUT" });
    expect(JSON.stringify(logs)).not.toContain("/secret/path.zip");
  });

  it("surfaces the error code from stdout JSON, not stderr or argv", async () => {
    const g = new Gddy({ bin: "/fake/gddy", exec: scripted({ stdout: '{"error":{"code":"NOT_FOUND","message":"x"}}', failed: true }), log: () => undefined });
    await expect(g.call("hosting app get", ["--app-id", "SECRET-ID"])).rejects.toSatisfy(
      (e: Error) => (e as { code?: string }).code === "NOT_FOUND" && !e.message.includes("SECRET-ID"),
    );
  });

  it("refuses the real gddy unless a live run is confirmed", () => {
    expect(() => new Gddy({ bin: "gddy" })).toThrowError(/live/);
    expect(() => new Gddy({ bin: "gddy", live: true })).not.toThrow();
  });
});

describe("scripts/deploy.ts live guard", () => {
  const run = (args: string[], env: Record<string, string>): { code: number; stderr: string } => {
    try {
      execFileSync("npx", ["tsx", join(REAL_ROOT, "scripts/deploy.ts"), ...args], {
        cwd: REAL_ROOT,
        env: { ...process.env, PATH: "/nonexistent-so-gddy-cannot-run:/usr/bin:/bin:" + (process.env.PATH ?? ""), ...env },
        stdio: "pipe",
      });
      return { code: 0, stderr: "" };
    } catch (e) {
      const err = e as { status: number; stderr: Buffer };
      return { code: err.status, stderr: err.stderr.toString() };
    }
  };

  it("refuses without --live, and without the env confirmation", () => {
    expect(run([], {}).code).toBe(2);
    expect(run(["--live"], { AGENTDOOR_LIVE_DEPLOY: "" }).code).toBe(2);
    expect(run([], { AGENTDOOR_LIVE_DEPLOY: "I-CONFIRM-LIVE-DEPLOY" }).code).toBe(2);
    expect(run([], {}).stderr).toMatch(/Refusing to deploy/);
  });
});
