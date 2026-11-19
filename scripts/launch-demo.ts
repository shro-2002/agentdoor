// Usage: npx tsx scripts/launch-demo.ts [--replay | --fresh]
// T13 launch of "Meera's Kitchen" — an illustrative persona based on common home-bakery practices
// (NOT a real customer). Drives the launcher's own routes in-process on a free loopback port with the
// real ClaudeClient (record mode = live calls that are also written to .agentdoor/launch-fixtures, so a
// failed run can be finished with --replay without paying twice), then exports bundle/try/session.json.
// Default: refuses to start if recorded fixtures already exist (--replay reuses them, --fresh pays again).
// It resets only its own session folder + fixtures; keys and secrets are never touched or printed.
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeClient, DEFAULT_USAGE_PATH, type LlmMode } from "../apps/launcher/src/claude/client.js";
import { UsageLog } from "../apps/launcher/src/claude/budget.js";
import { now } from "../apps/launcher/src/claude/clock.js";
import type { Deps } from "../apps/launcher/src/flows/compile.js";
import { exportDemo } from "../apps/launcher/src/flows/exportDemo.js";
import { commitVersion, latestPolicy } from "../apps/launcher/src/flows/policyEdit.js";
import { DEFAULT_GATE_PATHS } from "../apps/launcher/src/flows/gate.js";
import { getAt } from "../apps/launcher/src/flows/paths.js";
import type { RunResult } from "../apps/launcher/src/flows/rehearse.js";
import { createApp } from "../apps/launcher/src/routes/app.js";
import { DEFAULT_STORE_ROOT, FsStore } from "../apps/launcher/src/store/fsStore.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AGENTDOOR_DIR = path.join(ROOT, ".agentdoor");
const FIXTURES_DIR = path.join(AGENTDOOR_DIR, "launch-fixtures");
const STATE_FILE = path.join(AGENTDOOR_DIR, "launch-demo.json");
const TRANSCRIPT = path.join(ROOT, "apps/launcher/fixtures/transcripts/seeded-leaky.txt");
const FIXTURE_KEY = "meera-launch";
const PERSONA = "Meera's Kitchen — illustrative persona based on common home-bakery practices (not a real customer)";
const BUDGET_USD = 1.5;
const MAX_REHEARSALS = 5;
const FIRST_FIX_ROUND = 2; // the round that applies the first typed fixes
const MAX_VERSIONS_SAFE = 46; // the public session holds at most 50 policy versions
const POLL_MS = 500;
const POLL_LIMIT = 600;
const LOOPBACK = "127.0.0.1";

/** The three rules the transcript deliberately omits: their questions stay unanswered. */
const OMITTED = ["capacity.unitsPerDay", "rush.maxRushUnitsPerDay", "fulfilment.delivery.unlistedArea"];
/** What the owner would type for each omitted rule once the rehearsal shows the gap. */
const FIX_CHOICE: Record<string, string> = {
  "capacity.unitsPerDay": "units-10",
  "rush.maxRushUnitsPerDay": "rush-cap-2",
  "fulfilment.delivery.unlistedArea": "unlisted-refuse",
};
/** Transcript-consistent answers for questions that are not about the omitted rules. */
const KNOWN_ANSWERS: Record<string, string> = {
  "orderRules.customRequests": "If someone wants a custom design, I want to be asked first.",
  "schedule.closedWeekdays": "Only Mondays are closed, every other day I work.",
  "fulfilment.pickup.enabled": "Yes, pickup from my place in Baner is free.",
};
const RUSH_CAP = "rush.maxRushUnitsPerDay";
const TYPED_RUSH = "typed-rush-cap";
const RUSH_CAP_UNITS = 2;
const GENERIC_ANSWER = "Please go with what I told you above; I have nothing more to add on this.";
const NOT_SURE = "I am not sure yet.";

const isOmitted = (p: string): boolean => OMITTED.some((o) => p === o || p.startsWith(`${o}.`));
const log = (m: string): void => console.log(m);

class Stop extends Error {}
const stop = (m: string): never => {
  throw new Stop(m);
};

interface Api {
  call<T = any>(method: "GET" | "POST", url: string, body?: unknown): Promise<T>;
}

