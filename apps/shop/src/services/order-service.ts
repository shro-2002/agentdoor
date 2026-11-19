import {
  QuoteRequestSchema,
  capacityOn,
  evaluate,
  verifyQuoteToken,
  type BusinessPolicy,
  type OrderStatus,
  type QuoteTokenPayload,
} from "@agentdoor/core";
import { isTransientDbError } from "../db/errors.js";
import { placeOrder as placeOrderInDb } from "../db/orders.js";
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
  | { kind: "OK"; created: boolean; orderId: string; status: OrderStatus; accessToken?: string }
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

/** Shared by REST `POST /api/orders` and MCP `place_order`. */
export async function placeOrder(ctx: ServiceContext, cmd: OrderCommand): Promise<OrderOutcome> {
  if (!ctx.launch.launched) return fail("SHOP_NOT_LAUNCHED");
  const { policy, policyHash } = ctx.launch;
  const nowMs = ctx.now();
  const verified = verifyQuoteToken(cmd.quoteToken, ctx.config.signingPublicKey, {
    currentPolicyHash: policyHash,
    nowSec: Math.floor(nowMs / MS_PER_SECOND),
  });
  if (!verified.ok) return fail(verified.code);
  const quote = verified.payload;
  if (!engineAgrees(policy, quote)) return fail("QUOTE_INVALID");
  const date = (quote.request as { date: string }).date;
  try {
    const result = await placeOrderInDb(ctx.pool, {
      quote,
      fulfilDate: date,
      capacity: { unitsCap: capacityOn(policy, date), rushCap: policy.rush?.maxRushUnitsPerDay ?? 0 },
      customer: {
        name: cmd.customerName,
        phone: cmd.customerPhone,
        deliveryAddress: cmd.deliveryAddress,
        notes: cmd.notes,
      },
      idempotencyKey: cmd.idempotencyKey,
      channel: cmd.channel,
      nowMs,
    });
    if (!result.ok) return fail(result.code);
    ctx.log({
      level: "info",
      event: result.created ? "order_placed" : "order_replayed",
      orderId: result.orderId,
      channel: cmd.channel,
      totalPaise: quote.totalPaise,
      phone: maskPhone(cmd.customerPhone),
    });
    return { kind: "OK", created: result.created, orderId: result.orderId, status: result.status, accessToken: result.accessToken };
  } catch (err) {
    if (!isTransientDbError(err)) throw err;
    ctx.log({ level: "error", event: "db_unavailable", message: (err as Error).message });
    return fail("RETRY_LATER");
  }
}
