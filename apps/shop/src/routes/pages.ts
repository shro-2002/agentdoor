import { Router } from "express";
import { sendError } from "../http/envelope.js";
import { findOrderForAccess } from "../db/queries.js";
import type { Limiters } from "../security/rate-limits.js";
import { businessView } from "../services/business-view.js";
import type { ServiceContext } from "../services/context.js";
import { launchReportPage, orderStatusPage, storefrontPage } from "../views/pages.js";

/** Auth-discovery probes from MCP clients: answer JSON 404 so they conclude "no auth" (04 §4). */
const AUTH_DISCOVERY = /^\/\.well-known\/(oauth-|openid-configuration)/;

export function pagesRouter(ctx: ServiceContext, limiters: Limiters): Router {
  const router = Router();

  // The publish health probe hits `/` and needs a 200, launched or not.
  router.get("/", (_req, res) => {
    const { launch } = ctx;
    const view = launch.launched ? businessView(launch.policy, launch.policyHash) : null;
    res.type("html").send(storefrontPage(launch, view));
  });

  router.get("/launch-report", (_req, res) => {
    res.type("html").send(launchReportPage(ctx.launch));
  });

  router.get("/.well-known/agentdoor.json", (req, res) => {
    const { launch, config } = ctx;
    if (!launch.launched) return sendError(req, res, "SHOP_NOT_LAUNCHED");
    res.json({
      shop: launch.record.shop,
      policyHash: launch.policyHash,
      publicKey: config.signingPublicKey,
      mcp: "/mcp",
      launchRecord: launch.signed,
    });
  });

  router.get(AUTH_DISCOVERY, (req, res) => sendError(req, res, "NOT_FOUND"));

  router.get("/orders/:id", limiters.mcpRead, async (req, res) => {
    const token = typeof req.query.t === "string" ? req.query.t : "";
    const order = await findOrderForAccess(ctx.pool, String(req.params.id), token);
    if (!order) return sendError(req, res, "NOT_FOUND");
    const lines = ((order.request as { lines?: { itemId: string; qty: number }[] })?.lines ?? []);
    res.set("Cache-Control", "no-store");
    res.type("html").send(orderStatusPage({ ...order, lines }));
  });

  return router;
}
