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

describe("command table uses only verified real gddy shapes", () => {
  // First three words plus the flag names, in order. Anything else is not a verified real gddy command.
  const ALLOWED = new Set([
    "hosting app list --app-type",
    "hosting app create --app-type --name",
    "hosting app get --app-id",
    "hosting app restart --app-id --variant",
    "hosting operation get --operation-id",
    "hosting source upload --app-id --file",
    "hosting source status --app-id --import-id",
    "hosting secret list --app-id --variant",
    "hosting deployment publish --app-id",
    "hosting domain list --app-id",
    "hosting log list --app-id --variant",
    "hosting subscription get --app-id",
  ]);
  const shape = (argv: string[]) => [...argv.slice(0, 3), ...argv.slice(3).filter((a) => a.startsWith("--"))].join(" ");

  it("every argv matches the allow-list and uses the real operation/import-status argv", async () => {
    const { cmd } = await import("../../src/deploy/commands.js");
    const all = [
      cmd.listApps(), cmd.createApp(), cmd.getApp("a"), cmd.getOperation("o"), cmd.getSubscription("a"),
      cmd.upload("a", "f"), cmd.getImport("a", "i"), cmd.listSecrets("a", "PREVIEW"), cmd.restart("a", "PREVIEW"),
      cmd.logs("a", "PREVIEW"), cmd.publish("a"), cmd.listDomains("a"),
    ];
    expect(Object.keys(cmd)).toHaveLength(all.length);
    for (const c of all) expect(ALLOWED.has(shape(c.argv)), c.argv.join(" ")).toBe(true);
    expect(cmd.getOperation("o").argv).toEqual(["hosting", "operation", "get", "--operation-id", "o"]);
    expect(cmd.getImport("a", "i").argv).toEqual(["hosting", "source", "status", "--app-id", "a", "--import-id", "i"]);
  });
});
