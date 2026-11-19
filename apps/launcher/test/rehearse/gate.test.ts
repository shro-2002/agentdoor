import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { policyHash, requiredPaths, verifyLaunchRecord, type BusinessPolicy, type SignedLaunchRecord } from "@agentdoor/core";
import { checkGate } from "../../src/deploy/gate.js";
import { approveAllHigh, approveRule } from "../../src/flows/approve.js";
import { gateStatus, launch } from "../../src/flows/gate.js";
import { Rehearsals } from "../../src/flows/rehearse.js";
import { bakeryPolicy, leakyPolicy, pinClock, rehearse, resolveAll, scenario, setup, tmpDir, writeKeys } from "./helpers.js";

beforeEach(() => pinClock());
afterEach(() => vi.unstubAllEnvs());

function layout() {
  const dir = tmpDir();
  const paths = { bundleDir: path.join(dir, "bundle"), secretsDir: path.join(dir, "secrets") };
  return { paths, keys: writeKeys(paths.secretsDir) };
}
const failing = (status: ReturnType<typeof gateStatus>) => status.checks.filter((c) => !c.ok).map((c) => c.id);

describe("U-GATE-1 the gate blocks until everything is clear", () => {
  it("blocks when there is no rehearsal yet", () => {
    const { deps, sessionId } = setup(bakeryPolicy());
    const status = gateStatus(deps, sessionId);
    expect(status.canLaunch).toBe(false);
    expect(failing(status)).toEqual(["rehearsal_current"]);
  });

  it("blocks on an unapproved required rule", async () => {
    const policy = bakeryPolicy();
    policy.provenance["capacity.unitsPerDay"]!.status = "proposed";
    const { deps, rehearsals, sessionId } = setup(policy);
    await rehearse(rehearsals, sessionId);
    const status = gateStatus(deps, sessionId);
    expect(status.canLaunch).toBe(false);
    expect(failing(status)).toContain("rules_approved");
    expect(failing(status)).toContain("no_critical_open"); // the linter's UNAPPROVED_RULE
  });

  it("blocks when provenance coverage fails in either direction", async () => {
    const missing = bakeryPolicy();
    delete missing.provenance["schedule.minLeadHours"];
    const a = setup(missing);
    await rehearse(a.rehearsals, a.sessionId);
    expect(failing(gateStatus(a.deps, a.sessionId))).toContain("coverage");

    const orphan = bakeryPolicy();
    orphan.provenance["catalog[no-such-item].unitPricePaise"] = { ...orphan.provenance["capacity.unitsPerDay"]! };
    const b = setup(orphan);
    await rehearse(b.rehearsals, b.sessionId);
    expect(b.deps.store.latestVersion(b.sessionId)).toBe(1);
    expect(gateStatus(b.deps, b.sessionId).canLaunch).toBe(false);
  });

  it("blocks on a stale rehearsal (policy changed after the run)", async () => {
    const { deps, store, rehearsals, sessionId } = setup(bakeryPolicy());
    await rehearse(rehearsals, sessionId);
    expect(gateStatus(deps, sessionId).canLaunch).toBe(true);
    const edited = structuredClone(store.readPolicy(sessionId, 1));
    edited.catalog[0]!.unitPricePaise += 100;
    store.writeVersion(sessionId, edited, { kind: "owner_edit", result: { questions: [] } });
    const status = gateStatus(deps, sessionId);
    expect(status.canLaunch).toBe(false);
    expect(failing(status)).toEqual(["rehearsal_current"]);
  });

  it("blocks on an open critical gap", async () => {
    const { deps, rehearsals, sessionId } = setup(bakeryPolicy(), [scenario("pushy", { ownerWouldWant: "REFUSE" })]);
    await rehearse(rehearsals, sessionId);
    const status = gateStatus(deps, sessionId);
    expect(failing(status)).toEqual(["no_critical_open"]);
  });

  it("blocks when any probe FAILs (engine bug), even with no critical policy gap", async () => {
    const { deps, sessionId } = setup(bakeryPolicy());
    const broken = new Rehearsals(deps, { evaluate: () => ({ outcome: "REFUSED", reasons: [] }) });
    await rehearse(broken, sessionId);
    expect(failing(gateStatus(deps, sessionId))).toContain("no_failures");
  });

  it("passes only when all clear, and a launch needs explicit consent", async () => {
    const { deps, rehearsals, sessionId } = setup(bakeryPolicy());
    const { paths } = layout();
    await rehearse(rehearsals, sessionId);
    const status = gateStatus(deps, sessionId);
    expect(status).toMatchObject({ canLaunch: true });
    expect(failing(status)).toEqual([]);
    expect(() => launch(deps, sessionId, { consent: false, paths })).toThrow(/consent/i);
    expect(existsSync(paths.bundleDir)).toBe(false);
  });
});

