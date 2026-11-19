import type { Pool } from "mysql2/promise";
import { policyHash } from "@agentdoor/core";
import type { ClaudeClient } from "../../../launcher/src/claude/client.js";
import { LauncherError } from "../../../launcher/src/claude/errors.js";
import type { Logger } from "../log.js";
import { BudgetError } from "./budget.js";
import { claudeConfigured, createWorkspaceClient } from "./claude.js";
import { LIMITS, type WorkspaceConfig } from "./config.js";
import { newId } from "./cookie.js";
import { UserFacingError, compileTurn, generateScenarios, recordRun, rehearseNow, scenariosFit } from "./flows.js";
import { answerTurns } from "./questions.js";
import { beat, getDraft, getJob, giveBackRound, insertJob, latestJob, markJob, sweepStaleJobs, takeRound, updateState } from "./store.js";
import type { JobKind, JobRow } from "./state.js";

export type StartResult =
  | { ok: true; jobId: string }
  | { ok: false; reason: "CLOSED" | "BUSY" | "NO_ROUNDS" | "NOT_READY"; message: string };

interface Failure {
  code: string;
  message: string;
  retryable: boolean;
}

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;

/** Only ever returns text that is safe to show: provider error text can carry request detail. */
export function toFailure(e: unknown): Failure {
  if (e instanceof BudgetError)
    return {
      code: e.scope === "global" ? "BUDGET_GLOBAL" : "BUDGET_DRAFT",
      message:
        e.scope === "global"
          ? "The workspace has reached its AI limit for now. Everything else still works: you can edit rules and run the free checks."
          : "This business has used its AI allowance. You can still edit rules and run the free checks.",
      retryable: false,
    };
  if (e instanceof UserFacingError) return { code: e.code, message: e.message, retryable: e.retryable };
  if (e instanceof LauncherError) {
    if (e.code === "NO_API_KEY") return { code: e.code, message: "The AI service is not set up on this site yet. Try again later.", retryable: true };
    if (e.code === "MODEL_REFUSED" || e.code === "OUTPUT_TRUNCATED" || e.code === "STRUCTURED_OUTPUT_INVALID")
      return { code: e.code, message: "Claude could not finish that. Try again.", retryable: true };
  }
  const status = (e as { status?: unknown } | null)?.status;
  if (status === HTTP_UNAUTHORIZED || status === HTTP_FORBIDDEN)
    return { code: "CLAUDE_AUTH", message: "The AI service is not set up correctly on this site. Try again later.", retryable: true };
  return { code: "CLAUDE_UNAVAILABLE", message: "Claude could not be reached. Try again in a moment.", retryable: true };
}

export interface JobContext {
  pool: Pool;
  now: () => number;
  log: Logger;
}

/**
 * Claude calls take 30 to 90 seconds, so they run as server-side jobs. The job row in MySQL is the
 * only shared state: the page polls it, a restart or a timeout turns it into a retryable failure
 * (see sweepStaleJobs), and at most two Claude jobs run at once in this process.
 */
