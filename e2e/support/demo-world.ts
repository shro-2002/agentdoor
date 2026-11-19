import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPair } from "@agentdoor/core";
import { ClaudeClient } from "../../apps/launcher/src/claude/client.js";
import { answerQuestions } from "../../apps/launcher/src/flows/clarify.js";
import { compileSession } from "../../apps/launcher/src/flows/compile.js";
import { approveAllHigh } from "../../apps/launcher/src/flows/approve.js";
import { exportDemo } from "../../apps/launcher/src/flows/exportDemo.js";
import { applyGapFix, fixOptions } from "../../apps/launcher/src/flows/gapFix.js";
import { launch } from "../../apps/launcher/src/flows/gate.js";
import { Rehearsals } from "../../apps/launcher/src/flows/rehearse.js";
import { FsStore } from "../../apps/launcher/src/store/fsStore.js";

/**
 * Builds the shop's `bundle/` the way the launcher does, in replay mode (recorded Claude fixtures,
 * no key, no network): compile, answer the questions, approve, rehearse, fix gaps, sign the launch
 * record (`launch`), and write `bundle/try/session.json` with the real `export-demo` code. Nothing
 * here touches the owner's real `.agentdoor` folder: everything lives in one temp directory.
 */
const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../apps/launcher/fixtures");
const MAX_ROUNDS = 6;
const FIX_VALUE = 10;

/** Step names and timings of a deploy, as the (future) real deploy log would hold them: names only. */
const DEPLOY_LOG = [
  { step: "gate check", ms: 80, ok: true },
  { step: "pack", ms: 1900, ok: true },
  { step: "upload", ms: 11200, ok: true },
  { step: "set secrets", ms: 2400, ok: true },
  { step: "preview boot", ms: 14800, ok: true },
  { step: "publish", ms: 13100, ok: true },
  { step: "smoke test", ms: 1700, ok: true },
];

export interface DemoWorld {
  dir: string;
  bundleDir: string;
  publicKey: string;
  privateKey: string;
}

export async function buildDemoWorld(): Promise<DemoWorld> {
  const dir = mkdtempSync(path.join(tmpdir(), "agentdoor-shop-e2e-"));
  const bundleDir = path.join(dir, "bundle");
  const secretsDir = path.join(dir, "secrets");
  const keys = generateKeyPair();
  mkdirSync(secretsDir, { recursive: true });
  writeFileSync(path.join(secretsDir, "quote-signing-private.key"), keys.privateKey, { mode: 0o600 });
  chmodSync(path.join(secretsDir, "quote-signing-private.key"), 0o600);
  writeFileSync(path.join(secretsDir, "quote-signing-public.key"), keys.publicKey);

  const usagePath = path.join(dir, "usage.jsonl");
  const client = new ClaudeClient({ mode: "replay", fixturesDir: path.join(FIXTURES, "llm"), usagePath });
  const store = new FsStore(path.join(dir, "sessions"));
  const deps = { client, store };
  const transcript = readFileSync(path.join(FIXTURES, "transcripts", "seeded-leaky.txt"), "utf8").trim();
  const answersTable = JSON.parse(readFileSync(path.join(FIXTURES, "answers", "seeded-leaky.json"), "utf8")) as Record<string, string>;

  const { id } = store.createSession({ language: "en", transcript, fixtureKey: "seeded-leaky" });
  const round0 = await compileSession(deps, id);
  const answers = round0.compileResult.questions.flatMap((q) => (answersTable[q.path] ? [{ questionId: q.id, text: answersTable[q.path]! }] : []));
  if (answers.length > 0) await answerQuestions(deps, id, answers);

  const rehearsals = new Rehearsals(deps);
  const rehearse = async () => {
    const started = rehearsals.start(id);
    await rehearsals.settled(started.runId);
    return rehearsals.get(started.runId).result!;
  };
  await rehearse(); // the first run keeps the leaks on record: the launch report lists what it caught
  approveAllHigh(deps, id);
  let run = await rehearse();
  for (let round = 0; round < MAX_ROUNDS && run.summary.criticalOpen > 0; round++) {
    for (const gap of run.gaps.filter((g) => g.severity === "critical" && !g.dismissed)) {
      const policy = store.readPolicy(id, store.latestVersion(id));
      const first = fixOptions(gap, policy)[0];
      if (gap.code === "SCENARIO_UNHANDLED") applyGapFix(deps, id, gap.id, "dismiss");
      else if (first) applyGapFix(deps, id, gap.id, first.choice, first.needsValue ? FIX_VALUE : undefined);
    }
    run = await rehearse();
  }
  if (run.summary.criticalOpen > 0) throw new Error("demo world: critical gaps did not converge");

  launch(deps, id, { consent: true, paths: { bundleDir, secretsDir } });
  const deployLogFile = path.join(dir, "deploy-log.json");
  writeFileSync(deployLogFile, JSON.stringify(DEPLOY_LOG));
  exportDemo({ store, usagePath }, { sessionId: id, bundleDir, secretsDir, deployLogFile });
  return { dir, bundleDir, publicKey: keys.publicKey, privateKey: keys.privateKey };
}
