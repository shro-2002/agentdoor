import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BusinessPolicySchema,
  policyHash,
  requiredPaths,
  signLaunchRecord,
  verifyLaunchRecord,
  type BusinessPolicy,
  type LaunchRecord,
  type SignedLaunchRecord,
} from "@agentdoor/core";
import { now } from "../claude/clock.js";
import { HTTP_BAD_REQUEST, HTTP_CONFLICT, LauncherError } from "../claude/errors.js";
import type { Deps } from "./compile.js";
import { readDismissals, rehearsalState, type RunResult } from "./rehearse.js";
import type { FixLogEntry } from "./gapFix.js";
import { getAt } from "./paths.js";
import { latestPolicy } from "./policyEdit.js";

export type GateCheckId =
  | "policy_valid"
  | "rules_approved"
  | "coverage"
  | "rehearsal_current"
  | "no_failures"
  | "no_critical_open";

export interface GateCheck {
  id: GateCheckId;
  label: string;
  ok: boolean;
  detail: string;
}

export interface GateStatus {
  /** Items 1-3 of 05 §6; item 4 (the owner's explicit consent) is what `launch` adds. */
  canLaunch: boolean;
  checks: GateCheck[];
  policyVersion: number;
  policyHash: string;
  approvals: { required: number; approved: number };
}

