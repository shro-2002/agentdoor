import { createHash, timingSafeEqual } from "node:crypto";
import type { AnthropicLike } from "../../../launcher/src/claude/client.js";

const MICRO = 1_000_000;
const DEFAULT_BUDGET_USD = 10;
const DEFAULT_DRAFT_CAP_USD = 0.6;

/** Caps that never change at runtime; the spend caps are configurable (see `WorkspaceConfig`). */
export const LIMITS = {
  /** Compile or clarify calls per draft (the first compile counts). */
  maxCompileRounds: 3,
  maxScenarioRuns: 2,
  maxConcurrentJobs: 2,
  maxDescriptionChars: 2000,
  maxAnswerChars: 400,
  draftsPerIpPerHour: 6,
  wrongCodesPerIpPerHour: 8,
  draftRequestsPerMinute: 120,
  previewRequestsPerMinute: 120,
  /** A job that has not finished by then is failed and can be retried. */
  jobTimeoutMs: 3 * 60_000,
  /** A running job beats this often; a silent one (the process restarted) is failed. */
  heartbeatEveryMs: 10_000,
  heartbeatStaleMs: 45_000,
  maxDraftsPerBrowser: 20,
} as const;

export interface WorkspaceConfig {
  /** Unset (and not open) means the workspace is closed: no drafts, no model calls. */
  accessCode: string | null;
  /** WORKSPACE_OPEN=1: anyone may create a business without a code; spend caps and rate limits still apply. */
  open: boolean;
  apiKey: string | null;
  /** Global spend cap, in millionths of a dollar. */
  budgetMicro: number;
  draftCapMicro: number;
  /** Tests inject a fake transport; production always builds the real SDK. */
  sdkFactory?: () => AnthropicLike;
}

const positive = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
};

export function loadWorkspaceConfig(env: Record<string, string | undefined> = process.env): WorkspaceConfig {
  const code = env.WORKSPACE_ACCESS_CODE?.trim();
  return {
    accessCode: code ? code : null,
    open: env.WORKSPACE_OPEN?.trim() === "1",
    apiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    budgetMicro: Math.round(positive(env.WORKSPACE_BUDGET_USD, DEFAULT_BUDGET_USD) * MICRO),
    draftCapMicro: Math.round(DEFAULT_DRAFT_CAP_USD * MICRO),
  };
}

export const usdOf = (micro: number): number => micro / MICRO;
export const microOf = (usd: number): number => Math.ceil(usd * MICRO);

const digest = (s: string): Buffer => createHash("sha256").update(s).digest();

/** Both sides are hashed first, so the comparison is constant-time whatever the lengths. */
export function accessCodeMatches(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected));
}
