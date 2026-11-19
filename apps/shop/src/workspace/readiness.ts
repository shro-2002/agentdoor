import {
  countOpenByCategory,
  gapCategory,
  policyHash,
  requiredPaths,
  signLaunchRecord,
  verifyLaunchRecord,
  type CategoryCounts,
  type LaunchRecord,
  type SignedLaunchRecord,
} from "@agentdoor/core";
import { runChecks, type GateCheck } from "../../../launcher/src/flows/gate.js";
import type { Trust } from "../views/trust.js";
import type { DraftState } from "./state.js";

export interface Readiness {
  hasPolicy: boolean;
  hasRun: boolean;
  /** The last rehearsal ran on an older version of the rules. */
  stale: boolean;
  /** Open findings per category; null until a rehearsal has run. They are never added together. */
  counts: CategoryCounts | null;
  checks: GateCheck[];
  approvals: { required: number; approved: number };
  /** Publishing is locked until this is true. */
  canPublish: boolean;
  /** Why it is locked, in plain words, most important first. */
  blockers: string[];
}

/** The launcher's gate (reused as is) plus the three categories the owner must clear: policy gaps, pending approvals, engine failures. */
export function readiness(state: DraftState): Readiness {
  const policy = state.policy;
  if (!policy) return { hasPolicy: false, hasRun: false, stale: false, counts: null, checks: [], approvals: { required: 0, approved: 0 }, canPublish: false, blockers: ["Describe your business first."] };
  const run = state.run;
  const stale = !run || run.policyHash !== policyHash(policy);
  const checks = runChecks(policy, run, stale);
  const counts = run ? countOpenByCategory(run.gaps) : null;
  // A rule that is both unapproved and low-confidence is one rule waiting for one approval.
  if (run && counts)
    counts.approval = new Set(run.gaps.filter((g) => !g.dismissed && gapCategory(g.code) === "approval").map((g) => g.paths[0] ?? g.id)).size;
  const required = requiredPaths(policy);
  const approvals = { required: required.length, approved: required.filter((p) => policy.provenance[p]?.status === "approved").length };
  const blockers: string[] = [];
  if (!run) blockers.push("Run the rehearsal.");
  else if (stale) blockers.push("Your rules changed. Run the checks again.");
  if (counts && counts.policy > 0) blockers.push(`${counts.policy} business ${counts.policy === 1 ? "decision" : "decisions"} still open.`);
  if (counts && counts.approval > 0) blockers.push(`${counts.approval} ${counts.approval === 1 ? "rule is" : "rules are"} waiting for your approval.`);
  if (counts && counts.scenario > 0) blockers.push(`${counts.scenario} customer ${counts.scenario === 1 ? "case" : "cases"} to settle.`);
  if (counts && counts.engine > 0) blockers.push("An engine check failed.");
  const unapproved = approvals.required - approvals.approved;
  if (unapproved > 0 && !blockers.some((b) => b.includes("approval"))) blockers.push(`${unapproved} required ${unapproved === 1 ? "rule needs" : "rules need"} approving.`);
  const clear = counts !== null && counts.policy === 0 && counts.approval === 0 && counts.engine === 0;
  return { hasPolicy: true, hasRun: run !== null, stale, counts, checks, approvals, canPublish: clear && checks.every((c) => c.ok), blockers };
}

export interface PreparedPackage {
  policyJson: string;
  policyHash: string;
  signed: SignedLaunchRecord;
}

/** The same record the launcher signs at launch, built from the draft's final rehearsal. Needs `canPublish`. */
export function buildPackage(state: DraftState, keys: { privateKey: string; publicKey: string }, nowIso: string): PreparedPackage {
  const policy = state.policy;
  const run = state.run;
  const ready = readiness(state);
  if (!policy || !run || !ready.canPublish) throw new Error("not ready to publish");
  const open = new Set(run.gaps.filter((g) => !g.dismissed).map((g) => g.id));
  const record: LaunchRecord = {
    v: 1,
    shop: policy.business.slug,
    policyVersion: state.policyVersion,
    policyHash: policyHash(policy),
    rehearsal: {
      runId: run.runId,
      ranAt: run.ranAt,
      probes: run.summary.probes,
      scenarios: run.summary.scenarios,
      passed: run.summary.passed,
      gapsFound: Object.entries(state.seenGaps)
        .map(([id, g]) => ({ id, severity: g.severity, code: g.code, fixedInVersion: open.has(id) ? null : state.policyVersion }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      criticalOpen: run.summary.criticalOpen,
      resultsHash: run.resultsHash,
    },
    approvals: ready.approvals,
    publicKey: keys.publicKey,
    signedAt: nowIso,
  };
  const signed = signLaunchRecord(record, keys.privateKey);
  if (!verifyLaunchRecord(signed, keys.publicKey)) throw new Error("signing key mismatch");
  return { policyJson: `${JSON.stringify(policy, null, 2)}\n`, policyHash: record.policyHash, signed };
}

/** What a preview may say about the draft: "Rehearsed" only while the same gate that unlocks publishing passes. */
export function previewTrust(state: DraftState): Trust {
  const run = state.run;
  return { kind: "preview", rehearsed: run !== null && readiness(state).canPublish, checks: run ? run.summary.probes + run.summary.scenarios : 0 };
}
