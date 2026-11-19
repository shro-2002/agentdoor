import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";
import { outputSchemaFor } from "./schema.js";
import {
  BudgetGuard,
  DEFAULT_MAX_USD_PER_SESSION,
  DEFAULT_MAX_USD_TOTAL,
  UsageLog,
} from "./budget.js";
import { now as systemNow } from "./clock.js";
import { loadRuntimeEnv } from "./env.js";
import { HTTP_UNAVAILABLE, HTTP_UNPROCESSABLE, LauncherError } from "./errors.js";
import {
  promptHash,
  readFixture,
  writeFixture,
  fixturePath,
  type RecordedAttempt,
} from "./fixtures.js";
import {
  EMPTY_USAGE,
  addUsage,
  costUsd,
  estimateUsd,
  type Usage,
} from "./pricing.js";

export type LlmMode = "live" | "record" | "replay";
export type Effort = "low" | "medium" | "high";
export type Flow = "compile" | "scenarios";

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** The slice of the SDK the client uses; tests inject a fake. */
export interface AnthropicLike {
  beta: {
    messages: {
      create(params: CreateParams): Promise<{
        content: { type: string; text?: string }[];
        stop_reason: string | null;
        model: string;
        usage: {
          input_tokens: number;
          output_tokens: number;
          cache_read_input_tokens?: number | null;
          cache_creation_input_tokens?: number | null;
        };
      }>;
    };
  };
}

export interface ClaudeCall<T> {
  flow: Flow;
  /** e.g. `compile/seeded-leaky/round0`; the replay key (R0-5). */
  fixtureId: string;
  model: string;
  effort: Effort;
  system: string;
  user: string;
  wireSchema: ZodType<T>;
  maxTokens: number;
  /** Budget bucket; defaults to "default". */
  sessionId?: string;
  /** Domain checks the wire schema cannot carry (bounds). Returns issue strings; empty = valid. */
  validate?: (data: T) => string[];
}

export interface CallResult<T> {
  data: T;
  usage: Usage;
  costUsd: number;
  fromFixture: boolean;
  /** Summed API wall time of the attempts (0 for fixtures recorded without it). */
  latencyMs: number;
}

export interface ClaudeClientOptions {
  mode?: LlmMode;
  fixturesDir?: string;
  usagePath?: string;
  maxUsdPerSession?: number;
  maxUsdTotal?: number;
  sdkFactory?: () => AnthropicLike;
  warn?: (message: string) => void;
  now?: () => Date;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FIXTURES_DIR = path.resolve(HERE, "../../fixtures/llm");
export const DEFAULT_USAGE_PATH = path.resolve(HERE, "../../../../.agentdoor/usage.jsonl");

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const SDK_TIMEOUT_MS = 90_000;
const SDK_MAX_RETRIES = 1; // a retried request could be billed twice; the guard assumes one attempt
const MAX_REPAIRS = 1;
const MAX_ISSUES_SHOWN = 20;
const MODES: readonly LlmMode[] = ["live", "record", "replay"];

type Message = { role: "user" | "assistant"; content: string };

function modeFromEnv(): LlmMode {
  const raw = process.env.AGENTDOOR_LLM_MODE ?? "replay";
  if (!MODES.includes(raw as LlmMode))
    throw new LauncherError("VALIDATION_FAILED", `AGENTDOOR_LLM_MODE must be one of ${MODES.join(", ")}`, 500);
  return raw as LlmMode;
}

export class ClaudeClient {
  readonly mode: LlmMode;
  private readonly fixturesDir: string;
  private readonly log: UsageLog;
  private readonly guard: BudgetGuard;
  private readonly sdkFactory: () => AnthropicLike;
  private readonly warn: (m: string) => void;
  private readonly clock: () => Date;
  private sdk: AnthropicLike | null = null;

  constructor(opts: ClaudeClientOptions = {}) {
    this.mode = opts.mode ?? modeFromEnv();
    this.fixturesDir = opts.fixturesDir ?? DEFAULT_FIXTURES_DIR;
    this.log = new UsageLog(opts.usagePath ?? DEFAULT_USAGE_PATH);
    this.guard = new BudgetGuard(this.log, {
      sessionUsd: opts.maxUsdPerSession ?? numberEnv("LAUNCHER_MAX_USD_PER_SESSION", DEFAULT_MAX_USD_PER_SESSION),
      totalUsd: opts.maxUsdTotal ?? numberEnv("LAUNCHER_MAX_USD_TOTAL", DEFAULT_MAX_USD_TOTAL),
    });
    this.sdkFactory = opts.sdkFactory ?? defaultSdkFactory;
    this.warn = opts.warn ?? ((m) => console.warn(m));
    this.clock = opts.now ?? systemNow;
  }

  usageTotals(): { totalUsd: number; sessionUsd: (id: string) => number } {
    return { totalUsd: this.log.totalSpend(), sessionUsd: (id) => this.log.sessionSpend(id) };
  }

  async callStructured<T>(c: ClaudeCall<T>): Promise<CallResult<T>> {
    fixturePath(this.fixturesDir, c.fixtureId); // rejects ids that could escape the directory
    const schema = outputSchemaFor(c.wireSchema);
    const hash = promptHash(c.system, schema);
    const fetchAttempt =
      this.mode === "replay" ? this.replaySource(c, hash) : this.liveSource(c, schema);

    const attempts: RecordedAttempt[] = [];
    let messages: Message[] = [{ role: "user", content: c.user }];
    let issues: string[] = [];
    for (let i = 0; i <= MAX_REPAIRS; i++) {
      const attempt = await fetchAttempt(i, messages);
      attempts.push(attempt);
      assertFinished(attempt);
      const parsed = parseAttempt(attempt.rawText, c);
      if (parsed.ok) return this.finish(c, hash, attempts, parsed.data);
      issues = parsed.issues;
      messages = [
        ...messages,
        { role: "assistant", content: attempt.rawText },
        { role: "user", content: repairPrompt(issues) },
      ];
    }
    throw new LauncherError(
      "STRUCTURED_OUTPUT_INVALID",
      `Model output failed validation after one repair: ${issues.slice(0, MAX_ISSUES_SHOWN).join("; ")}`,
      HTTP_UNPROCESSABLE,
    );
  }

