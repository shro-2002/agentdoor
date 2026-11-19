import type { Deps } from "./compile.js";
import { approve, commitVersion, latestPolicy, unknownRule } from "./policyEdit.js";

export interface ApprovalResult {
  version: number;
  /** False when nothing changed (already approved), so no version was written. */
  changed: boolean;
}

/** Approves one rule by an explicit owner action: the only way a medium/low-confidence rule gets approved here. */
export function approveRule(deps: Deps, sessionId: string, path: string): ApprovalResult {
  const { version, policy } = latestPolicy(deps, sessionId);
  const prov = policy.provenance[path];
  if (!prov) throw unknownRule(path);
  if (prov.status === "approved") return { version, changed: false };
  const next = structuredClone(policy);
  next.provenance[path] = approve(prov);
  const created = commitVersion(deps, sessionId, next, { kind: "approve", path, fromVersion: version });
  return { version: created, changed: true };
}

export interface BulkApprovalResult extends ApprovalResult {
  approved: string[];
  skipped: string[];
}

/**
 * "Approve all high-confidence" (U-GATE-2): only proposed rules the compiler marked `high` are
 * approved; medium and low ones are listed as skipped and need their own explicit approval.
 */
export function approveAllHigh(deps: Deps, sessionId: string): BulkApprovalResult {
  const { version, policy } = latestPolicy(deps, sessionId);
  const next = structuredClone(policy);
  const approved: string[] = [];
  const skipped: string[] = [];
  for (const [path, prov] of Object.entries(policy.provenance)) {
    if (prov.status === "approved") continue;
    if (prov.confidence === "high") {
      next.provenance[path] = approve(prov);
      approved.push(path);
    } else skipped.push(path);
  }
  if (approved.length === 0) return { version, changed: false, approved, skipped };
  const created = commitVersion(deps, sessionId, next, { kind: "approve-high", paths: approved, fromVersion: version });
  return { version: created, changed: true, approved, skipped };
}
