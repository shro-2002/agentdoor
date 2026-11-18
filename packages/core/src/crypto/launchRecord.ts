import { canonicalJson } from "../hash.js";
import { signUtf8, verifyUtf8 } from "./keys.js";

export interface LaunchRecord {
  v: 1;
  shop: string;
  policyVersion: number;
  policyHash: string;
  rehearsal: {
    runId: string;
    ranAt: string;
    probes: number;
    scenarios: number;
    passed: number;
    gapsFound: {
      id: string;
      severity: "critical" | "warning";
      code: string;
      fixedInVersion: number | null;
    }[];
    criticalOpen: number;
    resultsHash: string;
  };
  approvals: { required: number; approved: number };
  publicKey: string;
  signedAt: string;
}

/** launch-record.json */
export interface SignedLaunchRecord {
  record: LaunchRecord;
  signature: string;
}

export const signLaunchRecord = (
  record: LaunchRecord,
  privateKeyB64: string,
): SignedLaunchRecord => ({
  record,
  signature: signUtf8(canonicalJson(record), privateKeyB64),
});

/**
 * `trustedPublicKeyB64` comes from the shop's env, never from the file itself: a record
 * that embeds its own key would otherwise validate any forger. The embedded key must match.
 */
export function verifyLaunchRecord(
  file: SignedLaunchRecord,
  trustedPublicKeyB64: string,
): boolean {
  try {
    if (file.record.publicKey !== trustedPublicKeyB64) return false;
    return verifyUtf8(canonicalJson(file.record), file.signature, trustedPublicKeyB64);
  } catch {
    return false;
  }
}
