import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { deploy, type DeployOptions } from "../../src/deploy/deploy.js";
import { DeployError } from "../../src/deploy/errors.js";
import { Gddy } from "../../src/deploy/gddy.js";
import type { DeployLog } from "../../src/deploy/log.js";
import { NOW_MS, SECRET_RECIPIENT, calls, fakeFetch, makeBundle, makeEnv, type Env } from "./helpers.js";

let env: Env;
let logs: Record<string, unknown>[];
const log: DeployLog = (e) => logs.push(e);

const opts = (extra: Partial<DeployOptions> = {}): DeployOptions => ({
  repoRoot: env.root,
  gddy: new Gddy({ bin: env.fakeBin, log }),
  gddyBin: env.fakeBin,
  bundleDir: env.bundleDir,
  domain: "shop.test",
  recipientEmail: SECRET_RECIPIENT,
  fetchFn: fakeFetch(env),
  sleep: async () => undefined,
  nowMs: () => NOW_MS,
  log,
  lockfile: async (dir) => writeFileSync(join(dir, "package-lock.json"), '{"lockfileVersion":3}'),
  ...extra,
});

beforeEach(() => {
  env = makeEnv();
  logs = [];
});

describe("I-DEP-1 happy path with a fake gddy", () => {
  it("creates the app once, then runs every step in order", async () => {
    const res = await deploy(opts());
    expect(res.policyHash).toBe(env.hash);
    expect(res.baseUrl).toBe("https://shop.test");
    const order = calls(env).filter((c) => !c.startsWith("hosting log") && !c.startsWith("hosting operation") && !c.startsWith("hosting source status"));
    const want = [
      "hosting app list",
      "hosting app create",
      "hosting subscription get",
      "hosting source upload",
      "hosting secret list",
      "api call -X",
      "hosting app restart",
      "hosting secret list",
      "api call -X",
      "hosting deployment publish",
      "hosting domain list",
    ];
    expect(order).toEqual(want);
    expect(env.readState().created).toBe(1);
    expect(JSON.parse(readFileSync(join(env.root, ".agentdoor/deploy.json"), "utf8"))).toEqual({ appId: "APP-NEW", name: "agentdoor-shop" });
    expect(logs.filter((l) => l.event === "step").map((l) => l.step)).toEqual([
      "pack", "app", "subscription", "upload", "secrets-preview", "preview", "secrets-publish", "publish", "domain", "smoke",
    ]);
  });

  it("persists only appId", async () => {
    await deploy(opts());
    const state = JSON.parse(readFileSync(join(env.root, ".agentdoor/deploy.json"), "utf8")) as Record<string, unknown>;
    expect(Object.keys(state).sort()).toEqual(["appId", "name"]);
  });

  it("shows owner tokens once and stores only their hashes", async () => {
    const res = await deploy(opts());
    const token = res.ownerTokens.PUBLISH as string;
    expect(token).toBeTruthy();
    const file = JSON.parse(readFileSync(join(env.root, ".agentdoor/secrets/publish.json"), "utf8")) as Record<string, string>;
    expect(JSON.stringify(file)).not.toContain(token);
    expect(file.OWNER_TOKEN_HASH).toMatch(/^[0-9a-f]{64}$/);
    const again = await deploy(opts());
    expect(again.ownerTokens).toEqual({});
  });
});

describe("I-DEP-2 resume after a failure", () => {
  it("failure at publish: rerun skips completed steps and creates no second app", async () => {
    env.writeState({ failOnce: ["hosting deployment publish"] });
    await expect(deploy(opts())).rejects.toMatchObject({ code: "INJECTED_FAILURE" });
    expect(env.readState().created).toBe(1);
    const before = env.readState().calls.length;
    const res = await deploy(opts());
    const second = env.readState().calls.slice(before).map((c) => c.slice(0, 3).join(" "));
    expect(second).not.toContain("hosting app create");
    expect(second).toContain("hosting source upload"); // no import list exists: a rerun uploads again
    expect(second).not.toContain("api call -X");
    expect(second).toContain("hosting deployment publish");
    expect(res.steps.upload).toBe("done");
    expect(res.steps["secrets-preview"]).toBe("skipped");
    expect(res.steps["secrets-publish"]).toBe("skipped");
    expect(res.steps.app).toBe("skipped");
    expect(env.readState().created).toBe(1);
  });

  it("a fully deployed shop is a no-op rerun (no publish, secrets or create)", async () => {
    await deploy(opts());
    const before = env.readState().calls.length;
    const res = await deploy(opts());
    const second = env.readState().calls.slice(before).map((c) => c.slice(0, 3).join(" "));
    expect(second.filter((c) => /publish|api call|create/.test(c))).toEqual([]);
    expect(res.steps.publish).toBe("skipped");
  });

  it("failure at upload resumes at upload", async () => {
    env.writeState({ failOnce: ["hosting source upload"] });
    await expect(deploy(opts())).rejects.toBeInstanceOf(DeployError);
    const res = await deploy(opts());
    expect(res.steps.upload).toBe("done");
    expect(env.readState().created).toBe(1);
  });
});