export class WorkspaceJobs {
  private client: ClaudeClient | null = null;
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly ctx: JobContext,
    private readonly cfg: WorkspaceConfig,
  ) {}

  /** Resolves when every job started so far has finished (tests only). */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  async current(draftId: string): Promise<JobRow | null> {
    await sweepStaleJobs(this.ctx.pool, draftId, this.ctx.now());
    return latestJob(this.ctx.pool, draftId);
  }

  async status(draftId: string, jobId: string): Promise<JobRow | null> {
    await sweepStaleJobs(this.ctx.pool, draftId, this.ctx.now());
    return getJob(this.ctx.pool, draftId, jobId);
  }

  async start(draftId: string, kind: JobKind, payload: unknown = null): Promise<StartResult> {
    if (this.cfg.accessCode === null && !this.cfg.open) return { ok: false, reason: "CLOSED", message: "Workspace is closed." };
    const existing = await this.current(draftId);
    if (existing && (existing.status === "queued" || existing.status === "running"))
      return { ok: false, reason: "BUSY", message: "Something is already running for this business." };
    const row = await getDraft(this.ctx.pool, draftId);
    if (!row) return { ok: false, reason: "NOT_READY", message: "That business no longer exists." };
    const refusal = this.precheck(row, kind, payload);
    if (refusal) return { ok: false, reason: refusal.reason, message: refusal.message };
    const jobId = newId();
    await insertJob(this.ctx.pool, { id: jobId, draftId, kind, payload, nowMs: this.ctx.now() });
    const run = this.run(jobId, draftId, kind, payload).finally(() => this.pending.delete(run));
    this.pending.add(run);
    return { ok: true, jobId };
  }

  private precheck(row: NonNullable<Awaited<ReturnType<typeof getDraft>>>, kind: JobKind, payload: unknown) {
    const { state } = row;
    const spent = (reason: "NO_ROUNDS", message: string) => ({ reason, message });
    if (kind === "compile" && state.policy) return { reason: "NOT_READY" as const, message: "This business is already set up." };
    if (kind !== "compile" && !state.policy) return { reason: "NOT_READY" as const, message: "Describe the business first." };
    if (kind !== "rehearse" && row.compileRounds >= LIMITS.maxCompileRounds)
      return spent("NO_ROUNDS", `You have used all ${LIMITS.maxCompileRounds} rounds of questions for this business. You can still edit everything by hand.`);
    if (kind === "clarify" && Object.keys(state.answers).length === 0) return { reason: "NOT_READY" as const, message: "Answer a question first." };
    const regenerate = (payload as { regenerate?: boolean } | null)?.regenerate === true;
    if (kind === "rehearse" && state.policy && (regenerate || !scenariosFit(state, state.policy)) && row.scenarioRuns >= LIMITS.maxScenarioRuns)
      return spent("NO_ROUNDS", `You have used both customer-scenario runs for this business. You can still run the free checks again.`);
    return null;
  }

  private async run(jobId: string, draftId: string, kind: JobKind, payload: unknown): Promise<void> {
    const { pool, now, log } = this.ctx;
    const timer = setInterval(() => void beat(pool, jobId, now()).catch(() => undefined), LIMITS.heartbeatEveryMs);
    timer.unref();
    const startedAt = now();
    try {
      await this.acquire();
      try {
        const job = await getJob(pool, draftId, jobId);
        if (!job || job.status !== "queued") return; // already failed by the sweeper
        await markJob(pool, jobId, "running", now());
        await this.execute(draftId, kind, payload);
        await markJob(pool, jobId, "done", now());
        log({ level: "info", event: "ws_job", kind, status: "done", ms: now() - startedAt });
      } finally {
        this.release();
      }
    } catch (e) {
      const failure = toFailure(e);
      await markJob(pool, jobId, "failed", now(), failure).catch(() => undefined);
      log({ level: "warn", event: "ws_job", kind, status: "failed", code: failure.code, httpStatus: (e as { status?: unknown } | null)?.status, ms: now() - startedAt });
    } finally {
      clearInterval(timer);
    }
  }

  private acquire(): Promise<void> {
    if (this.running < LIMITS.maxConcurrentJobs) {
      this.running += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(() => resolve()));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.running -= 1;
  }

  private claude(): ClaudeClient {
    if (!claudeConfigured(this.cfg)) throw new LauncherError("NO_API_KEY", "no key", 503);
    this.client ??= createWorkspaceClient(this.ctx.pool, this.cfg);
    return this.client;
  }

  private async execute(draftId: string, kind: JobKind, payload: unknown): Promise<void> {
    if (kind === "rehearse") return this.executeRehearse(draftId, payload);
    return this.executeCompile(draftId, kind, payload);
  }

  private async executeCompile(draftId: string, kind: "compile" | "clarify", payload: unknown): Promise<void> {
    const { pool, now } = this.ctx;
    const client = this.claude();
    const row = await getDraft(pool, draftId);
    if (!row) throw new Error("draft not found");
    const state = structuredClone(row.state);
    if (kind === "compile") {
      const text = (payload as { description?: unknown } | null)?.description;
      if (typeof text === "string" && text.trim() !== "") {
        state.description = text.trim();
        state.turns = [state.description];
      }
    } else state.turns = [...state.turns, ...answerTurns(state.questions, state.answers)];
    if (!(await takeRound(pool, draftId, "compile")))
      throw new UserFacingError("NO_ROUNDS", `You have used all ${LIMITS.maxCompileRounds} rounds of questions for this business.`, false);
    const round = row.compileRounds;
    try {
      const done = await compileTurn(client, draftId, state, round, now());
      await updateState(pool, draftId, (s) => {
        const changed = !s.policy || policyHash(s.policy) !== policyHash(done.policy);
        s.description = state.description;
        s.turns = state.turns;
        s.policy = done.policy;
        s.policyVersion += changed ? 1 : 0;
        s.language = done.language;
        s.questions = done.questions;
        s.answers = {};
        s.questionsClosed = done.questions.length === 0;
        s.calls.push(done.call);
        if (s.run && scenariosFit(s, done.policy)) recordRun(s, rehearseNow(s, now()));
      });
    } catch (e) {
      await giveBackRound(pool, draftId, "compile");
      throw e;
    }
  }

  private async executeRehearse(draftId: string, payload: unknown): Promise<void> {
    const { pool, now } = this.ctx;
    const row = await getDraft(pool, draftId);
    const policy = row?.state.policy;
    if (!row || !policy) throw new UserFacingError("NOT_READY", "Describe the business first.", false);
    const regenerate = (payload as { regenerate?: boolean } | null)?.regenerate === true;
    if (regenerate || !scenariosFit(row.state, policy)) {
      const client = this.claude();
      if (!(await takeRound(pool, draftId, "scenarios"))) throw new UserFacingError("NO_ROUNDS", "Both customer-scenario runs are used up.", false);
      try {
        const gen = await generateScenarios(client, draftId, row.state, policy, now());
        await updateState(pool, draftId, (s) => {
          s.scenarios = { vocabHash: gen.vocabHash, items: gen.items };
          s.calls.push(gen.call);
          recordRun(s, rehearseNow(s, now()));
        });
      } catch (e) {
        await giveBackRound(pool, draftId, "scenarios");
        throw e;
      }
      return;
    }
    await updateState(pool, draftId, (s) => recordRun(s, rehearseNow(s, now())));
  }
}
