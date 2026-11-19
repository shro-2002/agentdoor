import {
  BusinessPolicySchema,
  ScenariosWireSchema,
  istDateOf,
  policyHash,
  type BusinessPolicy,
  type Lang,
} from "@agentdoor/core";
import type { ClaudeClient } from "../../../launcher/src/claude/client.js";
import { LauncherError } from "../../../launcher/src/claude/errors.js";
import { COMPILE_MODEL, buildCompileResult, type Built } from "../../../launcher/src/flows/compile.js";
import { CompileApiSchema, toWire } from "../../../launcher/src/flows/compile-api.js";
import { assembleRun, judgeScenarios, runProbeChecks, type RunResult } from "../../../launcher/src/flows/rehearse.js";
import { SCENARIO_MODEL, buildScenariosUser, vocabularyHash } from "../../../launcher/src/flows/scenarios.js";
import { compileSystemPrompt, scenariosSystemPrompt } from "../../../launcher/src/prompts/load.js";
import { LIMITS } from "./config.js";
import { mergeOwnerWork } from "./merge.js";
import { newId } from "./cookie.js";
import type { CallLog, DraftState, Question } from "./state.js";

const COMPILE_MAX_TOKENS = 12_000;
const SCENARIO_MAX_TOKENS = 8_000;
const MAX_QUESTIONS_LATER_ROUNDS = 3;
const COMPILE_FAILED_MESSAGE = "I couldn't read that. Try rephrasing it a little.";
const NO_BUSINESS_MESSAGE = "I couldn't find a business in that. Tell me what you sell.";
const PUNE_LINE = "with Pune-style context (Baner, Aundh, Wakad, festivals, office parties)";
const OWN_CITY_LINE = "with context from the business's own city and neighbourhoods (festivals, office parties)";

/** Round numbers are zero-based; the last allowed round must not ask more questions. */
export const isFinalRound = (round: number): boolean => round >= LIMITS.maxCompileRounds - 1;

export function compileUserMessage(turns: string[], round: number, nowMs: number): string {
  const rules =
    round === 0
      ? "Round 0: you may ask up to 5 questions."
      : isFinalRound(round)
        ? "Final round: do NOT ask questions (return an empty questions array). Anything still unknown keeps an AgentDoor default with quote null."
        : `Follow-up round ${round}: ask at most ${MAX_QUESTIONS_LATER_ROUNDS} questions, only about rules that are still unknown.`;
  const body = turns.map((t, i) => `=== turn ${i} ===\n${t}`).join("\n\n");
  // Models sometimes write 0 for a maximum the owner never gave, which no policy accepts.
  const reminder = "Every catalog maxQtyPerOrder must be a whole number of at least 1 and at least minQty. If the owner gave no maximum, use 10 and list it in `missing`. business.ownerFirstName must not be empty: if the owner gave no name, use \"Owner\".";
  return `Today's date (IST): ${istDateOf(nowMs)}\nOwner's language hint: unknown (read it from the text)\n${rules}\n${reminder}\n\nTranscript turns:\n\n${body}`;
}

export interface CompiledTurn {
  policy: BusinessPolicy;
  language: Lang;
  questions: Question[];
  call: CallLog;
}

/** Why a model result is unusable, in words that are safe to show. */
export class UserFacingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "UserFacingError";
  }
}

function interpret(api: ReturnType<typeof CompileApiSchema.parse>, turns: string[], round: number) {
  const wire = toWire(api);
  return wire.ok ? buildCompileResult(wire.wire, turns, { allowQuestions: !isFinalRound(round) }) : { ok: false as const, issues: wire.issues };
}

