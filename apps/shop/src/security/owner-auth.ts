import type { Request } from "express";
import type { ServiceContext } from "../services/context.js";
import { deriveSessionKey, hasValidSession } from "./session.js";

export interface OwnerAuth {
  /** The cookie key (never leaves the server). */
  readonly sessionKey: Buffer;
  signedIn(req: Request): boolean;
  /** Logout: every cookie issued up to now stops working. */
  revokeAll(): void;
}

/**
 * One definition of "is this the signed-in shop owner", shared by /owner and the workspace's
 * publishing step. Cookies are keyed by SESSION_SECRET + the owner token hash, so rotating the token
 * ends them all. The revocation time is in memory by design: a restart forgets it, cookies still expire.
 */
export function createOwnerAuth(ctx: Pick<ServiceContext, "config" | "now">): OwnerAuth {
  const sessionKey = deriveSessionKey(ctx.config.sessionSecret, ctx.config.ownerTokenHash);
  let notBeforeMs = 0;
  return {
    sessionKey,
    signedIn: (req) => hasValidSession(req.headers.cookie, sessionKey, ctx.now(), notBeforeMs),
    revokeAll: () => {
      notBeforeMs = ctx.now();
    },
  };
}
