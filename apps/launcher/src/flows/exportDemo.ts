import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ScenarioWireSchema } from "@agentdoor/core";
import { DEFAULT_USAGE_PATH } from "../claude/client.js";
import { UsageLog } from "../claude/budget.js";
import { LauncherError } from "../claude/errors.js";
import type { FsStore } from "../store/fsStore.js";
import type { CompileResultWire } from "./compile-api.js";
import { toWire, type CompileApi } from "./compile-api.js";
import { DemoSessionSchema, type DemoSession } from "./demoSession.js";
import { loadSecretValues, scanForLeaks } from "./demoScan.js";
import type { FixLogEntry } from "./gapFix.js";
import { DEFAULT_GATE_PATHS } from "./gate.js";

const HTTP_UNPROCESSABLE = 422;
const MICRO = 1_000_000;
const DEPLOY_LOG_NAME = "deploy-log.json";

export interface ExportDeps {
  store: FsStore;
  usagePath?: string;
}

export interface ExportOptions {
  sessionId: string;
  /** Default: repo-root `bundle/` (the layout the deploy pack reads). */
  bundleDir?: string;
  secretsDir?: string;
  /** Names-only step log `[{step, ms, ok}]` written by the live deploy; absent = empty. */
  deployLogFile?: string;
}

interface CompileRecord {
  createdAt?: string;
  model?: string;
  costUsd?: number;
  latencyMs?: number;
  raw?: CompileApi;
}

const round6 = (n: number): number => Math.round(n * MICRO) / MICRO;

/** The first compile of the session: the one whose questions the owner answered. */
function firstCompile(deps: ExportDeps, sessionId: string, versions: number): { record: CompileRecord; wire: CompileResultWire } {
  for (let v = 1; v <= versions; v++) {
    const record = deps.store.readCompile(sessionId, v) as CompileRecord;
    const wire = record.raw ? toWire(record.raw) : null;
    if (wire?.ok) return { record, wire: wire.wire };
  }
  throw new LauncherError("NOT_COMPILED", "This session has no recorded compile to export.", HTTP_UNPROCESSABLE);
}

/** `Q: <text>\nA: <answer>` turns back into answers keyed by the question they answered. */
function answersOf(turns: string[], questions: CompileResultWire["questions"]): DemoSession["answers"] {
  return turns.slice(1).map((turn, i) => {
    const m = /^Q: ([\s\S]*?)\nA: ([\s\S]*)$/.exec(turn);
    const asked = questions.find((q) => q.text === m?.[1]);
    return { questionId: asked?.id ?? `q${i + 1}`, text: m?.[2] ?? turn };
  });
}

function readDeployLog(file: string): DemoSession["deployLog"] {
  if (!existsSync(file)) return [];
  const rows: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(rows)) return [];
  // Only the three names-only fields survive; anything else a deploy might have logged is dropped.
  return rows.flatMap((r: { step?: unknown; ms?: unknown; ok?: unknown }) =>
    typeof r?.step === "string" && Number.isInteger(r.ms) && typeof r.ok === "boolean" ? [{ step: r.step, ms: r.ms as number, ok: r.ok }] : [],
  );
}

function usageOf(usagePath: string, sessionId: string): DemoSession["usage"] {
  const rows = new UsageLog(usagePath).rows().filter((r) => r.sessionId === sessionId && r.mode !== "replay");
  return { calls: rows.length, totalUsd: round6(rows.reduce((t, r) => t + r.costUsd, 0)) };
}

export function buildDemoSession(deps: ExportDeps, opts: ExportOptions): DemoSession {
  const { store } = deps;
  const session = store.getSession(opts.sessionId);
  const versions = store.latestVersion(opts.sessionId);
  const { record, wire } = firstCompile(deps, opts.sessionId, versions);
  const scenarios = store.readExtra<{ scenarios: unknown[] }>(opts.sessionId, "scenarios")?.scenarios ?? [];
  const fixes = store.readExtra<FixLogEntry[]>(opts.sessionId, "fixes") ?? [];
  const deployLogFile = opts.deployLogFile ?? path.join(path.dirname(DEFAULT_GATE_PATHS.secretsDir), DEPLOY_LOG_NAME);
  return DemoSessionSchema.parse({
    v: 1,
    recordedAt: record.createdAt ?? session.createdAt,
    language: session.language,
    transcript: session.turns[0],
    compile: { result: wire, costUsd: round6(record.costUsd ?? 0), model: record.model ?? "unknown", latencyMs: record.latencyMs ?? 0 },
    answers: answersOf(session.turns, wire.questions),
    policyVersions: Array.from({ length: versions }, (_, i) => store.readPolicy(opts.sessionId, i + 1)),
    scenarios: scenarios.flatMap((s) => {
      const parsed = ScenarioWireSchema.safeParse(s);
      return parsed.success ? [parsed.data] : [];
    }),
    gapFixes: fixes.map(({ gapId, choice, fromVersion, toVersion }) => ({ gapId, choice, fromVersion, toVersion })),
    deployLog: readDeployLog(deployLogFile),
    usage: usageOf(deps.usagePath ?? DEFAULT_USAGE_PATH, opts.sessionId),
  });
}

/**
 * Builds the DemoSession from a stored launcher session, refuses it if the secret/PII scan finds
 * anything, and only then writes `bundle/try/session.json` (04 §9).
 */
export function exportDemo(deps: ExportDeps, opts: ExportOptions): DemoSession {
  const session = buildDemoSession(deps, opts);
  const text = `${JSON.stringify(session, null, 2)}\n`;
  const paths = { ...DEFAULT_GATE_PATHS, ...(opts.bundleDir ? { bundleDir: opts.bundleDir } : {}), ...(opts.secretsDir ? { secretsDir: opts.secretsDir } : {}) };
  const findings = scanForLeaks(text, loadSecretValues(paths.secretsDir));
  if (findings.length > 0)
    throw new LauncherError(
      "EXPORT_SCAN_FAILED",
      `Export blocked: the scan found ${findings.join(", ")} in the session. Remove it and export again.`,
      HTTP_UNPROCESSABLE,
    );
  const file = path.join(paths.bundleDir, "try", "session.json");
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
  return session;
}