function makeApi(base: string): Api {
  return {
    async call(method, url, body) {
      const res = await fetch(`${base}${url}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json = (await res.json()) as { data: any; error: { code: string; message: string } | null };
      if (!res.ok || json.error) return stop(`${method} ${url} -> ${res.status} ${json.error?.code}: ${json.error?.message}`);
      return json.data;
    },
  };
}

function readNumbers(text: string): number[] {
  return [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

/** Low-confidence rules are approved only when their value visibly matches the owner's own words. */
function consistent(value: unknown, quote: string): boolean {
  if (typeof value === "number") {
    const nums = readNumbers(quote);
    return [value, value / 100, value / 24, value / 60].some((c) => nums.includes(c));
  }
  if (typeof value === "string") return value.length > 2 && quote.toLowerCase().includes(value.toLowerCase());
  return false;
}

async function clarify(api: Api, sessionId: string, questions: { id: string; path: string; text: string }[]): Promise<string> {
  const kept = questions.filter((q) => !isOmitted(q.path));
  const held = questions.filter((q) => isOmitted(q.path));
  let answers = kept.map((q) => ({ questionId: q.id, text: KNOWN_ANSWERS[q.path] ?? GENERIC_ANSWER }));
  let note = `answered ${kept.length}, left ${held.length} omitted-rule question(s) unanswered (${held.map((q) => q.path).join(", ") || "none asked"})`;
  if (answers.length === 0 && held[0]) {
    answers = [{ questionId: held[0].id, text: NOT_SURE }];
    note = `the flow needs at least one answer and only omitted-rule questions were asked: answered "${held[0].path}" with "not sure yet"; ${held.length - 1} left unanswered`;
  }
  if (answers.length === 0) return "Claude asked no questions: clarify round skipped";
  await api.call("POST", `/api/session/${sessionId}/answers`, { answers });
  return note;
}

async function approveStated(api: Api, store: FsStore, sessionId: string): Promise<{ approved: string[]; left: string[] }> {
  const policy = store.readPolicy(sessionId, store.latestVersion(sessionId));
  const approved: string[] = [];
  const left: string[] = [];
  for (const [p, prov] of Object.entries(policy.provenance)) {
    if (prov.status === "approved" || isOmitted(p)) continue;
    const value = getAt(policy, p).value;
    const quote = prov.source.kind === "transcript" ? prov.source.quote : null;
    const ok = quote !== null && (prov.confidence !== "low" || consistent(value, quote));
    if (quote !== null && prov.confidence === "low") log(`  low-confidence ${p} = ${JSON.stringify(value)} | quote "${quote}" -> ${ok ? "approved" : "NOT approved"}`);
    if (ok) {
      if (store.latestVersion(sessionId) >= MAX_VERSIONS_SAFE) stop("too many policy versions for the public session");
      await api.call("POST", `/api/session/${sessionId}/rules/${encodeURIComponent(p)}/approve`);
      approved.push(p);
    } else left.push(p);
  }
  return { approved, left };
}

async function rehearse(api: Api, sessionId: string): Promise<RunResult> {
  const { runId } = await api.call<{ runId: string }>("POST", `/api/session/${sessionId}/rehearse`);
  for (let i = 0; i < POLL_LIMIT; i++) {
    const run = await api.call<{ status: string; error?: { code: string; message: string }; result?: RunResult }>("GET", `/api/runs/${runId}`);
    if (run.status === "failed") return stop(`rehearsal failed: ${run.error?.code}: ${run.error?.message}`);
    if (run.result) return run.result;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return stop("rehearsal timed out");
}

const critical = (r: RunResult) => r.gaps.filter((g) => g.severity === "critical" && !g.dismissed);

/** The typed answer the owner would give for one open critical gap, or null if it is not one we may answer. */
function fixFor(gap: RunResult["gaps"][number], store: FsStore, sessionId: string): { choice: string } | "later" | null {
  const typed = gap.paths.find((p) => FIX_CHOICE[p]);
  const approval = gap.code === "UNAPPROVED_RULE" || gap.code === "LOW_CONFIDENCE_SOURCE";
  if (typed && !approval && gap.code !== "SCENARIO_UNHANDLED") return { choice: FIX_CHOICE[typed]! };
  // Approval gaps on the omitted rules and scenario gaps are settled by the typed fixes; only if they survive is that a problem.
  // The rush cap is a template default here (3), so no rehearsal card offers the owner's 2: she types it (see ownerTypesRushCap).
  if (approval && typed === RUSH_CAP) return { choice: TYPED_RUSH };
  if ((approval && typed) || gap.code === "SCENARIO_UNHANDLED") return "later";
  if (approval) {
    const p = gap.paths[0] ?? "";
    const prov = store.readPolicy(sessionId, store.latestVersion(sessionId)).provenance[p];
    // Template defaults the owner confirms, or stated rules; never the omitted three.
    return isOmitted(p) || !prov ? null : { choice: "approve" };
  }
  return null;
}

/** The owner types "2 rush units a day": a new policy version with her edit as approved provenance. */
function ownerTypesRushCap(deps: Deps, sessionId: string): void {
  const { policy, version } = latestPolicy(deps, sessionId);
  const next = structuredClone(policy);
  if (!next.rush) return;
  next.rush.maxRushUnitsPerDay = RUSH_CAP_UNITS;
  next.provenance[RUSH_CAP] = {
    source: { kind: "owner_edit", note: "Owner typed: at most 2 rush units a day (rehearsal fix)" },
    readback: { lang: "en", text: `At most ${RUSH_CAP_UNITS} rush units a day` },
    confidence: "high",
    status: "approved",
    approvedAt: now().toISOString(),
  };
  log(`  ${RUSH_CAP} (now ${policy.rush?.maxRushUnitsPerDay}) -> owner types ${RUSH_CAP_UNITS}`);
  commitVersion(deps, sessionId, next, { kind: "owner_edit", path: RUSH_CAP, fromVersion: version });
}

async function fixUntilClean(api: Api, deps: Deps, sessionId: string): Promise<{ first: RunResult; last: RunResult }> {
  const store = deps.store;
  let run = await rehearse(api, sessionId);
  const first = run;
  log(`rehearsal 1: ${run.summary.probes} probes, ${run.summary.scenarios} scenarios, critical ${critical(run).length}, warnings ${run.summary.warningsOpen}`);
  for (const g of critical(run)) log(`  gap ${g.code} [${g.paths.join(", ")}]`);
  for (let n = 2; critical(run).length > 0 && n <= MAX_REHEARSALS + 1; n++) {
    const gaps = [...critical(run)].sort((a, b) => Number(!FIX_CHOICE[a.paths[0] ?? ""]) - Number(!FIX_CHOICE[b.paths[0] ?? ""]));
    for (const g of gaps) {
      const fix = fixFor(g, store, sessionId);
      if (fix === "later") {
        if (n <= FIRST_FIX_ROUND) continue;
        if (g.code !== "SCENARIO_UNHANDLED") return stop(`${g.code} [${g.paths.join(", ")}] survived the typed fixes; handle it by hand and rerun with --replay`);
        // A scenario no typed rule can explain: the engine followed the owner's stated rules, so she accepts it ("Actually, that is fine").
        const s = run.scenarios.find((x) => g.id.endsWith(`:${x.id}`));
        log(`  owner accepts scenario ${s?.id}: "${s?.customerMessage}" -> ${s?.outcome} ${s?.reasonCodes.join(",")} (wanted ${s?.ownerWouldWant})`);
        await api.call("POST", `/api/session/${sessionId}/gaps/${encodeURIComponent(g.id)}/fix`, { choice: "dismiss" });
        continue;
      }
      if (!fix) return stop(`no owner-consistent fix for critical gap ${g.code} [${g.paths.join(", ")}]; fix by hand and rerun with --replay`);
      if (fix.choice === TYPED_RUSH) {
        ownerTypesRushCap(deps, sessionId);
        continue;
      }
      const current = getAt(store.readPolicy(sessionId, store.latestVersion(sessionId)), g.paths[0] ?? "").value;
      log(`  ${g.code} [${g.paths[0]}] (now ${JSON.stringify(current)}) -> ${fix.choice}`);
      await api.call("POST", `/api/session/${sessionId}/gaps/${encodeURIComponent(g.id)}/fix`, { choice: fix.choice });
    }
    run = await rehearse(api, sessionId);
    log(`rehearsal ${n}: critical ${critical(run).length}, warnings ${run.summary.warningsOpen}`);
  }
  if (critical(run).length > 0) stop(`${critical(run).length} critical gap(s) still open after ${MAX_REHEARSALS} fix rounds`);
  return { first, last: run };
}

const kb = (file: string): string => (existsSync(file) ? `${(statSync(file).size / 1024).toFixed(1)} KB` : "missing");

function summarise(usagePath: string, sessionId: string, mode: LlmMode, runs: { first: RunResult; last: RunResult }, hash: string): void {
  const rows = new UsageLog(usagePath).rows().filter((r) => r.sessionId === sessionId);
  log(`\n=== SUMMARY: ${PERSONA} ===`);
  log(`critical gaps before: ${critical(runs.first).length} (all open incl. warnings ${runs.first.gaps.filter((g) => !g.dismissed).length}) -> after: ${runs.last.summary.criticalOpen}`);
  log(`Claude calls: ${rows.length}${mode === "replay" ? " (recorded live calls of the paid run, replayed from fixtures; this run cost $0)" : " (live)"}`);
  let tin = 0;
  let tout = 0;
  for (const r of rows) {
    tin += r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens;
    tout += r.usage.outputTokens;
    log(`  ${r.flow} ${r.fixtureId} attempt ${r.attempt} ${r.model}: in ${r.usage.inputTokens} (+cache r${r.usage.cacheReadTokens}/w${r.usage.cacheWriteTokens}) out ${r.usage.outputTokens} $${r.costUsd.toFixed(4)}`);
  }
  log(`total tokens in ${tin} out ${tout}; total $${rows.reduce((t, r) => t + r.costUsd, 0).toFixed(4)}`);
  log(`policyHash: ${hash}`);
  for (const f of ["policy.json", "launch-record.json", "try/session.json"]) log(`bundle/${f}: ${kb(path.join(DEFAULT_GATE_PATHS.bundleDir, f))}`);
}

/** A replay costs nothing, so the export would say 0 calls: show the recorded live calls under the new session id instead. */
function replayUsage(liveSessionId: string | null, sessionId: string): string {
  const file = path.join(AGENTDOOR_DIR, "tmp", "launch-replay-usage.jsonl");
  const rows = liveSessionId ? new UsageLog(DEFAULT_USAGE_PATH).rows().filter((r) => r.sessionId === liveSessionId) : [];
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, rows.map((r) => `${JSON.stringify({ ...r, sessionId })}\n`).join(""));
  return file;
}

/** Returns the session whose live calls were paid for, read before the old session folder is removed. */
function resetOwnState(store: FsStore, replay: boolean, fresh: boolean): string | null {
  const have = existsSync(FIXTURES_DIR) && readdirSync(FIXTURES_DIR).length > 0;
  if (have && !replay && !fresh) stop("recorded fixtures exist: pass --replay (reuse, no cost) or --fresh (pay for a new live run)");
  if (replay && !have) stop("--replay needs recorded fixtures in .agentdoor/launch-fixtures");
  const state = existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as { sessionId?: string; liveSessionId?: string }) : {};
  if (state.sessionId) rmSync(store.sessionDir(state.sessionId), { recursive: true, force: true });
  if (fresh) rmSync(FIXTURES_DIR, { recursive: true, force: true });
  return fresh ? null : (state.liveSessionId ?? state.sessionId ?? null);
}

async function listen(app: ReturnType<typeof createApp>): Promise<{ server: Server; base: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, LOOPBACK, () => resolve({ server, base: `http://${LOOPBACK}:${(server.address() as { port: number }).port}` }));
    server.on("error", reject);
  });
}

async function main(): Promise<void> {
  const replay = process.argv.includes("--replay");
  const fresh = process.argv.includes("--fresh");
  const mode: LlmMode = replay ? "replay" : "record";
  const store = new FsStore(DEFAULT_STORE_ROOT);
  const liveSessionId = resetOwnState(store, replay, fresh);
  log(`Launching ${PERSONA}\nLLM mode: ${mode}${replay ? "" : " (live Claude calls, recorded)"}; budget guard $${BUDGET_USD}`);

  const prior = new UsageLog(DEFAULT_USAGE_PATH).totalSpend();
  const client = new ClaudeClient({ mode, fixturesDir: FIXTURES_DIR, maxUsdPerSession: BUDGET_USD, maxUsdTotal: prior + BUDGET_USD });
  const { server, base } = await listen(createApp({ client, store }));
  try {
    const api = makeApi(base);
    const transcript = readFileSync(TRANSCRIPT, "utf8").trim();
    const { sessionId } = await api.call<{ sessionId: string }>("POST", "/api/session", { language: "hinglish", transcript, fixtureKey: FIXTURE_KEY });
    mkdirSync(AGENTDOOR_DIR, { recursive: true });
    writeFileSync(STATE_FILE, `${JSON.stringify({ sessionId, liveSessionId: replay ? liveSessionId : sessionId })}\n`);
    const usagePath = replay ? replayUsage(liveSessionId, sessionId) : DEFAULT_USAGE_PATH;
    log(`1. described (${transcript.length} chars of Hinglish); session ${sessionId}`);

    const round0 = await api.call("POST", `/api/session/${sessionId}/compile`);
    const questions = round0.compileResult.questions as { id: string; path: string; text: string }[];
    log(`2. compiled: ${questions.length} question(s): ${questions.map((q) => q.path).join(", ") || "none"}`);
    log(`3. clarify: ${await clarify(api, sessionId, questions)}`);

    log("4. approving the rules the owner stated");
    const { approved, left } = await approveStated(api, store, sessionId);
    log(`  approved ${approved.length} stated rules; left for the owner's confirmation at rehearsal: ${left.join(", ") || "none"}`);

    log("5-6. rehearsal and typed fixes");
    const runs = await fixUntilClean(api, { client, store }, sessionId);

    const launched = await api.call("POST", `/api/session/${sessionId}/launch`, { consent: true });
    log(`7. gate passed; signed launch record written (policy v${launched.policyVersion})`);
    exportDemo({ store, usagePath }, { sessionId });
    log("8. bundle/try/session.json written (secret/PII scan passed)");
    summarise(usagePath, sessionId, mode, runs, launched.policyHash);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

main().catch((e: unknown) => {
  const err = e as { code?: string; message?: string };
  console.error(`launch-demo stopped: ${e instanceof Stop ? "" : `${err.code ?? "ERROR"}: `}${err.message ?? "unknown"}`);
  process.exitCode = 1;
});
