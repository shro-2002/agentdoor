import { Router } from "express";
import { sendError } from "../http/envelope.js";
import { findOrderForAccess } from "../db/queries.js";
import type { Limiters } from "../security/rate-limits.js";
import type { ServiceContext } from "../services/context.js";
import { liveRunFigures } from "../services/figures.js";
import { statusUrlFor } from "../services/order-service.js";
import { runLive } from "../services/try-live.js";
import { defaultBundleDir, sessionLoader } from "../services/try-session.js";
import { launchPage } from "../views/launch/page.js";
import { buildLaunchStory } from "../views/launch/story.js";
import { launchReportPage } from "../views/report.js";
import { storefrontPage } from "../views/storefront.js";
import { orderStatusPage } from "../views/status.js";
import { assetsRouter } from "./assets.js";
import { orderRouter } from "./order.js";
import { tryRouter } from "./try.js";

/** Auth-discovery probes from MCP clients: answer JSON 404 so they conclude "no auth" (04 §4). */
const AUTH_DISCOVERY = /^\/\.well-known\/(oauth-|openid-configuration)/;

export function pagesRouter(ctx: ServiceContext, limiters: Limiters): Router {
  const router = Router();
  router.use(assetsRouter());
  router.use(orderRouter(ctx, limiters));
  router.use(tryRouter(ctx, limiters));

  // The publish health probe hits `/` and needs a 200, launched or not.
  router.get("/", (_req, res) => {
    res.type("html").send(storefrontPage(ctx.launch));
  });

  const loadSession = sessionLoader(defaultBundleDir());
  // The AgentDoor landing page quotes the recorded launch's numbers (a memoised rehearsal run), so it shares the /try bucket.
  router.use("/launch", limiters.try);
  router.get("/launch", (_req, res) => {
    const l = loadSession();
    const record = ctx.launch.launched ? ctx.launch.record : null;
    res.type("html").send(launchPage(l.ok ? buildLaunchStory(l.session, record, ctx.now()) : null));
  });

  // Public and CPU-heavy (it re-runs a rehearsal): same bucket as the /try pages.
  router.use("/launch-report", limiters.try);
  router.get("/launch-report", (_req, res) => {
    const l = loadSession();
    const extras = l.ok
      ? { evidence: l.session.compile.result.evidence, firstRun: liveRunFigures("First rehearsal run", runLive(l.session, 1, ctx.now())) }
      : {};
    res.type("html").send(launchReportPage(ctx.launch, ctx.config.publicBaseUrl, extras));
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
    res.set("Cache-Control", "no-store");
    const selfPath = `/orders/${order.orderId}?t=${token}`;
    res.type("html").send(orderStatusPage(order, ctx.launch, selfPath, statusUrlFor(ctx.config.publicBaseUrl, order.orderId, token)));
  });

  return router;
}
