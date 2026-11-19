import { randomBytes } from "node:crypto";
import {
  canonicalJson,
  classifyProbeResult,
  evaluate,
  generateProbes,
  lintPolicy,
  policyHash,
  runProbes,
  sha256Hex,
  type BusinessPolicy,
  type EngineOutcome,
  type Gap,
  type ProbeResult,
} from "@agentdoor/core";
import { now, todayIst } from "../claude/clock.js";
import { HTTP_NOT_FOUND, LauncherError } from "../claude/errors.js";
import type { Deps } from "./compile.js";
import { latestPolicy } from "./policyEdit.js";
import { loadScenarios, resolveScenarios, runScenarios, type ScenarioWire } from "./scenarios.js";

export interface RunGap extends Gap {
  /** The owner accepted this scenario outcome ("Actually that's fine"). */
  dismissed: boolean;
  /** The triggering probe or customer message, shown on the gap card. */
  example: string | null;
}

export interface RunResult {
  runId: string;
  /** 1, 2, ... within the session: the newest run is the one the gate reads. */
  seq: number;
  sessionId: string;
  policyVersion: number;
  policyHash: string;
  ranAt: string;
  probes: ProbeResult[];
  scenarios: {
    id: string;
    customerMessage: string;
    ownerWouldWant: string;
    outcome: EngineOutcome;
    reasonCodes: string[];
    matched: boolean;
  }[];
  droppedScenarios: number;
  gaps: RunGap[];
  summary: {
    probes: number;
    probesPassed: number;
    probesFailed: number;
    scenarios: number;
    passed: number;
    criticalOpen: number;
    warningsOpen: number;
  };
  resultsHash: string;
  scenarioSource: { fromFixture: boolean; cached: boolean; costUsd: number; model: string };
}

export interface Progress {
  phase: "starting" | "probes" | "scenarios" | "classifying" | "done";
  done: number;
  total: number;
}

export interface RunStatus {
  runId: string;
  sessionId: string;
  status: "running" | "done" | "failed";
  progress: Progress;
  error?: { code: string; message: string };
  result?: RunResult;
}

export interface Dismissal {
  gapId: string;
  version: number;
  at: string;
}

type Evaluator = typeof evaluate;

/** What one run established, before it is summarised and stored. */
interface Judged {
  version: number;
  hash: string;
  probes: ProbeResult[];
  outcomes: ReturnType<typeof runScenarios>;
  dropped: number;
  gaps: RunGap[];
  set: Awaited<ReturnType<typeof loadScenarios>>;
}

const RUN_ID_BYTES = 6;
const SEED_HEX_CHARS = 8;
const HEX = 16;

export const readDismissals = (deps: Deps, sessionId: string): Dismissal[] =>
  deps.store.readExtra<Dismissal[]>(sessionId, "dismissals") ?? [];

/** The newest finished run of a session (any policy version), or null. */
export function latestRun(deps: Deps, sessionId: string): RunResult | null {
  return deps.store.listRuns<RunResult>(sessionId).at(-1) ?? null;
}

export interface RehearsalState {
  run: RunResult | null;
  /** True when there is no run, or the policy changed since it ran. */
  stale: boolean;
  policyVersion: number;
  policyHash: string;
}

export function rehearsalState(deps: Deps, sessionId: string): RehearsalState {
  const { version, policy } = latestPolicy(deps, sessionId);
  const hash = policyHash(policy);
  const run = latestRun(deps, sessionId);
  return { run, stale: !run || run.policyHash !== hash, policyVersion: version, policyHash: hash };
}

const count = <T>(xs: T[], f: (x: T) => boolean): number => xs.filter(f).length;

function toRunGaps(gaps: Gap[], examples: Map<string, string>, dismissed: Set<string>): RunGap[] {
  const unique = gaps.filter((g, i) => gaps.findIndex((x) => x.id === g.id) === i);
  const withInfo = unique.map((g) => ({ ...g, dismissed: dismissed.has(g.id), example: examples.get(g.id) ?? null }));
  // Critical first, stable otherwise, so the card list starts with what blocks the launch.
  return [...withInfo].sort((a, b) => Number(b.severity === "critical") - Number(a.severity === "critical"));
}

