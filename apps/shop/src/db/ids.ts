import { createHmac, randomBytes } from "node:crypto";
import { sha256Hex } from "@agentdoor/core";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;
const BASE = 32;
/** Domain separation: the same SESSION_SECRET keys other things, never with this label. */
const ACCESS_KEY_LABEL = "agentdoor/order-access-token/v1";

/** 26-char ULID-like id: 10 time chars (sortable, from the injected clock) + 16 random. */
export function newOrderId(nowMs: number): string {
  let time = "";
  let t = nowMs;
  for (let i = 0; i < TIME_CHARS; i += 1) {
    time = CROCKFORD[t % BASE]! + time;
    t = Math.floor(t / BASE);
  }
  const rnd = randomBytes(RANDOM_CHARS);
  let tail = "";
  for (const byte of rnd) tail += CROCKFORD[byte % BASE]!;
  return time + tail;
}

/**
 * The customer's order-status token is reproducible from the order id and a server secret, so a
 * replayed order request can hand it out again after a lost response. Only its hash is stored.
 */
export function deriveAccessToken(secret: Buffer, orderId: string): { token: string; hash: string } {
  const key = createHmac("sha256", secret).update(ACCESS_KEY_LABEL).digest();
  const token = createHmac("sha256", key).update(orderId).digest("base64url");
  return { token, hash: sha256Hex(token) };
}
