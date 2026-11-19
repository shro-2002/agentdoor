import { requiredPaths, type BusinessPolicy, type LaunchRecord, type RuleProvenance } from "@agentdoor/core";

/**
 * One definition per number the public pages quote, so /try and /launch-report can never disagree.
 * Pure functions: no clock, no I/O.
 */

/** The compile output's evidence rows (`session.compile.result.evidence`): the owner's words per rule path. */
export type EvidenceQuotes = readonly { path: string; quote: string | null }[];

/**
 * The owner's own words behind a rule. A `transcript` source carries its quote. When an owner edit or a
 * default note replaced the source, the originally recorded quote is taken from the compile output, if
 * it has one. Nothing is ever invented: no quote means null.
 */
export function ownerQuoteFor(path: string, prov: RuleProvenance, evidence: EvidenceQuotes = []): string | null {
  if (prov.source.kind === "transcript") return prov.source.quote;
  const found = evidence.find((e) => e.path === path && e.quote !== null && e.quote.trim() !== "");
  return found?.quote ?? null;
}

/** "N of M rules point back to something the owner said". */
export function quoteEvidenceFigures(policy: BusinessPolicy, evidence: EvidenceQuotes = []): { total: number; withQuote: number } {
  const entries = Object.entries(policy.provenance);
  return { total: entries.length, withQuote: entries.filter(([path, prov]) => ownerQuoteFor(path, prov, evidence) !== null).length };
}

/** Approved of required (the launch gate's definition), plus how many rules are listed in all. */
export function approvalFigures(policy: BusinessPolicy): { required: number; approvedRequired: number; listed: number; approvedListed: number } {
  const required = requiredPaths(policy);
  const prov = policy.provenance;
  return {
    required: required.length,
    approvedRequired: required.filter((p) => prov[p]?.status === "approved").length,
    listed: Object.keys(prov).length,
    approvedListed: Object.values(prov).filter((p) => p.status === "approved").length,
  };
}

export interface GapRowLike {
  severity: "critical" | "warning";
  fixedInVersion: number | null;
}

/** Gaps found = every row; `open` are the ones not fixed (or accepted) yet. */
export function gapFigures(rows: readonly GapRowLike[]): { found: number; critical: number; fixed: number; open: number } {
  return {
    found: rows.length,
    critical: rows.filter((r) => r.severity === "critical").length,
    fixed: rows.filter((r) => r.fixedInVersion !== null).length,
    open: rows.filter((r) => r.fixedInVersion === null).length,
  };
}

type Severity = "critical" | "warning";
type RunLabel = "First rehearsal run" | "Final rehearsal run";
const FINAL: RunLabel = "Final rehearsal run";
const basisLive = (v: number): string => "policy version " + v + ", computed when you loaded this page";
const basisRecorded = (v: number): string => "policy version " + v + ", as signed at launch";

/** One labelled rehearsal run, in the same shape wherever it is shown. */
export interface RunFigures {
  label: RunLabel;
  checks: number;
  passed: number;
  gaps: ReturnType<typeof gapFigures>;
  basis: string;
}

interface LiveRunLike {
  version: number;
  gaps: { severity: Severity; dismissed: boolean }[];
  summary: { probes: number; scenarios: number; passed: number };
}

/** A run computed now (/try recomputes every version on load). */
export function liveRunFigures(label: RunLabel, run: LiveRunLike): RunFigures {
  const rows = run.gaps.map((g) => ({ severity: g.severity, fixedInVersion: g.dismissed ? run.version : null }));
  return {
    label,
    checks: run.summary.probes + run.summary.scenarios,
    passed: run.summary.passed,
    gaps: gapFigures(rows),
    basis: basisLive(run.version),
  };
}

/** The final run as signed into the launch record at launch time. */
export function recordedRunFigures(record: LaunchRecord): RunFigures {
  const r = record.rehearsal;
  return {
    label: FINAL,
    checks: r.probes + r.scenarios,
    passed: r.passed,
    gaps: gapFigures(r.gapsFound),
    basis: basisRecorded(record.policyVersion),
  };
}
