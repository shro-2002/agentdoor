import { Router, type RequestHandler } from "express";
import type { OrderEvent } from "@agentdoor/core";
import { transitionOrder } from "../db/orders.js";
import { isOrderId, listContacts, listOrders } from "../db/queries.js";
import { formBody } from "../http/body.js";
import { sendError } from "../http/envelope.js";
import { requireSameOrigin } from "../security/origin.js";
import type { Limiters } from "../security/rate-limits.js";
import {
  OWNER_COOKIE,
  SESSION_TTL_MS,
  createSessionCookie,
  hasValidSession,
  ownerTokenMatches,
} from "../security/session.js";
import type { ServiceContext } from "../services/context.js";
import { TransitionSchema } from "../services/schemas.js";
import { dashboardPage, loginPage } from "../views/pages.js";

const LOGIN_PATH = "/owner/login";
const MAX_TOKEN_LENGTH = 200;
const EVENT_FOR: Record<"CONFIRMED" | "DECLINED" | "CANCELLED", OrderEvent> = {
  CONFIRMED: "confirm",
  DECLINED: "decline",
  CANCELLED: "cancel",
};

export function ownerRouter(ctx: ServiceContext, limiters: Limiters): Router {
  const { config } = ctx;
  const router = Router();
  const sameOrigin = requireSameOrigin(config);
  const secure = config.publicBaseUrl.startsWith("https://");
  const cookieOptions = { httpOnly: true, sameSite: "strict", secure, path: "/" } as const;

  const requireSession: RequestHandler = (req, res, next) => {
    if (hasValidSession(req.headers.cookie, config.sessionSecret, ctx.now())) return next();
    res.redirect(303, LOGIN_PATH);
  };

  router.get(LOGIN_PATH, (req, res) => {
    if (hasValidSession(req.headers.cookie, config.sessionSecret, ctx.now())) return res.redirect(303, "/owner");
    res.set("Cache-Control", "no-store").type("html").send(loginPage());
  });

  // Limiters run first so a flood of bad guesses is cut off before any work is done.
  router.post(LOGIN_PATH, limiters.ownerAuthIp, limiters.ownerAuthGlobal, formBody, sameOrigin, (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token.slice(0, MAX_TOKEN_LENGTH) : "";
    if (!ownerTokenMatches(token, config.ownerTokenHash)) {
      res.status(401).type("html").send(loginPage("That token is not valid."));
      return;
    }
    res.cookie(OWNER_COOKIE, createSessionCookie(config.sessionSecret, ctx.now()), {
      ...cookieOptions,
      maxAge: SESSION_TTL_MS,
    });
    res.redirect(303, "/owner");
  });

  router.post("/owner/logout", formBody, sameOrigin, (_req, res) => {
    res.clearCookie(OWNER_COOKIE, cookieOptions);
    res.redirect(303, LOGIN_PATH);
  });

  router.get("/owner", requireSession, async (_req, res) => {
    const [orders, contacts] = await Promise.all([listOrders(ctx.pool), listContacts(ctx.pool)]);
    res.set("Cache-Control", "no-store").type("html").send(dashboardPage(orders, contacts));
  });

  router.post("/owner/orders/:id/transition", formBody, sameOrigin, requireSession, async (req, res) => {
    const body = TransitionSchema.safeParse(req.body);
    if (!body.success) return sendError(req, res, "VALIDATION_FAILED");
    const id = String(req.params.id);
    if (!isOrderId(id)) return sendError(req, res, "NOT_FOUND");
    const result = await transitionOrder(ctx.pool, id, EVENT_FOR[body.data.to], { nowMs: ctx.now() });
    if (result.ok) {
      ctx.log({ level: "info", event: "order_transition", orderId: id, from: result.from, to: result.to });
      return res.redirect(303, "/owner");
    }
    if (result.code === "ORDER_NOT_FOUND") return sendError(req, res, "NOT_FOUND");
    if (result.code === "RETRY_LATER") return sendError(req, res, "RETRY_LATER");
    sendError(req, res, "INVALID_TRANSITION");
  });

  return router;
}
