import { randomUUID } from "node:crypto";
import {
  evaluate,
  signQuoteToken,
  type PricedLine,
  type QuoteRequest,
  type QuoteTokenPayload,
  type Reason,
} from "@agentdoor/core";
import type { ServiceContext } from "./context.js";
import { QuoteInputSchema } from "./schemas.js";

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

export type QuoteOutcome =
  | {
      kind: "QUOTED";
      token: string;
      expiresAt: string;
      totalPaise: number;
      lines: PricedLine[];
      isRush: boolean;
      reasons: Reason[];
    }
  | { kind: "REFUSED" | "NEEDS_OWNER"; reasons: Reason[] }
  | { kind: "ERROR"; code: "VALIDATION_FAILED" | "SHOP_NOT_LAUNCHED" };

/**
 * Whole seconds: the token stores `iat` in seconds and the order path re-runs the engine at
 * `iat`, so the quote itself must be evaluated at that same instant or a boundary could disagree.
 */
export const quoteInstantMs = (nowMs: number): number =>
  Math.floor(nowMs / MS_PER_SECOND) * MS_PER_SECOND;

/** Notes are excluded from the signed request: they are never interpreted (04 §3). */
const signedRequest = (r: QuoteRequest): Record<string, unknown> => ({
  lines: r.lines,
  fulfilment: r.fulfilment,
  date: r.date,
});

/** Shared by REST `POST /api/quotes` and MCP `get_quote`: one code path, one price. */
export function getQuote(ctx: ServiceContext, raw: unknown): QuoteOutcome {
  if (!ctx.launch.launched) return { kind: "ERROR", code: "SHOP_NOT_LAUNCHED" };
  const parsed = QuoteInputSchema.safeParse(raw);
  if (!parsed.success) return { kind: "ERROR", code: "VALIDATION_FAILED" };
  const { policy, policyHash } = ctx.launch;
  const nowMs = quoteInstantMs(ctx.now());
  const result = evaluate(policy, parsed.data, nowMs);
  if (result.outcome !== "QUOTED") {
    ctx.log({ level: "info", event: "quote_refused", outcome: result.outcome, codes: result.reasons.map((r) => r.code) });
    return { kind: result.outcome, reasons: result.reasons };
  }
  const iat = nowMs / MS_PER_SECOND;
  const payload: QuoteTokenPayload = {
    v: 1,
    qid: randomUUID(),
    shop: policy.business.slug,
    policyHash,
    request: signedRequest(parsed.data),
    totalPaise: result.totalPaise,
    capacityUnits: result.capacityUnits,
    isRush: result.isRush,
    iat,
    exp: iat + policy.orderRules.quoteValidityMinutes * SECONDS_PER_MINUTE,
  };
  return {
    kind: "QUOTED",
    token: signQuoteToken(payload, ctx.config.signingPrivateKey),
    expiresAt: new Date(payload.exp * MS_PER_SECOND).toISOString(),
    totalPaise: result.totalPaise,
    lines: result.lines,
    isRush: result.isRush,
    reasons: result.reasons,
  };
}
