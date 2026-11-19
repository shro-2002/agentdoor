import {
  BusinessPolicySchema,
  QuoteRequestSchema,
  addDays,
  classifyProbeResult,
  classifyScenario,
  evaluate,
  generateProbes,
  istDateOf,
  lintPolicy,
  policyHash,
  requiredPaths,
  runProbes,
  type BusinessPolicy,
  type EngineOutcome,
  type Gap,
  type ProbeResult,
  type QuoteRequest,
} from "@agentdoor/core";
import { getAt } from "./policy-paths.js";
import type { TrySession } from "./try-session.js";

/**
 * Everything on /try that is labelled LIVE is computed here, per request, from the recorded
 * policy versions and the current time. Pure functions of (session, version, nowMs): no model call,
 * no database, no file writes.
 */

const SEED_HEX_CHARS = 8;
const HEX = 16;
const MAX_DAYS_AHEAD = 90;
const MAX_RELATED_PATHS = 5;
/** The launcher's "that's fine" answer to a scenario gap: the owner accepted the outcome. */
const DISMISS = "dismiss";

export interface LiveRun {
  version: number;
  policyHash: string;
  ranAtMs: number;
  probes: ProbeResult[];
  scenarios: { id: string; customerMessage: string; outcome: EngineOutcome; matched: boolean }[];
  gaps: (Gap & { dismissed: boolean; example: string | null })[];
  summary: { probes: number; probesPassed: number; probesFailed: number; scenarios: number; passed: number; criticalOpen: number; warningsOpen: number };
}

export interface GateCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

const count = <T>(xs: T[], f: (x: T) => boolean): number => xs.filter(f).length;

/** The owner's words as the lint saw them in the launcher: the description, then each Q and A. */
function ownerWords(session: TrySession): string {
  const asked = new Map(session.compile.result.questions.map((q) => [q.id, q.text]));
  const turns = session.answers.map((a) => `Q: ${asked.get(a.questionId) ?? a.questionId}\nA: ${a.text}`);
  return [session.transcript, ...turns].join("\n");
}

const dismissedIds = (session: TrySession): Set<string> => new Set(session.gapFixes.filter((f) => f.choice === DISMISS).map((f) => f.gapId));

/** `daysAhead` -> a real date against today's IST date, by code (model output is data, not dates). */
function resolveScenarios(session: TrySession, nowMs: number): { wire: TrySession["scenarios"][number]; request: QuoteRequest }[] {
  const today = istDateOf(nowMs);
  return session.scenarios.flatMap((wire) => {
    const { daysAhead, fulfilment, lines, notes } = wire.request;
    if (!Number.isInteger(daysAhead) || daysAhead < 0 || daysAhead > MAX_DAYS_AHEAD) return [];
    const parsed = QuoteRequestSchema.safeParse({
      lines,
      fulfilment: fulfilment.kind === "pickup" ? { kind: "pickup" } : { kind: "delivery", area: fulfilment.area ?? undefined },
      date: addDays(today, daysAhead),
      ...(notes === null ? {} : { notes }),
    });
    return parsed.success ? [{ wire, request: parsed.data }] : [];
  });
}