/** Everything that was judged, as exact integers/strings, so two machines hash the same run alike. */
function resultsHashOf(probes: ProbeResult[], scenarios: RunResult["scenarios"], gaps: RunGap[]): string {
  return sha256Hex(
    canonicalJson({
      probes: probes.map((p) => ({ id: p.probeId, family: p.family, status: p.status })),
      scenarios: scenarios.map((s) => ({ id: s.id, outcome: s.outcome, matched: s.matched })),
      gaps: gaps.map((g) => ({ id: g.id, severity: g.severity, dismissed: g.dismissed })),
    }),
  );
}

/** The deterministic engine probes for one policy: pure, free, and the same on every machine. */
export function runProbeChecks(policy: BusinessPolicy, hash: string, nowMs: number, evalFn: Evaluator = evaluate): ProbeResult[] {
  const probes = generateProbes(policy, nowMs, Number.parseInt(hash.slice(0, SEED_HEX_CHARS), HEX));
  return runProbes(policy, probes, evalFn);
}

export interface JudgeInput {
  policy: BusinessPolicy;
  /** The owner's words, for the linter's evidence checks. */
  transcript: string;
  probeResults: ProbeResult[];
  scenarios: ScenarioWire[];
  /** IST date the scenarios' `daysAhead` counts from. */
  today: string;
  nowMs: number;
  dismissed: Set<string>;
  evalFn?: Evaluator;
}

/** Scenarios through the engine, then every finding (lint, probes, scenarios) as one de-duplicated gap list. */
export function judgeScenarios(i: JudgeInput): { outcomes: ReturnType<typeof runScenarios>; dropped: number; gaps: RunGap[] } {
  const { valid, dropped } = resolveScenarios(i.scenarios, i.today);
  const outcomes = runScenarios(i.policy, valid, i.nowMs, i.evalFn ?? evaluate);
  const examples = new Map<string, string>();
  for (const o of outcomes) if (o.gap) examples.set(o.gap.id, o.customerMessage);
  for (const r of i.probeResults.filter((p) => p.status !== "PASS"))
    examples.set(`${r.status === "FAIL" ? "ENGINE_PROBE_FAILED" : "PROBE_NEEDS_OWNER"}:${r.probeId}`, r.detail);
  const gaps = toRunGaps(
    [
      ...lintPolicy(i.policy, { transcript: i.transcript }),
      ...i.probeResults.flatMap((r) => classifyProbeResult(r) ?? []),
      ...outcomes.flatMap((o) => o.gap ?? []),
    ],
    examples,
    i.dismissed,
  );
  return { outcomes, dropped, gaps };
}

export interface AssembleInput {
  runId: string;
  seq: number;
  sessionId: string;
  version: number;
  hash: string;
  ranAt: string;
  probes: ProbeResult[];
  outcomes: ReturnType<typeof runScenarios>;
  dropped: number;
  gaps: RunGap[];
  source: RunResult["scenarioSource"];
}

/** Summarises one judged run into the stored result shape (the gate and the launch record read it). */
export function assembleRun(a: AssembleInput): RunResult {
  const scenarios = a.outcomes.map(({ gap, ...o }) => ({ ...o, matched: gap === null }));
  const probesPassed = count(a.probes, (p) => p.status === "PASS");
  const open = a.gaps.filter((g) => !g.dismissed);
  return {
    runId: a.runId,
    seq: a.seq,
    sessionId: a.sessionId,
    policyVersion: a.version,
    policyHash: a.hash,
    ranAt: a.ranAt,
    probes: a.probes,
    scenarios,
    droppedScenarios: a.dropped,
    gaps: a.gaps,
    summary: {
      probes: a.probes.length,
      probesPassed,
      probesFailed: count(a.probes, (p) => p.status === "FAIL"),
      scenarios: scenarios.length,
      passed: probesPassed + count(scenarios, (s) => s.matched),
      criticalOpen: count(open, (g) => g.severity === "critical"),
      warningsOpen: count(open, (g) => g.severity === "warning"),
    },
    resultsHash: resultsHashOf(a.probes, scenarios, a.gaps),
    scenarioSource: a.source,
  };
}

