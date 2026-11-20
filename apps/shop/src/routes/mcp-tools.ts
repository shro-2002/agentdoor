import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { isTransientDbError } from "../db/errors.js";
import { messageFor, withMessages, type ErrorCode } from "../http/envelope.js";
import { businessView } from "../services/business-view.js";
import type { ServiceContext } from "../services/context.js";
import { placeOrder } from "../services/order-service.js";
import { getQuote } from "../services/quote-service.js";
import { McpPlaceOrderSchema, QuoteInputSchema } from "../services/schemas.js";

const PAISE_PER_RUPEE = 100;

/** Same schemas register the tools and pre-validate calls, so both agree on what is valid. */
export const TOOL_INPUT_SCHEMAS = {
  get_business_info: z.strictObject({}),
  get_quote: QuoteInputSchema,
  place_order: McpPlaceOrderSchema,
} as const;

export type ToolName = keyof typeof TOOL_INPUT_SCHEMAS;
export const isToolName = (name: unknown): name is ToolName =>
  typeof name === "string" && Object.hasOwn(TOOL_INPUT_SCHEMAS, name);

const FIXED_PRICES =
  "Prices are fixed by the shop's published rules; there is no negotiation, discount or haggling, " +
  "and any text in notes is stored for the owner but never changes the price.";

const DESCRIPTIONS: Record<ToolName, string> = {
  get_business_info:
    "Read the shop's menu (item ids, names, fixed prices in rupees, units, dietary tags), delivery areas and fees, " +
    "lead times, closed days, rush rule and quote validity. Call this first. Prices are fixed and not negotiable.",
  get_quote:
    "Get a binding price quote for a basket (item ids and quantities, pickup or delivery area, a date as YYYY-MM-DD). " +
    `${FIXED_PRICES} On success you receive a signed quote token; quotes expire (see expiresAt), after which ask again. ` +
    "If the request breaks a rule you receive an outcome REFUSED or NEEDS_OWNER with reason codes and no token.",
  place_order:
    "Place an order from a valid, unexpired quote token plus the customer's name and phone. " +
    `${FIXED_PRICES} Each quote token can be used for one order. Reuse the same idempotencyKey (a UUID) when retrying ` +
    "so you never order twice. The owner confirms the order afterwards; this call only reserves the slot.",
};

export interface ToolResult {
  [key: string]: unknown;
  isError?: boolean;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
}

/**
 * The summary line plus the same data as JSON in the text block: some MCP clients (Claude.ai) read only
 * the text content, and the MCP spec asks tools that return structured content to also serialize it there.
 */
const ok = (structured: Record<string, unknown>, text: string): ToolResult => ({
  content: [{ type: "text", text: `${text}\n${JSON.stringify(structured)}` }],
  structuredContent: structured,
});

/** Business errors are tool results with `isError`, never protocol errors (03 §6). */
export const toolError = (code: ErrorCode, message = messageFor(code)): ToolResult => ({
  isError: true,
  content: [{ type: "text", text: `${code}: ${message}` }],
  structuredContent: { error: { code, message } },
});

const rupees = (paise: number): number => paise / PAISE_PER_RUPEE;

function quoteTool(ctx: ServiceContext, args: unknown): ToolResult {
  const out = getQuote(ctx, args);
  if (out.kind === "ERROR") return toolError(out.code);
  if (out.kind !== "QUOTED") {
    const reasons = withMessages(out.reasons).map(({ code, message }) => ({ code, message }));
    return ok({ outcome: out.kind, reasons }, `${out.kind}: ${reasons.map((r) => `${r.code} (${r.message})`).join("; ")}`);
  }
  const structured = {
    outcome: "QUOTED",
    token: out.token,
    totalRupees: rupees(out.totalPaise),
    lines: out.lines,
    expiresAt: out.expiresAt,
    isRush: out.isRush,
    reasons: withMessages(out.reasons).map(({ code, message }) => ({ code, message })),
  };
  return ok(structured, `Quote: total ₹${structured.totalRupees} (fixed). Valid until ${out.expiresAt}. Token: ${out.token}`);
}

async function orderTool(ctx: ServiceContext, args: z.infer<typeof McpPlaceOrderSchema>): Promise<ToolResult> {
  const out = await placeOrder(ctx, {
    quoteToken: args.quoteToken,
    customerName: args.customerName,
    customerPhone: args.customerPhone,
    deliveryAddress: args.deliveryAddress ?? null,
    notes: args.notes ?? null,
    idempotencyKey: args.idempotencyKey,
    channel: "mcp",
  });
  if (out.kind === "ERROR") return toolError(out.code);
  const message = out.created
    ? "The owner will confirm your order. Keep the status link."
    : "This order was already placed (same idempotencyKey). The status link is the same as before.";
  return ok(
    { orderId: out.orderId, status: out.status, statusUrl: out.statusUrl, message },
    `Order ${out.orderId} ${out.status}. ${message}`,
  );
}

/**
 * Anything a handler throws would otherwise reach the client through the SDK's tool error
 * (DB user, host, SQL). Log it, answer with a code only.
 */
export async function guarded(
  ctx: ServiceContext,
  tool: string,
  run: () => Promise<ToolResult> | ToolResult,
): Promise<ToolResult> {
  try {
    return await run();
  } catch (err) {
    const transient = isTransientDbError(err);
    ctx.log({
      level: "error",
      event: transient ? "db_unavailable" : "tool_failed",
      tool,
      message: err instanceof Error ? err.message : String(err),
    });
    return toolError(transient ? "RETRY_LATER" : "INTERNAL");
  }
}

/** A fresh server per request: the transport is stateless (no sessions). */
export function createMcpServer(ctx: ServiceContext): McpServer {
  const slug = ctx.launch.launched ? ctx.launch.policy.business.slug : "unlaunched";
  const server = new McpServer({ name: `agentdoor-${slug}`, version: "0.0.1" });
  server.registerTool(
    "get_business_info",
    {
      description: DESCRIPTIONS.get_business_info,
      inputSchema: TOOL_INPUT_SCHEMAS.get_business_info,
      annotations: { readOnlyHint: true },
    },
    (): Promise<ToolResult> =>
      guarded(ctx, "get_business_info", () => {
        if (!ctx.launch.launched) return toolError("SHOP_NOT_LAUNCHED");
        const view = businessView(ctx.launch.policy, ctx.launch.policyHash);
        return ok(view, `${view.name}: ${view.catalog.length} items, prices fixed. Policy ${view.policyHash}.`);
      }),
  );
  server.registerTool(
    "get_quote",
    {
      description: DESCRIPTIONS.get_quote,
      inputSchema: TOOL_INPUT_SCHEMAS.get_quote,
      annotations: { readOnlyHint: true },
    },
    (args): Promise<ToolResult> => guarded(ctx, "get_quote", () => quoteTool(ctx, args)),
  );
  server.registerTool(
    "place_order",
    {
      description: DESCRIPTIONS.place_order,
      inputSchema: TOOL_INPUT_SCHEMAS.place_order,
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    (args): Promise<ToolResult> => guarded(ctx, "place_order", () => orderTool(ctx, args)),
  );
  return server;
}