export function runLive(session: TrySession, version: number, nowMs: number): LiveRun {
  const policy = session.policyVersions[version - 1]!;
  const hash = policyHash(policy);
  const probes = runProbes(policy, generateProbes(policy, nowMs, Number.parseInt(hash.slice(0, SEED_HEX_CHARS), HEX)));
  const examples = new Map<string, string>();
  const scenarioGaps: Gap[] = [];
  const scenarios = resolveScenarios(session, nowMs).map(({ wire, request }) => {
    const result = evaluate(policy, request, nowMs);
    const related = wire.relatedPaths.filter((p) => getAt(policy, p).found).slice(0, MAX_RELATED_PATHS);
    const gap = classifyScenario({ id: wire.id, ownerWouldWant: wire.ownerWouldWant, relatedPaths: related }, result);
    if (gap) {
      scenarioGaps.push(gap);
      examples.set(gap.id, wire.customerMessage);
    }
    return { id: wire.id, customerMessage: wire.customerMessage, outcome: result.outcome, matched: gap === null };
  });
  for (const r of probes.filter((p) => p.status !== "PASS")) examples.set(`${r.status === "FAIL" ? "ENGINE_PROBE_FAILED" : "PROBE_NEEDS_OWNER"}:${r.probeId}`, r.detail);
  const all = [...lintPolicy(policy, { transcript: ownerWords(session) }), ...probes.flatMap((r) => classifyProbeResult(r) ?? []), ...scenarioGaps];
  const dismissed = dismissedIds(session);
  const gaps = all
    .filter((g, i) => all.findIndex((x) => x.id === g.id) === i)
    .map((g) => ({ ...g, dismissed: dismissed.has(g.id), example: examples.get(g.id) ?? null }))
    .sort((a, b) => Number(b.severity === "critical") - Number(a.severity === "critical"));
  const open = gaps.filter((g) => !g.dismissed);
  const probesPassed = count(probes, (p) => p.status === "PASS");
  return {
    version,
    policyHash: hash,
    ranAtMs: nowMs,
    probes,
    scenarios,
    gaps,
    summary: {
      probes: probes.length,
      probesPassed,
      probesFailed: count(probes, (p) => p.status === "FAIL"),
      scenarios: scenarios.length,
      passed: probesPassed + count(scenarios, (s) => s.matched),
      criticalOpen: count(open, (g) => g.severity === "critical"),
      warningsOpen: count(open, (g) => g.severity === "warning"),
    },
  };
}

/** The version the replay opens on: the first one with a critical gap, so the story starts at the problem. */
export function firstProblemVersion(session: TrySession, nowMs: number): number {
  const last = session.policyVersions.length;
  for (let v = 1; v <= last; v++) if (runLive(session, v, nowMs).summary.criticalOpen > 0) return v;
  return last;
}

/** Every required rule has provenance and every provenance key is a real rule (the launcher's coverage check). */
function coverageProblems(policy: BusinessPolicy): string[] {
  const missing = requiredPaths(policy).filter((p) => !(p in policy.provenance));
  const orphans = Object.keys(policy.provenance).filter((p) => !getAt(policy, p).found);
  return [...(missing.length ? [`no provenance for ${missing.length} rule(s)`] : []), ...(orphans.length ? [`${orphans.length} provenance entries match no rule`] : [])];
}

const check = (id: string, label: string, problems: string[]): GateCheck => ({ id, label, ok: problems.length === 0, detail: problems.length === 0 ? "ok" : problems.join("; ") });

/** The launch gate's checklist, computed now on the final recorded version. */
export function gateChecks(session: TrySession, run: LiveRun): GateCheck[] {
  const policy = session.policyVersions[run.version - 1]!;
  const unapproved = requiredPaths(policy).filter((p) => policy.provenance[p]?.status !== "approved");
  return [
    check("policy_valid", "The final policy is valid", BusinessPolicySchema.safeParse(policy).success ? [] : ["fails validation"]),
    check("rules_approved", "Every required rule is approved", unapproved.length ? [`${unapproved.length} not approved`] : []),
    check("coverage", "Every rule and its evidence match", coverageProblems(policy)),
    check("rehearsal_current", "The rehearsal ran on this exact policy", []),
    check("no_failures", "No engine test failed", run.summary.probesFailed > 0 ? [`${run.summary.probesFailed} failed`] : []),
    check("no_critical_open", "No critical gap is open", run.summary.criticalOpen > 0 ? [`${run.summary.criticalOpen} open`] : []),
  ];
}

/** Which recorded decision (if any) settled a gap, and the version it landed in. */
export function decisionFor(session: TrySession, gapId: string): { choice: string; toVersion: number } | null {
  const fix = session.gapFixes.findLast((f) => f.gapId === gapId);
  return fix ? { choice: fix.choice, toVersion: fix.toVersion } : null;
}
