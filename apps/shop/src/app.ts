import express, { type ErrorRequestHandler, type Express } from "express";
import type { Pool } from "mysql2/promise";
import type { ShopConfig } from "./config.js";
import type { LaunchState } from "./db/launch-state.js";
import { isTransientDbError } from "./db/errors.js";
import { sendError } from "./http/envelope.js";
import { stdoutLogger, type Logger } from "./log.js";
import { apiRouter } from "./routes/api.js";
import { contactRouter, type SendEmail } from "./routes/contact.js";
import { mcpRouter } from "./routes/mcp.js";
import { ownerRouter } from "./routes/owner.js";
import { pagesRouter } from "./routes/pages.js";
import { requestId, securityHeaders } from "./security/headers.js";
import { createLimiters } from "./security/rate-limits.js";
import type { ServiceContext } from "./services/context.js";

/**
 * Measured in T01 (spike/RESULTS.md): the GoDaddy edge is exactly one hop in front of the app and
 * appends the real client IP as the last X-Forwarded-For entry. Never `true`: that would trust a
 * client-forged header and let anyone pick their own rate-limit key.
 */
export const TRUSTED_PROXY_HOPS = 1;

export interface AppDeps {
  config: ShopConfig;
  pool: Pool;
  launch: LaunchState;
  now?: () => number;
  log?: Logger;
  sendEmail?: SendEmail;
  trustProxyHops?: number;
}

const BODY_PARSER_STATUS: Record<string, number> = { "entity.too.large": 413 };

const errorHandler = (log: Logger): ErrorRequestHandler => (err, req, res, _next) => {
  if (res.headersSent) return;
  const type = (err as { type?: string }).type;
  if (typeof type === "string" && type.startsWith("entity.")) {
    return sendError(req, res, "VALIDATION_FAILED", { status: BODY_PARSER_STATUS[type] ?? 400 });
  }
  const message = err instanceof Error ? err.message : String(err);
  if (isTransientDbError(err)) {
    log({ level: "error", event: "db_unavailable", requestId: res.locals.requestId, message });
    return sendError(req, res, "RETRY_LATER");
  }
  // The message goes to the log only; clients never see messages or stacks.
  log({ level: "error", event: "unhandled_error", requestId: res.locals.requestId, message });
  sendError(req, res, "INTERNAL");
};

export function createApp(deps: AppDeps): Express {
  const log = deps.log ?? stdoutLogger;
  const ctx: ServiceContext = {
    config: deps.config,
    pool: deps.pool,
    launch: deps.launch,
    now: deps.now ?? Date.now,
    log,
  };
  const limiters = createLimiters(log);
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", deps.trustProxyHops ?? TRUSTED_PROXY_HOPS);

  app.use(requestId);
  app.use(securityHeaders(deps.config.publicBaseUrl));
  app.use((req, res, next) => {
    const start = performance.now();
    res.on("finish", () => {
      // Route template, not the URL: order ids and `?t=` access tokens never reach the log.
      const route = req.route ? `${req.baseUrl}${String(req.route.path)}` : "unmatched";
      log({
        level: "info",
        event: "request",
        requestId: res.locals.requestId,
        method: req.method,
        route,
        status: res.statusCode,
        ms: Math.round(performance.now() - start),
      });
    });
    next();
  });

  app.use(apiRouter(ctx, limiters));
  app.use(mcpRouter(ctx, limiters));
  app.use(ownerRouter(ctx, limiters));
  app.use(contactRouter(ctx, limiters, deps.sendEmail));
  app.use(pagesRouter(ctx, limiters));
  app.use((req, res) => sendError(req, res, "NOT_FOUND"));
  app.use(errorHandler(log));
  return app;
}
