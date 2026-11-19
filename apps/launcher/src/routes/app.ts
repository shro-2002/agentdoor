import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from "express";
import { LauncherError } from "../claude/errors.js";
import type { Deps } from "../flows/compile.js";
import { fail } from "./envelope.js";
import { sessionRouter } from "./session.js";

const BODY_LIMIT = "64kb";
const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_SERVER_ERROR_MIN = 500;

const withRequestId: RequestHandler = (_req, res, next) => {
  res.locals.requestId = randomUUID();
  next();
};

const notFound: RequestHandler = (_req, res) => fail(res, 404, "NOT_FOUND", "No such route.");

/** Known launcher errors keep their code; body-parser 4xx become VALIDATION_FAILED; the rest are a bare 500 (no stack). */
const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  if (err instanceof LauncherError) return fail(res, err.status, err.code, err.message);
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number" && status >= HTTP_CLIENT_ERROR_MIN && status < HTTP_SERVER_ERROR_MIN)
    return fail(res, status, "VALIDATION_FAILED", "The request was not valid.");
  console.error("launcher internal error", err instanceof Error ? err.name : "unknown");
  return fail(res, 500, "INTERNAL", "Something went wrong.");
};

/** The launcher is bound to 127.0.0.1 by server.ts (T10); this builds the routes T07 owns. */
export function createApp(deps: Deps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(withRequestId);
  app.use(express.json({ limit: BODY_LIMIT }));
  app.use("/api", sessionRouter(deps));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
