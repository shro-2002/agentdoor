import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BusinessPolicySchema,
  policyHash,
  verifyLaunchRecord,
  type BusinessPolicy,
  type SignedLaunchRecord,
} from "@agentdoor/core";
import { gateBlocked } from "./errors.js";

export interface GateOk {
  policy: BusinessPolicy;
  policyHash: string;
  signed: SignedLaunchRecord;
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function load(bundleDir: string): { policy: BusinessPolicy; signed: SignedLaunchRecord } {
  try {
    const policy = BusinessPolicySchema.parse(readJson(join(bundleDir, "policy.json")));
    return { policy, signed: readJson(join(bundleDir, "launch-record.json")) as SignedLaunchRecord };
  } catch {
    throw gateBlocked("bundle/policy.json or bundle/launch-record.json missing or invalid (run the launch flow first)");
  }
}

/**
 * Re-checks the launch gate from files on disk (U-GATE-3), mirroring the shop's boot guard so a
 * bundle that would boot "Not launched" is never uploaded. The trusted key is never read from the bundle.
 */
export function checkGate(bundleDir: string, trustedPublicKey: string): GateOk {
  const { policy, signed } = load(bundleDir);
  if (!verifyLaunchRecord(signed, trustedPublicKey)) throw gateBlocked("launch record signature is not valid");
  const { rehearsal, approvals } = signed.record;
  const openCritical = rehearsal.gapsFound.some((g) => g.severity === "critical" && g.fixedInVersion === null);
  if (rehearsal.criticalOpen !== 0 || openCritical) throw gateBlocked("critical gaps are still open");
  if (approvals.approved !== approvals.required) throw gateBlocked("not every required rule is approved");
  const hash = policyHash(policy);
  if (signed.record.policyHash !== hash) throw gateBlocked("policy does not match the signed launch record");
  return { policy, policyHash: hash, signed };
}
