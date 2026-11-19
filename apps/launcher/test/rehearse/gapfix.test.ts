import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessPolicySchema, policyHash } from "@agentdoor/core";
import { applyGapFix } from "../../src/flows/gapFix.js";
import { rehearsalState } from "../../src/flows/rehearse.js";
import { leakyPolicy, pinClock, rehearse, scenario, setup, NOW_ISO } from "./helpers.js";

beforeEach(() => pinClock());
afterEach(() => vi.unstubAllEnvs());

describe("U-REH-4 gap fix -> typed patch -> new version, rehearsal stale", () => {
  it("creates v2 with gap_fix provenance, leaves v1 untouched and marks the rehearsal stale", async () => {
    const { deps, store, rehearsals, sessionId } = setup(leakyPolicy());
    const first = (await rehearse(rehearsals, sessionId)).result!;
    expect(first.gaps.map((g) => g.id)).toContain("NO_CAPACITY_LIMIT");
    expect(rehearsalState(deps, sessionId).stale).toBe(false);

    const v1Hash = policyHash(store.readPolicy(sessionId, 1));
    const fix = applyGapFix(deps, sessionId, "NO_CAPACITY_LIMIT", "units-15");
    expect(fix).toMatchObject({ fromVersion: 1, toVersion: 2 });

    const v2 = store.readPolicy(sessionId, 2);
    expect(BusinessPolicySchema.safeParse(v2).success).toBe(true);
    expect(v2.capacity.unitsPerDay).toBe(15);
    expect(v2.provenance["capacity.unitsPerDay"]).toMatchObject({
      source: { kind: "gap_fix", gapId: "NO_CAPACITY_LIMIT" },
      status: "approved",
      approvedAt: new Date(NOW_ISO).toISOString(),
    });
    expect(policyHash(store.readPolicy(sessionId, 1))).toBe(v1Hash);
    expect(store.latestVersion(sessionId)).toBe(2);

    const state = rehearsalState(deps, sessionId);
    expect(state.stale).toBe(true);
    expect(state.policyVersion).toBe(2);

    const log = JSON.parse(readFileSync(path.join(store.sessionDir(sessionId), "fixes.json"), "utf8"));
    expect(log).toEqual([expect.objectContaining({ gapId: "NO_CAPACITY_LIMIT", choice: "units-15", fromVersion: 1, toVersion: 2 })]);

    const second = (await rehearse(rehearsals, sessionId)).result!;
    expect(second.policyVersion).toBe(2);
    expect(second.gaps.map((g) => g.id)).not.toContain("NO_CAPACITY_LIMIT");
    expect(rehearsalState(deps, sessionId).stale).toBe(false);
  });

  it("rush fixes cap the rush units, or remove rush and drop its now-orphan provenance", async () => {
    const a = setup(leakyPolicy());
    await rehearse(a.rehearsals, a.sessionId);
    applyGapFix(a.deps, a.sessionId, "NO_CAPACITY_LIMIT", "units-10");
    applyGapFix(a.deps, a.sessionId, "RUSH_UNBOUNDED", "rush-cap-2");
    const capped = a.store.readPolicy(a.sessionId, 3);
    expect(capped.rush?.maxRushUnitsPerDay).toBe(2);
    expect(capped.provenance["rush.maxRushUnitsPerDay"]).toMatchObject({ source: { kind: "gap_fix" }, status: "approved" });

    const b = setup(leakyPolicy());
    await rehearse(b.rehearsals, b.sessionId);
    applyGapFix(b.deps, b.sessionId, "RUSH_UNBOUNDED", "rush-none");
    const none = b.store.readPolicy(b.sessionId, 2);
    expect(none.rush).toBeNull();
    expect(none.provenance.rush).toMatchObject({ source: { kind: "gap_fix" }, status: "approved" });
    expect(Object.keys(none.provenance).filter((p) => p.startsWith("rush."))).toEqual([]);
    expect(BusinessPolicySchema.safeParse(none).success).toBe(true);
  });

  it("offers only typed choices, validates custom values, and refuses unknown gaps or choices", async () => {
    const { deps, store, rehearsals, sessionId } = setup(leakyPolicy());
    await rehearse(rehearsals, sessionId);
    expect(() => applyGapFix(deps, sessionId, "NO_CAPACITY_LIMIT", "units-9999")).toThrow(/choice/i);
    expect(() => applyGapFix(deps, sessionId, "NO_CAPACITY_LIMIT", "units-custom")).toThrow(/value/i);
    expect(() => applyGapFix(deps, sessionId, "NO_CAPACITY_LIMIT", "units-custom", 500)).toThrow(/value/i);
    expect(() => applyGapFix(deps, sessionId, "NO_SUCH_GAP", "units-5")).toThrow(/gap/i);
    expect(store.latestVersion(sessionId)).toBe(1); // nothing was written

    applyGapFix(deps, sessionId, "NO_CAPACITY_LIMIT", "units-custom", 12);
    expect(store.readPolicy(sessionId, 2).capacity.unitsPerDay).toBe(12);
  });

  it("approving a proposed rule keeps its evidence; approve-all-high skips medium and low (U-GATE-2 half)", async () => {
    const { deps, store, rehearsals, sessionId } = setup(leakyPolicy());
    await rehearse(rehearsals, sessionId);
    const before = store.readPolicy(sessionId, 1).provenance["capacity.unitsPerDay"]!;
    expect(before.status).toBe("proposed");
    applyGapFix(deps, sessionId, "UNAPPROVED_RULE:capacity.unitsPerDay", "approve");
    const after = store.readPolicy(sessionId, 2).provenance["capacity.unitsPerDay"]!;
    expect(after).toMatchObject({ status: "approved", source: before.source, confidence: before.confidence });
  });

  it("dismissing a scenario gap records an owner_edit note on its related path and survives re-runs", async () => {
    const { deps, store, rehearsals, sessionId } = setup(leakyPolicy(), [
      scenario("pushy", { ownerWouldWant: "REFUSE", relatedPaths: ["orderRules.minOrderPaise"] }),
    ]);
    const first = (await rehearse(rehearsals, sessionId)).result!;
    const gapId = first.gaps.find((g) => g.code === "SCENARIO_UNHANDLED")!.id;
    applyGapFix(deps, sessionId, gapId, "dismiss");
    const prov = store.readPolicy(sessionId, 2).provenance["orderRules.minOrderPaise"]!;
    expect(prov.source).toMatchObject({ kind: "owner_edit" });
    expect(prov.status).toBe("approved");

    const again = (await rehearse(rehearsals, sessionId)).result!;
    const gap = again.gaps.find((g) => g.id === gapId)!;
    expect(gap.dismissed).toBe(true);
    expect(again.summary.criticalOpen).toBe(first.summary.criticalOpen - 1);
  });
});
