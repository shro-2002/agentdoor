/**
 * One-off fixture recorder (T07): `npm run record-fixtures`.
 * Needs AGENTDOOR_LLM_MODE=record. The API key is loaded from `.env.local` by the client at
 * runtime and is never read, printed or logged here. A hard 1 USD guard aborts before any call
 * that could pass the cap. Fixtures that already exist are replayed, not re-recorded.
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { answerQuestions } from "../flows/clarify.js";
import { compileSession } from "../flows/compile.js";
import { scoreCompile, type Expected } from "../flows/score.js";
import { FsStore } from "../store/fsStore.js";
import { ClaudeClient, DEFAULT_FIXTURES_DIR, DEFAULT_USAGE_PATH } from "./client.js";
import { fixturePath } from "./fixtures.js";

const RECORD_BUDGET_USD = 1;
const NAMES = ["seeded-leaky", "en", "hinglish", "hi"] as const;
const FIXTURES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures");
const readText = (...p: string[]) => readFileSync(path.join(FIXTURES_ROOT, ...p), "utf8");

async function main(): Promise<void> {
  if (process.env.AGENTDOOR_LLM_MODE !== "record") {
    console.error("Refusing to run: set AGENTDOOR_LLM_MODE=record");
    process.exit(2);
  }
  const recorder = new ClaudeClient({ mode: "record", maxUsdPerSession: RECORD_BUDGET_USD, maxUsdTotal: RECORD_BUDGET_USD });
  const replayer = new ClaudeClient({ mode: "replay" });
  const pick = (fixtureId: string) => (existsSync(fixturePath(DEFAULT_FIXTURES_DIR, fixtureId)) ? replayer : recorder);

  for (const name of NAMES) {
    const exp = JSON.parse(readText("expected", `${name}.json`)) as Expected;
    const store = new FsStore(mkdtempSync(path.join(tmpdir(), "agentdoor-record-")));
    const session = store.createSession({ language: exp.language, transcript: readText("transcripts", `${name}.txt`).trim(), fixtureKey: name });
    const round0 = await compileSession({ client: pick(`compile/${name}/round0`), store }, session.id);
    const score = scoreCompile(round0.compileResult.policy, exp);
    console.log(`${name}/round0: accuracy ${score.correct}/${score.total} wrong=${JSON.stringify(score.wrong)}`);
    console.log(`  questions: ${round0.compileResult.questions.map((q) => q.path).join(", ") || "(none)"}`);
    if (name !== "seeded-leaky") continue;

    const table = JSON.parse(readText("answers", "seeded-leaky.json")) as Record<string, string>;
    const answers = round0.compileResult.questions.flatMap((q) => (table[q.path] ? [{ questionId: q.id, text: table[q.path]! }] : []));
    console.log(`  answering ${answers.length} question(s)`);
    if (answers.length === 0) continue;
    const round1 = await answerQuestions({ client: pick(`compile/${name}/round1`), store }, session.id, answers);
    console.log(`${name}/round1: version ${round1.version}`);
  }
  console.log(`recorded spend in usage log: $${recorder.usageTotals().totalUsd.toFixed(4)} (${DEFAULT_USAGE_PATH})`);
}

main().catch((e: unknown) => {
  const err = e as { code?: string; message?: string };
  console.error(`record failed: ${err.code ?? "ERROR"}: ${err.message ?? "unknown"}`);
  process.exit(1);
});