export class Rehearsals {
  private readonly live = new Map<string, RunStatus>();
  private readonly pending = new Map<string, Promise<void>>();

  constructor(
    private readonly deps: Deps,
    private readonly opts: { evaluate?: Evaluator } = {},
  ) {}

  /** Starts a run in the background and returns at once; poll `get(runId)` for progress and results. */
  start(sessionId: string): RunStatus {
    latestPolicy(this.deps, sessionId); // 404/409 before anything is started
    const runId = `r_${randomBytes(RUN_ID_BYTES).toString("hex")}`;
    const status: RunStatus = { runId, sessionId, status: "running", progress: { phase: "starting", done: 0, total: 0 } };
    this.live.set(runId, status);
    this.pending.set(
      runId,
      this.execute(status).finally(() => this.pending.delete(runId)),
    );
    return status;
  }

  get(runId: string): RunStatus {
    const live = this.live.get(runId);
    if (live) return live;
    const sessionId = this.deps.store.findRunSession(runId);
    const result = sessionId ? this.deps.store.readRun<RunResult>(sessionId, runId) : null;
    if (!sessionId || !result) throw new LauncherError("RUN_NOT_FOUND", "No such rehearsal run.", HTTP_NOT_FOUND);
    return { runId, sessionId, status: "done", progress: { phase: "done", done: 1, total: 1 }, result };
  }

  /** Resolves when the run has finished (done or failed). */
  settled(runId: string): Promise<void> {
    return this.pending.get(runId) ?? Promise.resolve();
  }

  private async execute(status: RunStatus): Promise<void> {
    try {
      status.result = await this.run(status);
      status.status = "done";
      status.progress = { phase: "done", done: 1, total: 1 };
    } catch (e) {
      status.status = "failed";
      status.error =
        e instanceof LauncherError
          ? { code: e.code, message: e.message }
          : { code: "INTERNAL", message: "The rehearsal could not finish." };
    }
  }

  private async run(status: RunStatus): Promise<RunResult> {
    const { deps } = this;
    const { session, version, policy } = latestPolicy(deps, status.sessionId);
    const hash = policyHash(policy);
    const nowMs = now().getTime();
    const evalFn = this.opts.evaluate ?? evaluate;

    const probeResults = runProbeChecks(policy, hash, nowMs, evalFn);
    status.progress = { phase: "probes", done: probeResults.length, total: probeResults.length };
    status.progress = { phase: "scenarios", done: 0, total: 0 };

    const set = await loadScenarios(deps, session, policy);
    const { outcomes, dropped, gaps } = judgeScenarios({
      policy,
      transcript: session.turns.join("\n"),
      probeResults,
      scenarios: set.scenarios,
      today: todayIst(now()),
      nowMs,
      dismissed: new Set(readDismissals(deps, session.id).map((d) => d.gapId)),
      evalFn,
    });
    status.progress = { phase: "classifying", done: outcomes.length, total: outcomes.length };
    return this.persist(status, { version, hash, probes: probeResults, outcomes, dropped, gaps, set });
  }

  private persist(status: RunStatus, judged: Judged): RunResult {
    const { version, hash, probes, outcomes, dropped, gaps, set } = judged;
    const result = assembleRun({
      runId: status.runId,
      seq: this.deps.store.listRuns(status.sessionId).length + 1,
      sessionId: status.sessionId,
      version,
      hash,
      ranAt: now().toISOString(),
      probes,
      outcomes,
      dropped,
      gaps,
      source: { fromFixture: set.fromFixture, cached: set.cached, costUsd: set.costUsd, model: set.model },
    });
    this.deps.store.writeRun(status.sessionId, result);
    return result;
  }
}
