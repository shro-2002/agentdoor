import {
  QuoteRequestSchema,
  capacityOn,
  evaluate,
  fulfilmentInstantMs,
  decodeQuoteToken,
  type BusinessPolicy,
  type OrderStatus,
  type QuoteTokenPayload,
} from "@agentdoor/core";
import { isTransientDbError } from "../db/errors.js";
import { findReplay, placeOrder as placeOrderInDb, type PlaceOrderResult } from "../db/orders.js";
import { maskPhone } from "../log.js";
import type { ServiceContext } from "./context.js";

const MS_PER_SECOND = 1000;

export interface OrderCommand {
  quoteToken: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string | null;
  notes: string | null;
  idempotencyKey: string;
  channel: "web" | "mcp";
}

export type OrderErrorCode =
  | "SHOP_NOT_LAUNCHED"
  | "QUOTE_INVALID"
  | "QUOTE_EXPIRED"
  | "QUOTE_STALE_POLICY"
  | "QUOTE_ALREADY_USED"
  | "IDEMPOTENCY_CONFLICT"
  | "CAPACITY_FULL"
  | "RUSH_CAP_REACHED"
  | "RETRY_LATER";

export type OrderOutcome =
  | { kind: "OK"; created: boolean; orderId: string; status: OrderStatus; accessToken: string; statusUrl: string }
  | { kind: "ERROR"; code: OrderErrorCode };

const fail = (code: OrderErrorCode): OrderOutcome => ({ kind: "ERROR", code });

/**
 * Defence in depth (03 §5.2): the signature proves we issued the token, but the engine must
 * still agree with every number in it, at the instant it was issued.
 */
function engineAgrees(policy: BusinessPolicy, q: QuoteTokenPayload): boolean {
  const request = QuoteRequestSchema.safeParse(q.request);
  if (!request.success) return false;
  const again = evaluate(policy, request.data, q.iat * MS_PER_SECOND);
  return (
    again.outcome === "QUOTED" &&
    again.totalPaise === q.totalPaise &&
    again.capacityUnits === q.capacityUnits &&
    again.isRush === q.isRush &&
    q.shop === policy.business.slug
  );
}

/** The customer's status page; the token is reproducible, so replays return the same link. */
export const statusUrlFor = (publicBaseUrl: string, orderId: string, token: string): string =>
  `${publicBaseUrl.replace(/\/$/, "")}/orders/${orderId}?t=${token}`;

/** Freshness checks that apply only to a NEW order, never to the replay of an existing one. */
function freshnessError(ctx: ServiceContext, quote: QuoteTokenPayload, nowMs: number): OrderErrorCode | null {
  if (!ctx.launch.launched) return "SHOP_NOT_LAUNCHED";
  if (Math.floor(nowMs / MS_PER_SECOND) >= quote.exp) return "QUOTE_EXPIRED";
  // Lead time was checked at `iat` only; a quote must not buy a slot whose pickup already passed.
  // (Re-running the engine at now is not done: lead time may lapse minutes after a fair quote.)
  const date = (quote.request as { date: string }).date;
  if (fulfilmentInstantMs(date) <= nowMs) return "QUOTE_EXPIRED";
  if (quote.policyHash !== ctx.launch.policyHash) return "QUOTE_STALE_POLICY";
  if (!engineAgrees(ctx.launch.policy, quote)) return "QUOTE_INVALID";
  return null;
}

function toOutcome(ctx: ServiceContext, cmd: OrderCommand, quote: QuoteTokenPayload, r: PlaceOrderResult): OrderOutcome {
  if (!r.ok) return fail(r.code);
  ctx.log({
    level: "info",
    event: r.created ? "order_placed" : "order_replayed",
    orderId: r.orderId,
    channel: cmd.channel,
    totalPaise: quote.totalPaise,
    phone: maskPhone(cmd.customerPhone),
  });
  const statusUrl = statusUrlFor(ctx.config.publicBaseUrl, r.orderId, r.accessToken);
  return { kind: "OK", created: r.created, orderId: r.orderId, status: r.status, accessToken: r.accessToken, statusUrl };
}

/**
 * Shared by REST `POST /api/orders` and MCP `place_order`. Order of checks: signature and shape,
 * then idempotent replay (a lost response must be recoverable after expiry or a redeploy), then
 * expiry, policy hash and the engine re-check for a new order.
 */
export async function placeOrder(ctx: ServiceContext, cmd: OrderCommand): Promise<OrderOutcome> {
  if (!ctx.launch.launched) return fail("SHOP_NOT_LAUNCHED");
  const { policy } = ctx.launch;
  const nowMs = ctx.now();
  const decoded = decodeQuoteToken(cmd.quoteToken, ctx.config.signingPublicKey);
  if (!decoded.ok) return fail(decoded.code);
  const quote = decoded.payload;
  const customer = {
    name: cmd.customerName,
    phone: cmd.customerPhone,
    deliveryAddress: cmd.deliveryAddress,
    notes: cmd.notes,
  };
  const accessSecret = ctx.config.sessionSecret;
  try {
    const replay = await findReplay(ctx.pool, { quote, customer, idempotencyKey: cmd.idempotencyKey, accessSecret });
    if (replay) return toOutcome(ctx, cmd, quote, replay);
    const refusal = freshnessError(ctx, quote, nowMs);
    if (refusal) return fail(refusal);
    const date = (quote.request as { date: string }).date;
    const result = await placeOrderInDb(ctx.pool, {
      quote,
      fulfilDate: date,
      capacity: { unitsCap: capacityOn(policy, date), rushCap: policy.rush?.maxRushUnitsPerDay ?? 0 },
      customer,
      idempotencyKey: cmd.idempotencyKey,
      channel: cmd.channel,
      nowMs,
      accessSecret,
    });
    return toOutcome(ctx, cmd, quote, result);
  } catch (err) {
    if (!isTransientDbError(err)) throw err;
    ctx.log({ level: "error", event: "db_unavailable", message: (err as Error).message });
    return fail("RETRY_LATER");
  }
}