describe("U-GATE-2 low-confidence approval needs a per-rule action", () => {
  it("approve-all-high skips medium and low; each is approved one by one", async () => {
    const policy = bakeryPolicy();
    const [high, medium, low] = ["catalog[choco-cake].unitPricePaise", "capacity.unitsPerDay", "schedule.minLeadHours"] as const;
    for (const [path, confidence] of [[high, "high"], [medium, "medium"], [low, "low"]] as const)
      Object.assign(policy.provenance[path]!, { status: "proposed", approvedAt: null, confidence });
    const { deps, store, rehearsals, sessionId } = setup(policy);

    const bulk = approveAllHigh(deps, sessionId);
    expect(bulk.approved).toEqual([high]);
    expect(bulk.skipped.sort()).toEqual([low, medium].sort());
    const v2 = store.readPolicy(sessionId, bulk.version);
    expect(v2.provenance[high]!.status).toBe("approved");
    expect(v2.provenance[medium]!.status).toBe("proposed");
    expect(v2.provenance[low]!.status).toBe("proposed");

    await rehearse(rehearsals, sessionId);
    expect(failing(gateStatus(deps, sessionId))).toContain("rules_approved");
    approveRule(deps, sessionId, medium);
    expect(failing(gateStatus(deps, sessionId))).toContain("rehearsal_current"); // approval changes the hash
    approveRule(deps, sessionId, low);
    await rehearse(rehearsals, sessionId);
    expect(gateStatus(deps, sessionId).canLaunch).toBe(true);
    expect(store.readPolicy(sessionId, store.latestVersion(sessionId)).provenance[low]!.approvedAt).toEqual(expect.any(String));
  });

  it("approveRule refuses a path that has no provenance", () => {
    const { deps, sessionId } = setup(bakeryPolicy());
    expect(() => approveRule(deps, sessionId, "no.such.path")).toThrow(/rule/i);
  });
});

describe("U-GATE-3 the signed launch record and the deploy adapter's disk re-check", () => {
  async function launched() {
    const ctx = setup(leakyPolicy());
    const lay = layout();
    const run = await resolveAll(ctx.rehearsals, ctx.deps, ctx.sessionId);
    const result = launch(ctx.deps, ctx.sessionId, { consent: true, paths: lay.paths });
    return { ...ctx, ...lay, run, result };
  }
  const readBundle = (dir: string) => ({
    policy: JSON.parse(readFileSync(path.join(dir, "policy.json"), "utf8")) as BusinessPolicy,
    signed: JSON.parse(readFileSync(path.join(dir, "launch-record.json"), "utf8")) as SignedLaunchRecord,
  });

  it("writes bundle/{policy,launch-record}.json that verify against the public key file", async () => {
    const { paths, keys, run, sessionId, deps } = await launched();
    const { policy, signed } = readBundle(paths.bundleDir);
    expect(verifyLaunchRecord(signed, keys.publicKey)).toBe(true);
    const latest = deps.store.readPolicy(sessionId, deps.store.latestVersion(sessionId));
    expect(policy).toEqual(latest);
    expect(signed.record).toMatchObject({
      v: 1,
      shop: policy.business.slug,
      policyVersion: deps.store.latestVersion(sessionId),
      policyHash: policyHash(policy),
      publicKey: keys.publicKey,
      approvals: { required: requiredPaths(policy).length, approved: requiredPaths(policy).length },
      rehearsal: { runId: run.runId, criticalOpen: 0, probes: run.result!.summary.probes },
    });
    expect(signed.record.rehearsal.resultsHash).toMatch(/^[a-f0-9]{64}$/);
    // the criticals found on the way are listed as fixed, none left open
    const found = signed.record.rehearsal.gapsFound;
    expect(found.filter((g) => g.severity === "critical").length).toBeGreaterThanOrEqual(3);
    expect(found.filter((g) => g.severity === "critical" && g.fixedInVersion === null)).toEqual([]);
  });

  it("is accepted unchanged by the deploy adapter's gate, and any edit to policy.json is GATE_BLOCKED 409", async () => {
    const { paths, keys } = await launched();
    expect(checkGate(paths.bundleDir, keys.publicKey).policyHash).toMatch(/^[a-f0-9]{64}$/);
    const { policy } = readBundle(paths.bundleDir);
    policy.catalog[0]!.unitPricePaise += 1;
    writeFileSync(path.join(paths.bundleDir, "policy.json"), JSON.stringify(policy));
    expect(() => checkGate(paths.bundleDir, keys.publicKey)).toThrowError(expect.objectContaining({ code: "GATE_BLOCKED", status: 409 }));
  });

  it("never writes or logs the private key", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { paths, keys, result } = await launched();
    const secret = keys.privateKey;
    for (const f of ["policy.json", "launch-record.json"]) expect(readFileSync(path.join(paths.bundleDir, f), "utf8")).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain(secret);
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(secret);
  });

  it("re-checks the gate itself: a forged consent on a blocked session writes nothing (409)", async () => {
    const { deps, sessionId } = setup(leakyPolicy());
    const { paths } = layout();
    expect(() => launch(deps, sessionId, { consent: true, paths })).toThrowError(expect.objectContaining({ code: "GATE_BLOCKED", status: 409 }));
    expect(existsSync(paths.bundleDir)).toBe(false);
  });

  it("refuses to sign when the key files are missing or do not match", async () => {
    const ctx = setup(bakeryPolicy());
    await rehearse(ctx.rehearsals, ctx.sessionId);
    const empty = { bundleDir: path.join(tmpDir(), "bundle"), secretsDir: path.join(tmpDir(), "nokeys") };
    expect(() => launch(ctx.deps, ctx.sessionId, { consent: true, paths: empty })).toThrowError(expect.objectContaining({ code: "KEYS_MISSING" }));
    const mismatched = layout();
    writeKeys(path.join(path.dirname(mismatched.paths.secretsDir), "other"));
    writeFileSync(
      path.join(mismatched.paths.secretsDir, "quote-signing-public.key"),
      readFileSync(path.join(path.dirname(mismatched.paths.secretsDir), "other", "quote-signing-public.key"), "utf8"),
    );
    expect(() => launch(ctx.deps, ctx.sessionId, { consent: true, paths: mismatched.paths })).toThrowError(expect.objectContaining({ code: "KEYS_MISMATCH" }));
    expect(existsSync(mismatched.paths.bundleDir)).toBe(false);
  });
});
