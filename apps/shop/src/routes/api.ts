import { Router } from "express";
import { sendData, sendError, withMessages } from "../http/envelope.js";
import { jsonBody } from "../http/body.js";
import { findOrderForAccess } from "../db/queries.js";
import type { Limiters } from "../security/rate-limits.js";
import { businessView } from "../services/business-view.js";
import type { ServiceContext } from "../services/context.js";
import { placeOrder } from "../services/order-service.js";
import { getQuote } from "../services/quote-service.js";
import { RestOrderSchema } from "../services/schemas.js";

export const SHOP_VERSION = "0.0.1";

export function apiRouter(ctx: ServiceContext, limiters: Limiters): Router {
  const router = Router();

  router.get("/healthz", (_req, res) => {
    const { launch } = ctx;
    sendData(res, 200, {
      ok: true,
      launched: launch.launched,
      policyHash: launch.launched ? launch.policyHash : null,
      version: SHOP_VERSION,
    });
  });

  router.get("/api/business", limiters.mcpRead, (req, res) => {
    if (!ctx.launch.launched) return sendError(req, res, "SHOP_NOT_LAUNCHED");
    sendData(res, 200, businessView(ctx.launch.policy, ctx.launch.policyHash));
  });

  router.post("/api/quotes", limiters.quoteRest, jsonBody, (req, res) => {
    const out = getQuote(ctx, req.body);
    if (out.kind === "ERROR") return sendError(req, res, out.code);
    if (out.kind !== "QUOTED") {
      const reasons = withMessages(out.reasons);
      return sendError(req, res, out.reasons[0]?.code ?? "VALIDATION_FAILED", {
        status: 422,
        message: reasons[0]?.message,
        data: { outcome: out.kind, reasons },
      });
    }
    const { token, totalPaise, lines, expiresAt, isRush, reasons } = out;
    sendData(res, 201, { quote: { token, totalPaise, lines, expiresAt, isRush }, reasons: withMessages(reasons) });
  });

  router.post("/api/orders", limiters.orderCreate, jsonBody, async (req, res) => {
    const body = RestOrderSchema.safeParse(req.body);
    if (!body.success) return sendError(req, res, "VALIDATION_FAILED");
    const { customer } = body.data;
    const out = await placeOrder(ctx, {
      quoteToken: body.data.quoteToken,
      customerName: customer.name,
      customerPhone: customer.phone,
      deliveryAddress: customer.address ?? null,
      notes: body.data.notes ?? null,
      idempotencyKey: body.data.idempotencyKey,
      channel: "web",
    });
    if (out.kind === "ERROR") return sendError(req, res, out.code);
    const { orderId, status, accessToken } = out;
    sendData(res, out.created ? 201 : 200, { orderId, status, accessToken });
  });

  router.get("/api/orders/:id", limiters.mcpRead, async (req, res) => {
    const token = typeof req.query.t === "string" ? req.query.t : "";
    const order = await findOrderForAccess(ctx.pool, String(req.params.id), token);
    if (!order) return sendError(req, res, "NOT_FOUND");
    sendData(res, 200, { orderId: order.orderId, status: order.status, summary: orderSummary(order) });
  });

  return router;
}

/** What a customer may see: no phone or address, only the order itself. */
export function orderSummary(order: NonNullable<Awaited<ReturnType<typeof findOrderForAccess>>>) {
  const request = (order.request ?? {}) as { lines?: unknown; fulfilment?: unknown };
  return {
    fulfilDate: order.fulfilDate,
    totalPaise: order.totalPaise,
    isRush: order.isRush,
    lines: request.lines ?? [],
    fulfilment: request.fulfilment ?? null,
    placedVia: order.channel,
  };
}