describe("one app only (I-DEP-8 first half)", () => {
  it("never creates when deploy.json exists, even if gddy cannot find the app", async () => {
    writeFileSync(join(env.root, ".agentdoor/deploy.json"), JSON.stringify({ appId: "GONE", name: "agentdoor-shop" }));
    await expect(deploy(opts())).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(calls(env)).not.toContain("hosting app create");
  });

  it("adopts an existing agentdoor-shop app instead of creating", async () => {
    env.writeState({ apps: [{ id: "APP-OLD", name: "agentdoor-shop" }] });
    const res = await deploy(opts());
    expect(res.appId).toBe("APP-OLD");
    expect(env.readState().created).toBe(0);
    expect(calls(env)).not.toContain("hosting app create");
    expect(JSON.parse(readFileSync(join(env.root, ".agentdoor/deploy.json"), "utf8")).appId).toBe("APP-OLD");
  });

  it("does not attach a subscription or a domain by itself", async () => {
    env.writeState({ subscription: false });
    await expect(deploy(opts())).rejects.toMatchObject({ code: "SUBSCRIPTION_NOT_ATTACHED" });
    env.writeState({ subscription: true, domains: [] });
    await expect(deploy(opts())).rejects.toMatchObject({ code: "DOMAIN_NOT_ACTIVE" });
    expect(calls(env).some((c) => c.includes("attach"))).toBe(false);
  });
});

describe("U-GATE-3 gate re-check from disk", () => {
  it("a tampered policy is refused with 409 GATE_BLOCKED before any gddy call", async () => {
    makeBundle(env.bundleDir, env.keys, (p) => {
      ((p.catalog as { unitPricePaise: number }[])[0] as { unitPricePaise: number }).unitPricePaise = 1;
    });
    const err = await deploy(opts()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "GATE_BLOCKED", status: 409 });
    expect(env.readState().calls).toEqual([]);
    expect(existsSync(join(env.root, "out"))).toBe(false);
  });

  it("a missing or foreign-signed launch record is refused", async () => {
    const forger = (await import("@agentdoor/core")).generateKeyPair();
    makeBundle(env.bundleDir, forger);
    await expect(deploy(opts())).rejects.toMatchObject({ code: "GATE_BLOCKED", status: 409 });
    writeFileSync(join(env.bundleDir, "launch-record.json"), "{");
    await expect(deploy(opts())).rejects.toMatchObject({ code: "GATE_BLOCKED" });
    expect(env.readState().calls).toEqual([]);
  });
});

describe("I-DEP-8 secrets handling", () => {
  it("sends values only in a mode-600 JSON body, per variant, never argv, and deletes the file", async () => {
    await deploy(opts());
    const state = env.readState();
    const bodies = state.secretBodies;
    expect(bodies.map((b) => b.variant)).toEqual(["PREVIEW", "PUBLISH"]);
    for (const b of bodies) {
      expect(b.mode).toBe(0o600);
      expect(b.contentType).toBe(true);
      expect(existsSync(b.file)).toBe(false);
      expect(b.patch.length).toBeGreaterThanOrEqual(6);
    }
    const preview = JSON.parse(readFileSync(join(env.root, ".agentdoor/secrets/preview.json"), "utf8")) as Record<string, string>;
    const publish = JSON.parse(readFileSync(join(env.root, ".agentdoor/secrets/publish.json"), "utf8")) as Record<string, string>;
    expect(preview.SESSION_SECRET).not.toBe(publish.SESSION_SECRET);
    expect(preview.OWNER_TOKEN_HASH).not.toBe(publish.OWNER_TOKEN_HASH);
    const values = [...Object.values(preview), ...Object.values(publish)];
    const argvText = JSON.stringify(state.calls);
    for (const v of values) expect(argvText).not.toContain(v);
    const logText = JSON.stringify(logs);
    for (const v of values) expect(logText).not.toContain(v);
    expect(readdirSync(join(env.root, ".agentdoor/tmp"))).toEqual([]);
  });

  it("secret files are mode 600 and values never reach the zip, deploy.json or logs", async () => {
    await deploy(opts());
    for (const f of ["preview", "publish"]) expect(statSync(join(env.root, `.agentdoor/secrets/${f}.json`)).mode & 0o777).toBe(0o600);
    const zip = readdirSync(join(env.root, "out")).find((f) => f.endsWith(".zip")) as string;
    const dump = readFileSync(join(env.root, "out", zip)).toString("latin1");
    const priv = readFileSync(join(env.root, ".agentdoor/secrets/quote-signing-private.key"), "utf8").trim();
    expect(dump).not.toContain(priv);
    expect(readFileSync(join(env.root, ".agentdoor/deploy.json"), "utf8")).not.toContain(priv);
  });

  it("an existing secrets file that lacks a required name fails clearly", async () => {
    writeFileSync(join(env.root, ".agentdoor/secrets/preview.json"), JSON.stringify({ SESSION_SECRET: "x".repeat(40) }));
    writeFileSync(join(env.root, ".agentdoor/secrets/publish.json"), JSON.stringify({ SESSION_SECRET: "x".repeat(40) }));
    await expect(deploy(opts())).rejects.toMatchObject({ code: "SECRETS_INVALID" });
  });
});

