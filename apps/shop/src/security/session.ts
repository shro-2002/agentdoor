import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const OWNER_COOKIE = "ad_owner";
export const SESSION_TTL_MS = 8 * 3_600_000;
const MS_PER_SECOND = 1000;
/** Tolerates small clock differences between instances. */
const IAT_SKEW_SECONDS = 60;

interface SessionPayload {
  iat: number;
  exp: number;
}

const mac = (payload: string, secret: Buffer): Buffer => createHmac("sha256", secret).update(payload).digest();

const safeEqual = (a: Buffer, b: Buffer): boolean => a.length === b.length && timingSafeEqual(a, b);

/** cookie value = base64url(JSON{iat,exp}) + "." + base64url(HMAC-SHA256(secret, first part)) */
export function createSessionCookie(secret: Buffer, nowMs: number): string {
  const iat = Math.floor(nowMs / MS_PER_SECOND);
  const payload: SessionPayload = { iat, exp: iat + SESSION_TTL_MS / MS_PER_SECOND };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(body, secret).toString("base64url")}`;
}

function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function hasValidSession(cookieHeader: string | undefined, secret: Buffer, nowMs: number): boolean {
  const value = readCookie(cookieHeader, OWNER_COOKIE);
  const [body, sig, extra] = value?.split(".") ?? [];
  if (!body || !sig || extra !== undefined) return false;
  if (!safeEqual(mac(body, secret), Buffer.from(sig, "base64url"))) return false;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    const nowSec = nowMs / MS_PER_SECOND;
    return Number.isFinite(p.exp) && Number.isFinite(p.iat) && nowSec < p.exp && p.iat <= nowSec + IAT_SKEW_SECONDS;
  } catch {
    return false;
  }
}

/** Both sides are 32-byte SHA-256 digests, so the comparison is constant-time and equal-length. */
export function ownerTokenMatches(presented: string, ownerTokenHashHex: string): boolean {
  const digest = createHash("sha256").update(presented).digest();
  return safeEqual(digest, Buffer.from(ownerTokenHashHex, "hex"));
}
