import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BusinessPolicySchema,
  generateKeyPair,
  policyHash,
  signLaunchRecord,
  type LaunchRecord,
} from "@agentdoor/core";
import { loadLaunchState } from "../src/db/launch-state.js";

const policyPath = new URL(
  "../../../packages/core/test/fixtures/policy.bakery.json",
  import.meta.url,
);
const policy = BusinessPolicySchema.parse(JSON.parse(readFileSync(policyPath, "utf8")));
const keys = generateKeyPair();

type Gaps = LaunchRecord["rehearsal"]["gapsFound"];

function bundle(
  opts: { editPrice?: boolean; criticalOpen?: number; approved?: number; gaps?: Gaps } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "bundle-"));
  const record: LaunchRecord = {
    v: 1,
    shop: policy.business.slug,
    policyVersion: 1,
    policyHash: policyHash(policy),
    rehearsal: {
      runId: "r1",
      ranAt: "2026-11-19T00:00:00Z",
      probes: 1,
      scenarios: 1,
      passed: 1,
      gapsFound: opts.gaps ?? [],
      criticalOpen: opts.criticalOpen ?? 0,
      resultsHash: "c".repeat(64),
    },
    approvals: { required: 3, approved: opts.approved ?? 3 },
    publicKey: keys.publicKey,
    signedAt: "2026-11-19T00:00:00Z",
  };
  const shipped = structuredClone(policy);
  if (opts.editPrice) shipped.catalog[0]!.unitPricePaise += 100;
  writeFileSync(join(dir, "policy.json"), JSON.stringify(shipped));
  writeFileSync(
    join(dir, "launch-record.json"),
    JSON.stringify(signLaunchRecord(record, keys.privateKey)),
  );
  return dir;
}

describe("loadLaunchState (boot guard)", () => {
  it("launches when policy, signature and gate agree", () => {
    const s = loadLaunchState(bundle(), keys.publicKey);
    expect(s.launched).toBe(true);
    expect(s.launched && s.policyHash).toBe(policyHash(policy));
  });

  it("U-GATE-4 edited policy with the original launch record → not launched", () => {
    const s = loadLaunchState(bundle({ editPrice: true }), keys.publicKey);
    expect(s).toMatchObject({ launched: false, reason: "POLICY_HASH_MISMATCH" });
  });

  it("rejects a record signed by another key", () => {
    const s = loadLaunchState(bundle(), generateKeyPair().publicKey);
    expect(s).toMatchObject({ launched: false, reason: "BAD_SIGNATURE" });
  });

  it("rejects open critical gaps", () => {
    const s = loadLaunchState(bundle({ criticalOpen: 1 }), keys.publicKey);
    expect(s).toMatchObject({ launched: false, reason: "CRITICAL_GAPS_OPEN" });
  });

  it("R2 #8: a signed record with approved < required → not launched", () => {
    const s = loadLaunchState(bundle({ approved: 2 }), keys.publicKey);
    expect(s).toMatchObject({ launched: false, reason: "APPROVALS_INCOMPLETE" });
  });

  it("R2 #8: an unfixed critical gap listed in the record → not launched even if criticalOpen says 0", () => {
    const open: Gaps = [{ id: "g1", severity: "critical", code: "PRICE_UNDEFINED", fixedInVersion: null }];
    expect(loadLaunchState(bundle({ gaps: open }), keys.publicKey)).toMatchObject({
      launched: false,
      reason: "CRITICAL_GAPS_OPEN",
    });
    const fixed: Gaps = [{ id: "g1", severity: "critical", code: "PRICE_UNDEFINED", fixedInVersion: 2 }];
    const warn: Gaps = [{ id: "g2", severity: "warning", code: "PRICE_UNDEFINED", fixedInVersion: null }];
    expect(loadLaunchState(bundle({ gaps: [...fixed, ...warn] }), keys.publicKey).launched).toBe(true);
  });

  it("missing bundle files → not launched, never throws", () => {
    const s = loadLaunchState(join(tmpdir(), "does-not-exist"), keys.publicKey);
    expect(s).toMatchObject({ launched: false, reason: "BUNDLE_UNREADABLE" });
  });
});
