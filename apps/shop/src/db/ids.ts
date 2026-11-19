import { randomBytes } from "node:crypto";
import { sha256Hex } from "@agentdoor/core";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;
const BASE = 32;
const ACCESS_TOKEN_BYTES = 32;

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

/** The plain token is shown to the customer once; only its hash is stored. */
export function newAccessToken(): { token: string; hash: string } {
  const token = randomBytes(ACCESS_TOKEN_BYTES).toString("base64url");
  return { token, hash: sha256Hex(token) };
}
