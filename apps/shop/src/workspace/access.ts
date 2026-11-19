import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ACCESS_COOKIE = "ad_early";
const KEY_LABEL = "agentdoor/early-access-cookie/v1";
const HOURS = 12;
export const ACCESS_MAX_AGE_MS = HOURS * 3_600_000;
const TAG_CHARS = 16;

const keyFrom = (sessionSecret: Buffer): Buffer => createHmac("sha256", sessionSecret).update(KEY_LABEL).digest();
const mac = (body: string, key: Buffer): Buffer => createHmac("sha256", key).update(body).digest();

/** Names the current access code without revealing it, so changing the code ends every early-access session. */
const codeTag = (code: string): string => createHash("sha256").update(`${KEY_LABEL}:${code}`).digest("hex").slice(0, TAG_CHARS);

/** cookie value = base64url(JSON{iat, c}) + "." + base64url(HMAC-SHA256(key, first part)) */
export function signAccessCookie(sessionSecret: Buffer, code: string, nowMs: number): string {
  const body = Buffer.from(JSON.stringify({ iat: nowMs, c: codeTag(code) })).toString("base64url");
  return `${body}.${mac(body, keyFrom(sessionSecret)).toString("base64url")}`;
}

function readRaw(header: string | undefined): string | null {
  for (const part of (header ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === ACCESS_COOKIE) return rest.join("=");
  }
  return null;
}

/** True for a genuine, unexpired early-access cookie issued for the current code. Anything else is false. */
export function hasEarlyAccess(header: string | undefined, sessionSecret: Buffer, code: string, nowMs: number): boolean {
  const [body, sig, extra] = readRaw(header)?.split(".") ?? [];
  if (!body || !sig || extra !== undefined) return false;
  const expected = mac(body, keyFrom(sessionSecret));
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { iat?: unknown; c?: unknown };
    return typeof p.iat === "number" && nowMs - p.iat <= ACCESS_MAX_AGE_MS && p.c === codeTag(code);
  } catch {
    return false;
  }
}