  private finish<T>(c: ClaudeCall<T>, hash: string, attempts: RecordedAttempt[], data: T): CallResult<T> {
    const usage = attempts.reduce((u, a) => addUsage(u, a.usage), EMPTY_USAGE);
    const cost = attempts.reduce((t, a) => t + costUsd(a.model, a.usage), 0);
    if (this.mode === "record")
      writeFixture(this.fixturesDir, {
        fixtureId: c.fixtureId,
        flow: c.flow,
        model: c.model,
        recordedAt: this.clock().toISOString(),
        promptHash: hash,
        attempts,
      });
    const latencyMs = attempts.reduce((t, a) => t + (a.latencyMs ?? 0), 0);
    return { data, usage, costUsd: cost, fromFixture: this.mode === "replay", latencyMs };
  }

  private replaySource<T>(c: ClaudeCall<T>, hash: string) {
    const fixture = readFixture(this.fixturesDir, c.fixtureId);
    if (fixture.promptHash !== hash)
      this.warn(`prompt changed since recording of "${c.fixtureId}" (replaying the recorded response anyway)`);
    return async (i: number): Promise<RecordedAttempt> => {
      const a = fixture.attempts[i];
      if (!a)
        throw new LauncherError(
          "FIXTURE_MISSING",
          `Fixture "${c.fixtureId}" has no recorded attempt ${i}; re-record it`,
          HTTP_UNAVAILABLE,
        );
      return a;
    };
  }

  private liveSource<T>(c: ClaudeCall<T>, schema: Record<string, unknown>) {
    const sessionId = c.sessionId ?? "default";
    return async (i: number, messages: Message[]): Promise<RecordedAttempt> => {
      const chars = c.system.length + JSON.stringify(schema).length + messages.reduce((n, m) => n + m.content.length, 0);
      this.guard.assertCanSpend(sessionId, estimateUsd(c.model, chars, c.maxTokens));
      const startedAt = Date.now();
      const res = await this.sdkInstance().beta.messages.create(buildParams(c, schema, messages));
      const latencyMs = Date.now() - startedAt;
      const attempt: RecordedAttempt = {
        rawText: res.content.map((b) => (b.type === "text" ? (b.text ?? "") : "")).join(""),
        stopReason: res.stop_reason,
        model: res.model,
        usage: {
          inputTokens: res.usage.input_tokens,
          outputTokens: res.usage.output_tokens,
          cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
        },
        latencyMs,
      };
      this.log.append({
        at: this.clock().toISOString(),
        sessionId,
        flow: c.flow,
        fixtureId: c.fixtureId,
        model: attempt.model,
        mode: this.mode,
        attempt: i,
        usage: attempt.usage,
        costUsd: costUsd(attempt.model, attempt.usage),
      });
      return attempt;
    };
  }

  /** Lazy: replay mode never reaches this, so no network client is ever created there (U-BUD-3). */
  private sdkInstance(): AnthropicLike {
    this.sdk ??= this.sdkFactory();
    return this.sdk;
  }
}

function buildParams<T>(c: ClaudeCall<T>, schema: Record<string, unknown>, messages: Message[]): CreateParams {
  const params: CreateParams = {
    model: c.model,
    max_tokens: c.maxTokens,
    // One breakpoint at the end of the static system prompt so recompiles read the cache.
    system: [{ type: "text", text: c.system, cache_control: { type: "ephemeral" } }],
    messages,
    output_config: { effort: c.effort, format: { type: "json_schema", schema } },
  };
  if (c.model.includes("sonnet")) {
    params.betas = [FALLBACK_BETA];
    params.fallbacks = "default";
  }
  return params;
}

function assertFinished(a: RecordedAttempt): void {
  if (a.stopReason === "refusal")
    throw new LauncherError("MODEL_REFUSED", "The model declined this request.", HTTP_UNPROCESSABLE);
  if (a.stopReason === "max_tokens")
    throw new LauncherError("OUTPUT_TRUNCATED", "The model ran out of room before finishing.", HTTP_UNPROCESSABLE);
}

type Parsed<T> = { ok: true; data: T } | { ok: false; issues: string[] };

function parseAttempt<T>(raw: string, c: ClaudeCall<T>): Parsed<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, issues: ["output is not valid JSON"] };
  }
  const parsed = c.wireSchema.safeParse(json);
  if (!parsed.success)
    return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  const domain = c.validate?.(parsed.data) ?? [];
  return domain.length > 0 ? { ok: false, issues: domain } : { ok: true, data: parsed.data };
}

const repairPrompt = (issues: string[]): string =>
  `Your previous output failed validation:\n${issues.slice(0, MAX_ISSUES_SHOWN).map((i) => `- ${i}`).join("\n")}\nReturn the complete corrected JSON object, nothing else.`;

function numberEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return process.env[name] && Number.isFinite(n) && n > 0 ? n : fallback;
}

function defaultSdkFactory(): AnthropicLike {
  if (!loadRuntimeEnv())
    throw new LauncherError("NO_API_KEY", "ANTHROPIC_API_KEY is not set (live and record modes need it)", HTTP_UNAVAILABLE);
  return new Anthropic({ timeout: SDK_TIMEOUT_MS, maxRetries: SDK_MAX_RETRIES }) as unknown as AnthropicLike;
}