describe("logging", () => {
  it("logs names only: no ids, paths, urls or argv values", async () => {
    await deploy(opts());
    const text = JSON.stringify(logs);
    for (const leak of ["APP-NEW", env.root, ".zip", "airoapp.ai", "--app-id", SECRET_RECIPIENT]) expect(text).not.toContain(leak);
    expect(logs.some((l) => l.event === "gddy" && l.label === "hosting source upload")).toBe(true);
  });
});

describe("smoke and polling", () => {
  it("fails when the public health reports a different policy", async () => {
    const stale: DeployOptions["fetchFn"] = async (url) =>
      new Response(JSON.stringify({ data: { launched: true, policyHash: "other" } }), { status: url.endsWith("/healthz") ? 200 : 404 });
    await expect(deploy(opts({ fetchFn: stale }))).rejects.toMatchObject({ code: "POLL_TIMEOUT" });
  });

  it("fails smoke when the quote is not QUOTED", async () => {
    const base = fakeFetch(env);
    const bad: DeployOptions["fetchFn"] = async (url, init) =>
      url.endsWith("/api/quotes") ? new Response(JSON.stringify({ error: { code: "LEAD_TIME" } }), { status: 422 }) : base(url, init);
    await expect(deploy(opts({ fetchFn: bad }))).rejects.toMatchObject({ code: "SMOKE_FAILED" });
  });

  it("polls with capped backoff 2 to 15 s and gives up after 5 minutes", async () => {
    const sleeps: number[] = [];
    const never: DeployOptions["fetchFn"] = async () => new Response(JSON.stringify({ data: { launched: false } }), { status: 200 });
    await expect(deploy(opts({ fetchFn: never, sleep: async (ms) => void sleeps.push(ms) }))).rejects.toMatchObject({ code: "POLL_TIMEOUT" });
    expect(sleeps.slice(0, 5)).toEqual([2000, 4000, 8000, 15000, 15000]);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(300_000);
  });
});

describe("upload blocked by the platform filter (403)", () => {
  const uploads = (): number => calls(env).filter((c) => c === "hosting source upload").length;

  it("repacks and retries once, then continues; the third level is unused", async () => {
    env.writeState({ uploadFailures: [403] });
    const sleeps: number[] = [];
    const res = await deploy(opts({ sleep: async (ms) => void sleeps.push(ms) }));
    expect(uploads()).toBe(2);
    expect(res.steps.upload).toBe("done");
    expect(res.steps.publish).toBe("done");
    expect(sleeps[0]).toBeGreaterThanOrEqual(1000);
    expect(logs.filter((l) => l.event === "upload-retry")).toHaveLength(1);
    expect(env.readState().imports).toHaveLength(1);
  });

  it("three 403s: blocked error, 3 uploads, no publish", async () => {
    env.writeState({ uploadFailures: [403, 403, 403] });
    const err = await deploy(opts()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "GDDY_FAILED", httpStatus: 403 });
    expect((err as Error).message).toMatch(/blocked by the platform filter after 3 differently packed attempts/);
    expect(uploads()).toBe(3);
    expect(calls(env)).not.toContain("hosting deployment publish");
    expect(calls(env)).not.toContain("api call -X");
  });

  it("a 500 is not retried by repacking", async () => {
    env.writeState({ uploadFailures: [500] });
    const err = await deploy(opts()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "GDDY_FAILED", httpStatus: 500 });
    expect(uploads()).toBe(1);
    expect(logs.some((l) => l.event === "upload-retry")).toBe(false);
  });

  it("logs never carry argv, secrets, the HTML body or zip contents", async () => {
    env.writeState({ uploadFailures: [403, 403, 403] });
    await deploy(opts()).catch(() => undefined);
    const text = JSON.stringify(logs);
    const zip = readdirSync(join(env.root, "out")).find((f) => f.endsWith(".zip")) as string;
    for (const leak of ["APP-NEW", env.root, ".zip", zip, "--app-id", "--file", "<html", "<script", "var x=1","Forbidden", SECRET_RECIPIENT, "dist/index.js", "package.json"]) {
      expect(text, leak).not.toContain(leak);
    }
  });
});

