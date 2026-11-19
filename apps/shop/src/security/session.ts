import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const OWNER_COOKIE = "ad_owner";
export const SESSION_TTL_MS = 8 * 3_600_000;
const MS_PER_SECOND = 1000;
const SESSION_KEY_LABEL = "agentdoor/owner-session/v1:";
/** Tolerates small clock differences between instances. */
const IAT_SKEW_SECONDS = 60;

interface SessionPayload {
  iat: number;
  exp: number;
  /** Millisecond issue time: lets logout revoke earlier cookies without a session table. */
  iatMs: number;
}

const mac = (payload: string, secret: Buffer): Buffer => createHmac("sha256", secret).update(payload).digest();

const safeEqual = (a: Buffer, b: Buffer): boolean => a.length === b.length && timingSafeEqual(a, b);

/**
 * Cookie key = HMAC(SESSION_SECRET, label + OWNER_TOKEN_HASH): rotating the owner token ends
 * every session, and the key is never the raw secret that also derives order access tokens.
 */
export function deriveSessionKey(sessionSecret: Buffer, ownerTokenHashHex: string): Buffer {
  return createHmac("sha256", sessionSecret).update(SESSION_KEY_LABEL + ownerTokenHashHex).digest();
}

/** cookie value = base64url(JSON{iat,exp,iatMs}) + "." + base64url(HMAC-SHA256(key, first part)) */
export function createSessionCookie(secret: Buffer, nowMs: number): string {
  const iat = Math.floor(nowMs / MS_PER_SECOND);
  const payload: SessionPayload = { iat, exp: iat + SESSION_TTL_MS / MS_PER_SECOND, iatMs: nowMs };
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

/** `notBeforeMs`: cookies issued before this instant (the last logout) are dead. */
export function hasValidSession(
  cookieHeader: string | undefined,
  secret: Buffer,
  nowMs: number,
  notBeforeMs = 0,
): boolean {
  const value = readCookie(cookieHeader, OWNER_COOKIE);
  const [body, sig, extra] = value?.split(".") ?? [];
  if (!body || !sig || extra !== undefined) return false;
  if (!safeEqual(mac(body, secret), Buffer.from(sig, "base64url"))) return false;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    const nowSec = nowMs / MS_PER_SECOND;
    return (
      Number.isFinite(p.exp) &&
      Number.isFinite(p.iat) &&
      Number.isFinite(p.iatMs) &&
      p.iatMs >= notBeforeMs &&
      nowSec < p.exp &&
      p.iat <= nowSec + IAT_SKEW_SECONDS
    );
  } catch {
    return false;
  }
}

/** Both sides are 32-byte SHA-256 digests, so the comparison is constant-time and equal-length. */
export function ownerTokenMatches(presented: string, ownerTokenHashHex: string): boolean {
  const digest = createHash("sha256").update(presented).digest();
  return safeEqual(digest, Buffer.from(ownerTokenHashHex, "hex"));
}