/** The layout the deploy script reads (apps/launcher/src/deploy/{pack,gate}.ts). */
export interface GatePaths {
  bundleDir: string;
  secretsDir: string;
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
export const DEFAULT_GATE_PATHS: GatePaths = {
  bundleDir: path.join(REPO_ROOT, "bundle"),
  secretsDir: path.join(REPO_ROOT, ".agentdoor", "secrets"),
};
const PRIVATE_KEY_FILE = "quote-signing-private.key";
const PUBLIC_KEY_FILE = "quote-signing-public.key";
const MAX_DETAIL_ITEMS = 5;

const list = (items: string[]): string =>
  `${items.slice(0, MAX_DETAIL_ITEMS).join(", ")}${items.length > MAX_DETAIL_ITEMS ? ` and ${items.length - MAX_DETAIL_ITEMS} more` : ""}`;

/**
 * Two-way provenance coverage (U-PROV-1): every required rule has provenance, and every provenance
 * key is a real rule. (The third direction, optional rules changed without evidence, is enforced
 * when the policy is compiled; the bakery fixture itself has such leaves, so the gate cannot.)
 */
export function coverageIssues(policy: BusinessPolicy): string[] {
  const missing = requiredPaths(policy).filter((p) => !(p in policy.provenance));
  const orphans = Object.keys(policy.provenance).filter((p) => !getAt(policy, p).found);
  return [
    ...(missing.length ? [`no provenance for ${list(missing)}`] : []),
    ...(orphans.length ? [`provenance for rules that do not exist: ${list(orphans)}`] : []),
  ];
}

const check = (id: GateCheckId, label: string, problems: string[], okDetail = "ok"): GateCheck => ({
  id,
  label,
  ok: problems.length === 0,
  detail: problems.length === 0 ? okDetail : problems.join("; "),
});

function runChecks(policy: BusinessPolicy, run: RunResult | null, stale: boolean): GateCheck[] {
  const valid = BusinessPolicySchema.safeParse(policy);
  const unapproved = requiredPaths(policy).filter((p) => policy.provenance[p]?.status !== "approved");
  return [
    check("policy_valid", "The latest policy is valid", valid.success ? [] : ["the policy does not pass validation"]),
    check("rules_approved", "Every required rule is approved", unapproved.length ? [`not approved: ${list(unapproved)}`] : []),
    check("coverage", "Every rule and its evidence match", coverageIssues(policy)),
    check(
      "rehearsal_current",
      "The rehearsal ran on this exact policy",
      !run ? ["no rehearsal yet"] : stale ? ["the policy changed since the last rehearsal"] : [],
    ),
    check("no_failures", "No engine test failed", run && run.summary.probesFailed > 0 ? [`${run.summary.probesFailed} probe(s) failed`] : []),
    check("no_critical_open", "No critical gap is open", run && run.summary.criticalOpen > 0 ? [`${run.summary.criticalOpen} critical gap(s) open`] : []),
  ];
}

/** Checklist + `canLaunch` from stored files only; nothing here trusts the browser. */
export function gateStatus(deps: Deps, sessionId: string): GateStatus {
  const { policy } = latestPolicy(deps, sessionId);
  const state = rehearsalState(deps, sessionId);
  const checks = runChecks(policy, state.run, state.stale);
  const required = requiredPaths(policy);
  return {
    canLaunch: checks.every((c) => c.ok),
    checks,
    policyVersion: state.policyVersion,
    policyHash: state.policyHash,
    approvals: { required: required.length, approved: required.filter((p) => policy.provenance[p]?.status === "approved").length },
  };
}

type GapRecord = LaunchRecord["rehearsal"]["gapsFound"][number];

/** Every gap seen in any run of this session; fixed ones carry the version that fixed them. */
function gapsFound(deps: Deps, sessionId: string, finalRun: RunResult): GapRecord[] {
  const fixes = deps.store.readExtra<FixLogEntry[]>(sessionId, "fixes") ?? [];
  const dismissals = new Map(readDismissals(deps, sessionId).map((d) => [d.gapId, d.version]));
  const open = new Map(finalRun.gaps.map((g) => [g.id, g]));
  const seen = new Map<string, GapRecord>();
  for (const run of deps.store.listRuns<RunResult>(sessionId)) {
    for (const g of run.gaps) {
      const stillThere = open.get(g.id);
      const fixedIn = stillThere
        ? (stillThere.dismissed ? (dismissals.get(g.id) ?? finalRun.policyVersion) : null)
        : (fixes.findLast((f) => f.gapId === g.id)?.toVersion ?? finalRun.policyVersion);
      seen.set(g.id, { id: g.id, severity: g.severity, code: g.code, fixedInVersion: fixedIn });
    }
  }
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

const blocked = (status: GateStatus): LauncherError =>
  new LauncherError(
    "GATE_BLOCKED",
    `launch gate blocked: ${status.checks.filter((c) => !c.ok).map((c) => `${c.label} (${c.detail})`).join("; ")}`,
    HTTP_CONFLICT,
  );

function readKeys(paths: GatePaths): { privateKey: string; publicKey: string } {
  const priv = path.join(paths.secretsDir, PRIVATE_KEY_FILE);
  const pub = path.join(paths.secretsDir, PUBLIC_KEY_FILE);
  if (!existsSync(priv) || !existsSync(pub))
    throw new LauncherError("KEYS_MISSING", "No signing key pair: run scripts/gen-keys.ts first.", 500);
  return { privateKey: readFileSync(priv, "utf8").trim(), publicKey: readFileSync(pub, "utf8").trim() };
}

/** Signs, then proves the pair belongs together by verifying with the public file. Errors never carry key text. */
function signWith(record: LaunchRecord, keys: { privateKey: string; publicKey: string }): SignedLaunchRecord {
  const mismatch = new LauncherError("KEYS_MISMATCH", "The private and public signing keys do not belong together.", 500);
  let signed: SignedLaunchRecord;
  try {
    signed = signLaunchRecord(record, keys.privateKey);
  } catch {
    throw mismatch;
  }
  if (!verifyLaunchRecord(signed, keys.publicKey)) throw mismatch;
  return signed;
}

function writeAtomic(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

export interface LaunchResult {
  record: LaunchRecord;
  bundleDir: string;
  policyVersion: number;
  policyHash: string;
}

export interface LaunchOptions {
  /** The owner pressed "Launch" (05 §6 item 4). */
  consent: boolean;
  paths?: GatePaths;
}

/**
 * Re-checks the gate, then signs the LaunchRecord with the private key from `.agentdoor/secrets`
 * and writes `bundle/policy.json` + `bundle/launch-record.json` exactly where the deploy script
 * reads them. The private key is read, used and dropped: it is never logged, returned or written.
 */
export function launch(deps: Deps, sessionId: string, opts: LaunchOptions): LaunchResult {
  if (!opts.consent)
    throw new LauncherError("CONSENT_REQUIRED", "Launching needs the owner's explicit consent.", HTTP_BAD_REQUEST);
  const status = gateStatus(deps, sessionId);
  if (!status.canLaunch) throw blocked(status);

  const paths = opts.paths ?? DEFAULT_GATE_PATHS;
  const { policy, version } = latestPolicy(deps, sessionId);
  const run = rehearsalState(deps, sessionId).run!;
  const keys = readKeys(paths);
  const record: LaunchRecord = {
    v: 1,
    shop: policy.business.slug,
    policyVersion: version,
    policyHash: status.policyHash,
    rehearsal: {
      runId: run.runId,
      ranAt: run.ranAt,
      probes: run.summary.probes,
      scenarios: run.summary.scenarios,
      passed: run.summary.passed,
      gapsFound: gapsFound(deps, sessionId, run),
      criticalOpen: run.summary.criticalOpen,
      resultsHash: run.resultsHash,
    },
    approvals: status.approvals,
    publicKey: keys.publicKey,
    signedAt: now().toISOString(),
  };
  const signed = signWith(record, keys);

  writeAtomic(path.join(paths.bundleDir, "policy.json"), `${JSON.stringify(policy, null, 2)}\n`);
  writeAtomic(path.join(paths.bundleDir, "launch-record.json"), `${JSON.stringify(signed, null, 2)}\n`);
  return { record, bundleDir: paths.bundleDir, policyVersion: version, policyHash: policyHash(policy) };
}
