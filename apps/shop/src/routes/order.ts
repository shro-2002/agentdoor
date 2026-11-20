import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { decodeQuoteToken, evaluate, QuoteRequestSchema, type BusinessPolicy, type QuoteRequest } from "@agentdoor/core";
import { formBody } from "../http/body.js";
import { messageFor, sendError, type ErrorCode } from "../http/envelope.js";
import { requireSameOrigin } from "../security/origin.js";
import type { Limiters } from "../security/rate-limits.js";
import type { ServiceContext } from "../services/context.js";
import { placeOrder, type OrderErrorCode } from "../services/order-service.js";
import { getQuote } from "../services/quote-service.js";
import { RestOrderSchema } from "../services/schemas.js";
import { earliestStandardDate } from "../views/format.js";
import {
  OTHER_AREA,
  emptyValues,
  firstWorkingDate,
  orderPage,
  problemsFor,
  quotePage,
  type CustomerValues,
  type OrderFormValues,
  type Problem,
  type QuoteView,
} from "../views/order.js";

const MAX_NOTES = 500;
const MAX_AREA = 80;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_SECOND = 1000;

type Source = Record<string, unknown>;
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const many = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []).filter((x): x is string => typeof x === "string");

/** The form as the visitor typed it. Works on a POST body and on the `?` query of a "change my order" link. */
function parseValues(src: Source, policy: BusinessPolicy): OrderFormValues {
  const v = emptyValues();
  for (const item of policy.catalog) {
    const qty = text(src[`qty.${item.id}`], 6).trim();
    if (qty) v.qty[item.id] = qty;
    for (const o of many(src[`opt.${item.id}`])) v.options.push(`${item.id}:${o}`);
  }
  const preset = text(src.item, 60);
  if (preset && !v.qty[preset]) {
    const item = policy.catalog.find((c) => c.id === preset);
    if (item) v.qty[item.id] = String(item.minQty);
  }
  const date = text(src.date, 10);
  v.date = DATE_RE.test(date) ? date : "";
  v.fulfilment = src.fulfilment === "delivery" ? "delivery" : "pickup";
  v.area = text(src.area, MAX_AREA);
  v.otherArea = text(src.otherArea, MAX_AREA);
  v.notes = text(src.notes, MAX_NOTES);
  return v;
}

interface Built {
  request?: QuoteRequest;
  problems: Problem[];
}

/** Values -> engine request. Anything the visitor can get wrong in the form is a sentence, not an error page. */
function buildRequest(v: OrderFormValues, policy: BusinessPolicy): Built {
  const problems: Problem[] = [];
  const lines: QuoteRequest["lines"] = [];
  for (const item of policy.catalog) {
    const raw = v.qty[item.id];
    if (raw === undefined) continue;
    const qty = Number(raw);
    if (!Number.isInteger(qty) || qty < 0) {
      problems.push({ field: "items", text: `${item.name.en}: please use a whole number.` });
      continue;
    }
    if (qty === 0) continue;
    const optionIds = v.options.filter((o) => o.startsWith(`${item.id}:`)).map((o) => o.slice(item.id.length + 1));
    lines.push({ itemId: item.id, qty, optionIds });
  }
  if (lines.length === 0 && problems.length === 0) problems.push({ field: "items", text: "Choose at least one item, with a quantity." });
  if (!v.date) problems.push({ field: "date", text: "Pick a date." });
  const area = v.area === OTHER_AREA ? v.otherArea.trim() : v.area;
  if (v.fulfilment === "delivery" && !area) problems.push({ field: "delivery", text: "Choose a delivery area, or switch to pickup." });
  if (problems.length > 0) return { problems };
  const fulfilment = v.fulfilment === "delivery" ? { kind: "delivery" as const, area } : { kind: "pickup" as const };
  return { request: { lines, fulfilment, date: v.date, ...(v.notes ? { notes: v.notes } : {}) }, problems };
}

