import { Router, type Request, type RequestHandler } from "express";
import type { OrderEvent } from "@agentdoor/core";
import { transitionOrder } from "../db/orders.js";
import { isOrderId, listContacts, listOrders } from "../db/queries.js";
import { formBody } from "../http/body.js";
import { sendError } from "../http/envelope.js";
import { requireSameOrigin } from "../security/origin.js";
import { createOwnerAuth, type OwnerAuth } from "../security/owner-auth.js";
import type { Limiters } from "../security/rate-limits.js";
import { OWNER_COOKIE, SESSION_TTL_MS, createSessionCookie, ownerTokenMatches } from "../security/session.js";
import type { ServiceContext } from "../services/context.js";
import { TransitionSchema } from "../services/schemas.js";
import { dashboardPage, loginPage, type OwnerTab } from "../views/owner.js";

const LOGIN_PATH = "/owner/login";
const MAX_TOKEN_LENGTH = 200;
const EVENT_FOR: Record<"CONFIRMED" | "DECLINED" | "CANCELLED", OrderEvent> = {
  CONFIRMED: "confirm",
  DECLINED: "decline",
  CANCELLED: "cancel",
};

export function ownerRouter(ctx: ServiceContext, limiters: Limiters, auth: OwnerAuth = createOwnerAuth(ctx)): Router {
  const { config } = ctx;
  const router = Router();
  const sameOrigin = requireSameOrigin(config);
  const secure = config.publicBaseUrl.startsWith("https://");
  const cookieOptions = { httpOnly: true, sameSite: "strict", secure, path: "/" } as const;

  const sessionKey = auth.sessionKey;
  const signedIn = auth.signedIn;
  const presentedToken = (req: Request): string =>
    typeof req.body?.token === "string" ? req.body.token.slice(0, MAX_TOKEN_LENGTH) : "";

  const requireSession: RequestHandler = (req, res, next) => {
    if (signedIn(req)) return next();
    res.redirect(303, LOGIN_PATH);
  };

  /**
   * The global bucket exists so a distributed guesser cannot brute-force the token; it must not let
   * the same guesser lock the real owner out, so a request holding the correct token skips it.
   */
  const globalUnlessCorrect: RequestHandler = (req, res, next) => {
    if (ownerTokenMatches(presentedToken(req), config.ownerTokenHash)) return next();
    limiters.ownerAuthGlobal(req, res, next);
  };

  router.get(LOGIN_PATH, (req, res) => {
    if (signedIn(req)) return res.redirect(303, "/owner");
    res.set("Cache-Control", "no-store").type("html").send(loginPage());
  });

  // Body parsing and the Origin check come first: cross-site posts are refused without being
  // counted, so an outsider cannot burn the owner's login attempts.
  router.post(LOGIN_PATH, formBody, sameOrigin, limiters.ownerAuthIp, globalUnlessCorrect, (req, res) => {
    if (!ownerTokenMatches(presentedToken(req), config.ownerTokenHash)) {
      res.status(401).type("html").send(loginPage("That token is not valid."));
      return;
    }
    res.cookie(OWNER_COOKIE, createSessionCookie(sessionKey, ctx.now()), {
      ...cookieOptions,
      maxAge: SESSION_TTL_MS,
    });
    res.redirect(303, "/owner");
  });

  router.post("/owner/logout", formBody, sameOrigin, requireSession, (_req, res) => {
    auth.revokeAll();
    res.clearCookie(OWNER_COOKIE, cookieOptions);
    res.redirect(303, LOGIN_PATH);
  });

  router.get("/owner", requireSession, async (req, res) => {
    const [orders, contacts] = await Promise.all([listOrders(ctx.pool), listContacts(ctx.pool)]);
    const tab: OwnerTab = req.query.tab === "confirmed" || req.query.tab === "all" ? req.query.tab : "pending";
    res.set("Cache-Control", "no-store").type("html").send(dashboardPage(orders, contacts, ctx.launch, tab));
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
