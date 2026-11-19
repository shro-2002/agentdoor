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
  | "POLICY_HASH_MISMATCH";

export type LaunchState =
  | { launched: true; policy: BusinessPolicy; policyHash: string; record: LaunchRecord }
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
  if (file.record.rehearsal.criticalOpen !== 0) return no("CRITICAL_GAPS_OPEN");
  const hash = policyHash(policy);
  if (file.record.policyHash !== hash) return no("POLICY_HASH_MISMATCH");
  return { launched: true, policy, policyHash: hash, record: file.record };
}
