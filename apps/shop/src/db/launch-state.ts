import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BusinessPolicySchema,
  policyHash,
  verifyLaunchRecord,
  type BusinessPolicy,
  type LaunchRecord,
  type SignedLaunchRecord,
} from "@agentdoor/core";

export type NotLaunchedReason =
  | "BUNDLE_UNREADABLE"
  | "BAD_SIGNATURE"
  | "CRITICAL_GAPS_OPEN"
  | "APPROVALS_INCOMPLETE"
  | "POLICY_HASH_MISMATCH";

export type LaunchState =
  | { launched: true; policy: BusinessPolicy; policyHash: string; record: LaunchRecord; signed: SignedLaunchRecord }
  | { launched: false; reason: NotLaunchedReason };

const no = (reason: NotLaunchedReason): LaunchState => ({ launched: false, reason });

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/**
 * Boot guard (03 §5.4). Never throws: any failure means "not launched", so a hand-edited
 * policy cannot take orders. The trusted key comes from env, not from the bundle.
 */
export function loadLaunchState(bundleDir: string, trustedPublicKey: string): LaunchState {
  let policy: BusinessPolicy;
  let file: SignedLaunchRecord;
  try {
    policy = BusinessPolicySchema.parse(readJson(join(bundleDir, "policy.json")));
    file = readJson(join(bundleDir, "launch-record.json")) as SignedLaunchRecord;
  } catch {
    return no("BUNDLE_UNREADABLE");
  }
  if (!verifyLaunchRecord(file, trustedPublicKey)) return no("BAD_SIGNATURE");
  const { rehearsal, approvals } = file.record;
  // Both the counter and the list are signed, so a shop is held back if either admits an open critical gap.
  const openCritical = rehearsal.gapsFound.some((g) => g.severity === "critical" && g.fixedInVersion === null);
  if (rehearsal.criticalOpen !== 0 || openCritical) return no("CRITICAL_GAPS_OPEN");
  if (approvals.approved !== approvals.required) return no("APPROVALS_INCOMPLETE");
  const hash = policyHash(policy);
  if (file.record.policyHash !== hash) return no("POLICY_HASH_MISMATCH");
  return { launched: true, policy, policyHash: hash, record: file.record, signed: file };
}
