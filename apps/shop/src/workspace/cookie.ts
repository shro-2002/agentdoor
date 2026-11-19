import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const WORKSPACE_COOKIE = "ad_ws";
const KEY_LABEL = "agentdoor/workspace-cookie/v1";
const ID_BYTES = 16; // 128 bits
const ID_RE = /^[0-9a-f]{32}$/;
const MAX_IDS = 20;
const MAX_AGE_MS = 30 * 24 * 3_600_000;

/** 128-bit random id as 32 hex characters: drafts, previews and jobs. */
export const newId = (): string => randomBytes(ID_BYTES).toString("hex");
export const isId = (value: unknown): value is string => typeof value === "string" && ID_RE.test(value);

const keyFrom = (sessionSecret: Buffer): Buffer => createHmac("sha256", sessionSecret).update(KEY_LABEL).digest();
const mac = (body: string, key: Buffer): Buffer => createHmac("sha256", key).update(body).digest();

/** cookie value = base64url(JSON{ids, iat}) + "." + base64url(HMAC-SHA256(key, first part)) */
export function signDraftCookie(sessionSecret: Buffer, ids: string[], nowMs: number): string {
  const body = Buffer.from(JSON.stringify({ ids: ids.filter(isId).slice(-MAX_IDS), iat: nowMs })).toString("base64url");
  return `${body}.${mac(body, keyFrom(sessionSecret)).toString("base64url")}`;
}

function readRaw(header: string | undefined): string | null {
  for (const part of (header ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === WORKSPACE_COOKIE) return rest.join("=");
  }
  return null;
}

/** The draft ids a browser may open. A missing, forged or expired cookie owns nothing. */
export function readDraftIds(header: string | undefined, sessionSecret: Buffer, nowMs: number): string[] {
  const value = readRaw(header);
  const [body, sig, extra] = value?.split(".") ?? [];
  if (!body || !sig || extra !== undefined) return [];
  const expected = mac(body, keyFrom(sessionSecret));
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return [];
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { ids?: unknown; iat?: unknown };
    if (typeof p.iat !== "number" || nowMs - p.iat > MAX_AGE_MS || !Array.isArray(p.ids)) return [];
    return p.ids.filter(isId).slice(-MAX_IDS);
  } catch {
    return [];
  }
}

export const COOKIE_MAX_AGE_MS = MAX_AGE_MS;
