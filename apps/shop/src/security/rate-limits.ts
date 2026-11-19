import type { Request, RequestHandler, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { sendError } from "../http/envelope.js";
import type { Logger } from "../log.js";

const MINUTE_MS = 60_000;
const OWNER_AUTH_WINDOW_MS = 15 * MINUTE_MS;

/** 04 §4. Each bucket has its own in-memory store, so one cannot starve another. */
export const LIMITS = {
  /**
   * Not in 04 §4: a blunt cap on every POST /mcp, before the body is parsed, so malformed bodies
   * cost something too. Set at 2.5x mcp-read so honest traffic never meets it.
   */
  mcpCoarse: { limit: 300, windowMs: MINUTE_MS },
  mcpRead: { limit: 120, windowMs: MINUTE_MS },
  quoteRest: { limit: 60, windowMs: MINUTE_MS },
  orderCreate: { limit: 20, windowMs: MINUTE_MS },
  contact: { limit: 5, windowMs: MINUTE_MS },
  ownerAuthIp: { limit: 5, windowMs: OWNER_AUTH_WINDOW_MS },
  ownerAuthGlobal: { limit: 30, windowMs: OWNER_AUTH_WINDOW_MS },
  try: { limit: 60, windowMs: MINUTE_MS },
  /** The /launch workspace pages and their status polling (a page polls about every 2 seconds). */
  workspace: { limit: 240, windowMs: MINUTE_MS },
} as const;

export interface Limiters {
  mcpCoarse: RequestHandler;
  mcpRead: RequestHandler;
  quoteRest: RequestHandler;
  orderCreate: RequestHandler;
  contact: RequestHandler;
  ownerAuthIp: RequestHandler;
  ownerAuthGlobal: RequestHandler;
  /** For the `/try/*` pages (T11). */
  try: RequestHandler;
  /** For the /launch workspace. */
  workspace: RequestHandler;
}

const GLOBAL_KEY = "owner-auth-global";

export function createLimiters(log: Logger): Limiters {
  const make = (
    name: keyof typeof LIMITS,
    extra: { skipSuccessfulRequests?: boolean; keyGenerator?: () => string } = {},
  ): RequestHandler =>
    rateLimit({
      ...LIMITS[name],
      standardHeaders: "draft-7",
      legacyHeaders: false,
      // Default key is `req.ip`, which Express derives from the exact `trust proxy` hop count.
      ...extra,
      handler: (req: Request, res: Response) => {
        log({ level: "warn", event: "rate_limited", bucket: name, requestId: res.locals.requestId });
        sendError(req, res, "RATE_LIMITED");
      },
    });
  return {
    mcpCoarse: make("mcpCoarse"),
    mcpRead: make("mcpRead"),
    quoteRest: make("quoteRest"),
    orderCreate: make("orderCreate"),
    contact: make("contact"),
    // Only failed attempts count, so the owner's own successful logins never lock them out.
    ownerAuthIp: make("ownerAuthIp", { skipSuccessfulRequests: true }),
    ownerAuthGlobal: make("ownerAuthGlobal", { skipSuccessfulRequests: true, keyGenerator: () => GLOBAL_KEY }),
    try: make("try"),
    workspace: make("workspace"),
  };
}

/**
 * Runs a limiter by hand (the MCP route only knows the bucket after parsing the body).
 * Resolves false when the limiter already answered with 429.
 */
export function charge(limiter: RequestHandler, req: Request, res: Response): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const answered = () => resolve(false);
    res.once("finish", answered);
    const next = (err?: unknown) => {
      res.off("finish", answered);
      if (err) reject(err instanceof Error ? err : new Error(String(err)));
      else resolve(true);
    };
    Promise.resolve(limiter(req, res, next)).catch(reject);
  });
}