/** Inverse of `buildRequest`, for re-showing step 1 from a signed quote. */
function valuesFromRequest(r: QuoteRequest, policy: BusinessPolicy, notes: string): OrderFormValues {
  const v = emptyValues();
  for (const l of r.lines) {
    v.qty[l.itemId] = String((Number(v.qty[l.itemId]) || 0) + l.qty);
    for (const o of l.optionIds) v.options.push(`${l.itemId}:${o}`);
  }
  v.date = r.date;
  v.notes = notes;
  const f = r.fulfilment;
  if (f.kind === "delivery") {
    v.fulfilment = "delivery";
    if (policy.fulfilment.delivery.areas.some((a) => a.name === f.area)) v.area = f.area;
    else {
      v.area = OTHER_AREA;
      v.otherArea = f.area;
    }
  }
  return v;
}

/** `/order?...` that re-opens step 1 with every field filled in. */
function changeHref(v: OrderFormValues): string {
  const q = new URLSearchParams();
  for (const [id, qty] of Object.entries(v.qty)) q.append(`qty.${id}`, qty);
  for (const o of v.options) {
    const [item, opt] = o.split(":");
    q.append(`opt.${item}`, opt ?? "");
  }
  q.set("date", v.date);
  q.set("fulfilment", v.fulfilment);
  if (v.area) q.set("area", v.area);
  if (v.otherArea) q.set("otherArea", v.otherArea);
  if (v.notes) q.set("notes", v.notes);
  return `/order?${q.toString()}`;
}

const FRESH_QUOTE_CODES: OrderErrorCode[] = ["QUOTE_EXPIRED", "QUOTE_STALE_POLICY", "QUOTE_INVALID", "QUOTE_ALREADY_USED", "IDEMPOTENCY_CONFLICT", "CAPACITY_FULL", "RUSH_CAP_REACHED"];

const FAILURE_TEXT: Partial<Record<OrderErrorCode, string>> = {
  QUOTE_EXPIRED: "This quote expired. Prices are only held for a short time, so please get a new quote.",
  CAPACITY_FULL: "Sorry, that day filled up while you were looking. Pick another day and get a new quote.",
  RUSH_CAP_REACHED: "Sorry, the last rush slot for that day just went. Pick another day and get a new quote.",
  QUOTE_ALREADY_USED: "This quote was already used for an order. If that was you, check your private status link.",
};