/** One live compile of the whole transcript (the launcher's compiler, unchanged), merged with the owner's own work. */
export async function compileTurn(client: ClaudeClient, draftId: string, state: DraftState, round: number, nowMs: number): Promise<CompiledTurn> {
  const result = await client
    .callStructured({
      flow: "compile",
      fixtureId: `workspace/compile/round${round}`,
      model: COMPILE_MODEL,
      effort: "medium",
      system: compileSystemPrompt(),
      user: compileUserMessage(state.turns, round, nowMs),
      wireSchema: CompileApiSchema,
      maxTokens: COMPILE_MAX_TOKENS,
      sessionId: draftId,
      validate: (api) => {
        const out = interpret(api, state.turns, round);
        return out.ok || ("noBusiness" in out && out.noBusiness) ? [] : out.issues;
      },
    })
    .catch((e: unknown) => {
      if (e instanceof LauncherError && e.code === "STRUCTURED_OUTPUT_INVALID") throw new UserFacingError("COMPILE_INVALID", COMPILE_FAILED_MESSAGE, true);
      throw e;
    });
  const out = interpret(result.data, state.turns, round);
  if (!out.ok) {
    const none = "noBusiness" in out && out.noBusiness;
    throw new UserFacingError(none ? "NO_BUSINESS_FOUND" : "COMPILE_INVALID", none ? NO_BUSINESS_MESSAGE : COMPILE_FAILED_MESSAGE, true);
  }
  const built: Built = out.value;
  return {
    policy: mergeOwnerWork(built.policy, state.policy),
    language: built.detectedLanguage,
    questions: built.questions.map((q) => ({ id: q.id, path: q.path, text: q.text, choices: q.choices })),
    call: callLog(round === 0 ? "compile" : "clarify", nowMs, result),
  };
}

function callLog(kind: CallLog["kind"], at: number, r: { usage: { inputTokens: number; outputTokens: number }; costUsd: number; latencyMs: number }): CallLog {
  return { kind, at, ms: r.latencyMs, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: r.costUsd };
}

/** Live scenario generation: short test customers; the engine, not the model, judges them. */
export async function generateScenarios(client: ClaudeClient, draftId: string, state: DraftState, policy: BusinessPolicy, nowMs: number) {
  const system = scenariosSystemPrompt().replace(PUNE_LINE, OWN_CITY_LINE);
  const result = await client.callStructured({
    flow: "scenarios",
    fixtureId: "workspace/scenarios",
    model: SCENARIO_MODEL,
    effort: "low",
    system,
    user: `The business is in ${policy.business.city}.\n\n${buildScenariosUser({ turns: state.turns }, policy)}`,
    wireSchema: ScenariosWireSchema,
    maxTokens: SCENARIO_MAX_TOKENS,
    sessionId: draftId,
    validate: (d) => (d.scenarios.length > 0 ? [] : ["scenarios must contain at least one scenario"]),
  });
  return { items: result.data.scenarios, vocabHash: vocabularyHash(policy), call: callLog("scenarios", nowMs, result) };
}

/** True when the stored scenarios were written against this policy's menu and areas. */
export const scenariosFit = (state: DraftState, policy: BusinessPolicy): boolean => state.scenarios !== null && state.scenarios.vocabHash === vocabularyHash(policy);

/**
 * The deterministic part of a rehearsal: engine probes, the scenarios through the engine, the lint.
 * Free and instant, so it re-runs after every change. Needs scenarios already stored on the draft.
 */
export function rehearseNow(state: DraftState, nowMs: number): RunResult {
  const policy = BusinessPolicySchema.parse(state.policy);
  const hash = policyHash(policy);
  const probeResults = runProbeChecks(policy, hash, nowMs);
  const { outcomes, dropped, gaps } = judgeScenarios({
    policy,
    transcript: state.turns.join("\n"),
    probeResults,
    scenarios: state.scenarios?.items ?? [],
    today: istDateOf(nowMs),
    nowMs,
    dismissed: new Set(state.dismissals.map((d) => d.gapId)),
  });
  return assembleRun({
    runId: `r_${newId().slice(0, 12)}`,
    seq: state.runSeq + 1,
    sessionId: "workspace",
    version: state.policyVersion,
    hash,
    ranAt: new Date(nowMs).toISOString(),
    probes: probeResults,
    outcomes,
    dropped,
    gaps,
    source: { fromFixture: false, cached: true, costUsd: 0, model: SCENARIO_MODEL },
  });
}

/** Stores a fresh run on the draft and remembers every gap it saw. */
export function recordRun(state: DraftState, run: RunResult): void {
  state.run = run;
  state.runSeq = run.seq;
  for (const g of run.gaps) state.seenGaps[g.id] = { severity: g.severity, code: g.code };
}
