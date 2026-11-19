import type { BusinessPolicy, Lang } from "@agentdoor/core";
import type { FixLogEntry } from "../../../launcher/src/flows/gapFix.js";
import type { Dismissal, RunResult } from "../../../launcher/src/flows/rehearse.js";
import type { ScenarioWire } from "../../../launcher/src/flows/scenarios.js";

export interface Question {
  id: string;
  path: string;
  text: string;
  choices: string[];
}

export interface CallLog {
  kind: "compile" | "clarify" | "scenarios";
  at: number;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Everything one draft remembers, stored as one JSON document in `ws_drafts.state`. */
export interface DraftState {
  v: 1;
  description: string;
  /** The owner's words: the description, then one `Q: ...\nA: ...` turn per answered question. */
  turns: string[];
  language: Lang | null;
  policy: BusinessPolicy | null;
  /** +1 on every change to the policy; the rehearsal is stale when its hash no longer matches. */
  policyVersion: number;
  questions: Question[];
  /** Answers collected for the current batch of questions (id -> text). */
  answers: Record<string, string>;
  /** The owner finished or skipped the current batch of questions. */
  questionsClosed: boolean;
  scenarios: { vocabHash: string; items: ScenarioWire[] } | null;
  run: RunResult | null;
  runSeq: number;
  dismissals: Dismissal[];
  fixes: FixLogEntry[];
  /** Every gap seen in any run, so the launch record can list what was found and settled. */
  seenGaps: Record<string, { severity: "critical" | "warning"; code: string }>;
  /** Internal measurements only; never shown in the owner's screens. */
  calls: CallLog[];
}

export const emptyState = (description: string): DraftState => ({
  v: 1,
  description,
  turns: [description],
  language: null,
  policy: null,
  policyVersion: 0,
  questions: [],
  answers: {},
  questionsClosed: false,
  scenarios: null,
  run: null,
  runSeq: 0,
  dismissals: [],
  fixes: [],
  seenGaps: {},
  calls: [],
});

export interface DraftRow {
  id: string;
  previewId: string | null;
  version: number;
  compileRounds: number;
  scenarioRuns: number;
  spentMicro: number;
  reservedMicro: number;
  state: DraftState;
}

export type JobKind = "compile" | "clarify" | "rehearse";
export type JobStatus = "queued" | "running" | "done" | "failed";

export interface JobRow {
  id: string;
  draftId: string;
  kind: JobKind;
  status: JobStatus;
  payload: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean;
  createdMs: number;
  heartbeatMs: number;
}