export function orderRouter(ctx: ServiceContext, limiters: Limiters): Router {
  const router = Router();
  const sameOrigin = requireSameOrigin(ctx.config);
  const noStore = (res: Response): void => void res.set("Cache-Control", "no-store");

  router.get("/order", (req, res) => {
    const { launch } = ctx;
    const values = launch.launched ? parseValues(req.query as Source, launch.policy) : emptyValues();
    const earliest = launch.launched ? earliestStandardDate(launch.policy, ctx.now()) : null;
    noStore(res);
    res.type("html").send(orderPage({ launch, values, earliest, nowMs: ctx.now() }));
  });

  router.post("/order/quote", limiters.quoteRest, formBody, sameOrigin, (req, res) => {
    const { launch } = ctx;
    if (!launch.launched) return void res.status(503).type("html").send(orderPage({ launch, values: emptyValues(), earliest: null, nowMs: ctx.now() }));
    const { policy } = launch;
    const values = parseValues(req.body as Source, policy);
    const refuse = (problems: Problem[], request?: QuoteRequest, status = 422): void => {
      const earliest = request ? firstWorkingDate(policy, request, ctx.now()) : earliestStandardDate(policy, ctx.now());
      noStore(res);
      res.status(status).type("html").send(orderPage({ launch, values, problems, earliest, nowMs: ctx.now() }));
    };
    const built = buildRequest(values, policy);
    if (!built.request) return refuse(built.problems, undefined, 400);
    const out = getQuote(ctx, built.request);
    if (out.kind === "ERROR") return refuse([{ field: "general", text: messageFor(out.code) }], built.request, 400);
    if (out.kind !== "QUOTED") return refuse(problemsFor(out.reasons, policy, firstWorkingDate(policy, built.request, ctx.now())), built.request);
    const rushPaise = Number(out.reasons.find((r) => r.code === "RUSH_APPLIED")?.params.rushSurchargePaise ?? 0);
    const linesTotal = out.lines.reduce((t, l) => t + l.lineTotalPaise, 0);
    const quote: QuoteView = {
      token: out.token,
      expiresAtMs: Date.parse(out.expiresAt),
      totalPaise: out.totalPaise,
      lines: out.lines,
      isRush: out.isRush,
      rushPaise,
      deliveryPaise: Math.max(out.totalPaise - linesTotal - rushPaise, 0),
    };
    noStore(res);
    res.type("html").send(
      quotePage({ launch, values, quote, request: built.request, idempotencyKey: randomUUID(), customer: { name: "", phone: "", address: "" }, changeHref: changeHref(values) }),
    );
  });

  router.post("/order/place", limiters.orderCreate, formBody, sameOrigin, async (req, res) => {
    await place(req, res);
  });

  async function place(req: Request, res: Response): Promise<void> {
    const { launch } = ctx;
    if (!launch.launched) return sendError(req, res, "SHOP_NOT_LAUNCHED");
    const body = req.body as Source;
    const token = text(body.quoteToken, 8000);
    const decoded = decodeQuoteToken(token, ctx.config.signingPublicKey);
    const request = decoded.ok ? QuoteRequestSchema.safeParse(decoded.payload.request) : null;
    if (!decoded.ok || !request?.success) return sendError(req, res, "QUOTE_INVALID");
    const { policy } = launch;
    const customer: CustomerValues = { name: text(body.name, 60).trim(), phone: text(body.phone, 16).replace(/[\s-]/g, ""), address: text(body.address, 200).trim() };
    const values = valuesFromRequest(request.data, policy, text(body.notes, MAX_NOTES));
    const delivery = request.data.fulfilment.kind === "delivery";
    const iat = decoded.payload.iat * MS_PER_SECOND;
    const priced = evaluate(policy, request.data, iat);
    const rushPaise = Number(priced.reasons.find((r) => r.code === "RUSH_APPLIED")?.params.rushSurchargePaise ?? 0);
    const lines = priced.outcome === "QUOTED" ? priced.lines : [];
    const quote: QuoteView = {
      token,
      expiresAtMs: decoded.payload.exp * MS_PER_SECOND,
      totalPaise: decoded.payload.totalPaise,
      lines,
      isRush: decoded.payload.isRush,
      rushPaise,
      deliveryPaise: Math.max(decoded.payload.totalPaise - lines.reduce((t, l) => t + l.lineTotalPaise, 0) - rushPaise, 0),
    };
    const key = text(body.idempotencyKey, 40);
    const render = (extra: { fieldErrors?: Record<string, string>; failure?: { text: string; fresh: boolean } }, status: number): void => {
      noStore(res);
      res.status(status).type("html").send(
        quotePage({ launch, values, quote, request: request.data, idempotencyKey: key, customer, changeHref: changeHref(values), ...extra }),
      );
    };
    const candidate = {
      quoteToken: token,
      customer: { name: customer.name, phone: customer.phone, ...(customer.address ? { address: customer.address } : {}) },
      ...(values.notes ? { notes: values.notes } : {}),
      idempotencyKey: key,
    };
    const parsed = RestOrderSchema.safeParse(candidate);
    const fieldErrors: Record<string, string> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] === "customer" ? String(issue.path[1]) : "";
        if (field === "name") fieldErrors.name = "Please enter your name.";
        if (field === "phone") fieldErrors.phone = "Enter a 10-digit mobile number, or a number starting with + and the country code.";
        if (field === "address") fieldErrors.address = "That address is too long. Keep it under 200 characters.";
      }
    }
    if (delivery && !customer.address) fieldErrors.address = "Please enter the delivery address.";
    if (!parsed.success || Object.keys(fieldErrors).length > 0) {
      return render({ fieldErrors: Object.keys(fieldErrors).length > 0 ? fieldErrors : { name: "Please check your details." } }, 400);
    }
    const out = await placeOrder(ctx, {
      quoteToken: token,
      customerName: customer.name,
      customerPhone: customer.phone,
      deliveryAddress: customer.address || null,
      notes: values.notes || null,
      idempotencyKey: key,
      channel: "web",
    });
    if (out.kind === "OK") return void res.redirect(303, `/orders/${out.orderId}?t=${out.accessToken}`);
    if (out.code === "SHOP_NOT_LAUNCHED") return sendError(req, res, out.code);
    const text2 = FAILURE_TEXT[out.code] ?? messageFor(out.code as ErrorCode);
    render({ failure: { text: text2, fresh: FRESH_QUOTE_CODES.includes(out.code) } }, out.code === "RETRY_LATER" ? 503 : 409);
  }

  return router;
}