describe("preview boot from flattened platform logs", () => {
  const stage = () => calls(env);
  const polls = (): number => stage().filter((c) => c === "hosting log list").length;

  it("success: latest lifecycle row is [INFO] boot and a listening row follows", async () => {
    const res = await deploy(opts());
    expect(res.steps.preview).toBe("done");
  });

  it("[WARN] boot (Not launched) stops with GATE_BLOCKED before publish", async () => {
    env.writeState({ bootScript: [["WARN boot", "INFO listening"]] });
    const err = await deploy(opts()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "GATE_BLOCKED", status: 409 });
    expect(stage()).not.toContain("hosting deployment publish");
    expect(stage().filter((c) => c === "api call -X")).toHaveLength(1); // preview secrets only
  });

  it("boot without a listening row keeps polling until it appears", async () => {
    env.writeState({ bootScript: [["INFO boot"], ["INFO listening"]] });
    const res = await deploy(opts());
    expect(res.steps.preview).toBe("done");
    expect(polls()).toBeGreaterThanOrEqual(2);
  });

  it("config_invalid then boot keeps polling, then succeeds", async () => {
    env.writeState({ bootScript: [["INFO config_invalid"], ["ERROR boot_failed"], ["INFO boot", "INFO listening"]] });
    const res = await deploy(opts());
    expect(res.steps.publish).toBe("done");
    expect(polls()).toBeGreaterThanOrEqual(3);
  });

  it("config_invalid forever: POLL_TIMEOUT names the last lifecycle event only", async () => {
    env.writeState({ bootScript: Array.from({ length: 200 }, () => ["INFO config_invalid"]) });
    const err = (await deploy(opts()).catch((e: unknown) => e)) as DeployError;
    expect(err).toMatchObject({ code: "POLL_TIMEOUT" });
    expect(err.message).toContain("[INFO] config_invalid");
    expect(stage()).not.toContain("hosting deployment publish");
  });

  it("a boot older than the restart (minus 5 s skew) is ignored", async () => {
    const old = (ms: number) => new Date(NOW_MS - ms).toISOString();
    env.writeState({
      rows: [
        { level: "INFO", message: "[INFO] boot", timestamp: old(60_000) },
        { level: "INFO", message: "[INFO] listening", timestamp: old(59_000) },
      ],
      bootScript: [],
    });
    const err = (await deploy(opts()).catch((e: unknown) => e)) as DeployError;
    expect(err).toMatchObject({ code: "POLL_TIMEOUT" });
    expect(err.message).toContain("no lifecycle event seen");
    expect(stage()).not.toContain("hosting deployment publish");
  });

  it("a boot inside the 5 s skew window still counts", async () => {
    env.writeState({
      rows: [
        { level: "INFO", message: "[INFO] boot", timestamp: new Date(NOW_MS - 4_000).toISOString() },
        { level: "INFO", message: "[INFO] listening", timestamp: new Date(NOW_MS - 3_000).toISOString() },
      ],
      bootScript: [],
    });
    expect((await deploy(opts())).steps.preview).toBe("done");
  });

  it("never logs log message bodies, noise lines or secrets", async () => {
    env.writeState({ bootScript: [["INFO config_invalid"], ["INFO boot", "INFO listening"]] });
    await deploy(opts());
    const text = JSON.stringify(logs);
    for (const leak of ["node dist/index.js", "NODE_TLS", "Object.<anonymous>", "[INFO] boot", "[INFO] listening", "config_invalid"]) {
      expect(text, leak).not.toContain(leak);
    }
    const priv = readFileSync(join(env.root, ".agentdoor/secrets/quote-signing-private.key"), "utf8").trim();
    expect(text).not.toContain(priv);
  });

  it("the timeout error carries no message body or noise", async () => {
    env.writeState({ bootScript: Array.from({ length: 200 }, () => ["ERROR boot_failed"]) });
    const err = (await deploy(opts()).catch((e: unknown) => e)) as DeployError;
    expect(err.message).toContain("[ERROR] boot_failed");
    expect(err.message).not.toContain("node dist");
  });
});
