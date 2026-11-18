import { canonicalJson } from "../hash.js";
import { signUtf8, verifyUtf8 } from "./keys.js";

/** Subset of ErrorCode (04 §6) that token verification can return. */
export type QuoteTokenErrorCode =
  | "QUOTE_INVALID"
  | "QUOTE_EXPIRED"
  | "QUOTE_STALE_POLICY";

/** `request` stays structural so crypto does not depend on the engine's schema. */
export interface QuoteTokenPayload {
  v: 1;
  qid: string;
  shop: string;
  policyHash: string;
  request: Record<string, unknown>;
  totalPaise: number;
  capacityUnits: number;
  isRush: boolean;
  iat: number;
  exp: number;
}

export type QuoteVerifyResult =
  | { ok: true; payload: QuoteTokenPayload }
  | { ok: false; code: QuoteTokenErrorCode };

const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");

/** token = b64url(canonicalJson(payload)) + "." + b64url(sig over the first part) */
export function signQuoteToken(
  payload: QuoteTokenPayload,
  privateKeyB64: string,
): string {
  const body = b64u(canonicalJson(payload));
  return `${body}.${signUtf8(body, privateKeyB64)}`;
}

function decodePayload(body: string): QuoteTokenPayload | null {
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const ok =
      p !== null &&
      typeof p === "object" &&
      p.v === 1 &&
      typeof p.qid === "string" &&
      typeof p.policyHash === "string" &&
      Number.isSafeInteger(p.iat) &&
      Number.isSafeInteger(p.exp);
    return ok ? (p as QuoteTokenPayload) : null;
  } catch {
    return null;
  }
}

/**
 * Order matters: the signature is checked before anything in the payload is trusted;
 * expiry before staleness so an old quote reports the more useful reason.
 */
export function verifyQuoteToken(
  token: string,
  publicKeyB64: string,
  ctx: { currentPolicyHash: string; nowSec: number },
): QuoteVerifyResult {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 2) return { ok: false, code: "QUOTE_INVALID" };
  const [body, sig] = parts as [string, string];
  if (!verifyUtf8(body, sig, publicKeyB64)) return { ok: false, code: "QUOTE_INVALID" };
  const payload = decodePayload(body);
  if (!payload) return { ok: false, code: "QUOTE_INVALID" };
  if (ctx.nowSec >= payload.exp) return { ok: false, code: "QUOTE_EXPIRED" };
  if (payload.policyHash !== ctx.currentPolicyHash)
    return { ok: false, code: "QUOTE_STALE_POLICY" };
  return { ok: true, payload };
}
