import type { Request, Response } from "express";
import type { Reason, ReasonCode } from "@agentdoor/core";
import { html, layout } from "../views/html.js";

/** Reason codes (04 §2) plus transport-level codes that are not business outcomes. */
export type ErrorCode =
  | ReasonCode
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "METHOD_NOT_ALLOWED"
  | "INVALID_TRANSITION"
  | "INTERNAL";

const STATUS: Partial<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  QUOTE_INVALID: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  INVALID_TRANSITION: 409,
  QUOTE_ALREADY_USED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  QUOTE_EXPIRED: 410,
  QUOTE_STALE_POLICY: 410,
  CAPACITY_FULL: 422,
  RUSH_CAP_REACHED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  SHOP_NOT_LAUNCHED: 503,
  RETRY_LATER: 503,
};
/** Every other reason code is a business refusal (04 §4: 422). */
const REFUSAL_STATUS = 422;
const RETRY_AFTER_SECONDS = 5;

export const statusFor = (code: ErrorCode): number => STATUS[code] ?? REFUSAL_STATUS;

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: "The request is not valid. Check the fields and try again.",
  QUOTE_INVALID: "This quote is not valid. Ask for a new quote.",
  QUOTE_EXPIRED: "This quote has expired. Ask for a new quote.",
  QUOTE_STALE_POLICY: "The shop's rules changed since this quote. Ask for a new quote.",
  QUOTE_ALREADY_USED: "This quote has already been used for an order.",
  IDEMPOTENCY_CONFLICT: "This idempotency key was already used with different order details.",
  CAPACITY_FULL: "The shop is fully booked for that day.",
  RUSH_CAP_REACHED: "No more rush orders can be taken for that day.",
  SHOP_NOT_LAUNCHED: "This shop is not launched, so it cannot take orders right now.",
  RETRY_LATER: "The shop is busy. Please try again in a few seconds.",
  RATE_LIMITED: "Too many requests. Please slow down and try again shortly.",
  NOT_FOUND: "Not found.",
  UNAUTHORIZED: "Not signed in.",
  FORBIDDEN: "Forbidden.",
  METHOD_NOT_ALLOWED: "Method not allowed.",
  INVALID_TRANSITION: "That change is not allowed for the order's current status.",
  INTERNAL: "Something went wrong on our side.",
  UNKNOWN_ITEM: "That item is not on the menu.",
  QTY_BELOW_MIN: "The quantity is below the minimum for this item.",
  QTY_ABOVE_MAX: "The quantity is above the maximum for one order.",
  TOO_MANY_LINES: "Too many lines in one order.",
  CLOSED_DAY: "The shop is closed on that day.",
  TOO_FAR_AHEAD: "That date is too far ahead.",
  LEAD_TIME_NOT_MET: "That date is too soon for the preparation time needed.",
  RUSH_APPLIED: "A rush surcharge applies.",
  RUSH_NOT_OFFERED: "Rush orders are not offered.",
  AREA_NOT_SERVED: "The shop does not deliver to that area.",
  AREA_NEEDS_OWNER: "Delivery to that area needs the owner's approval.",
  DELIVERY_NOT_OFFERED: "Delivery is not offered.",
  BELOW_MIN_ORDER: "The order is below the minimum order value.",
  CUSTOM_REQUEST_NEEDS_OWNER: "Custom requests need the owner's approval.",
};

export const messageFor = (code: ErrorCode): string => MESSAGES[code] ?? "The request cannot be completed.";

/** Engine reasons with the human sentence attached (EN here; T11 adds Hindi). */
export const withMessages = (reasons: Reason[]) =>
  reasons.map((r) => ({ ...r, message: messageFor(r.code) }));

export const requestIdOf = (res: Response): string => String(res.locals.requestId ?? "-");

export function sendData(res: Response, status: number, data: unknown): void {
  res.status(status).json({ data, error: null, meta: { requestId: requestIdOf(res) } });
}

const JSON_PATH = /^\/(api|mcp|healthz|\.well-known)(\/|$)/;

/** Browsers submitting forms get a small page; API clients and everything else get the envelope. */
const wantsHtml = (req: Request): boolean =>
  !JSON_PATH.test(req.path) && req.accepts(["json", "html"]) === "html";

export interface ErrorOptions {
  message?: string;
  /** Extra payload for `data`, e.g. refusal reasons. */
  data?: unknown;
  status?: number;
}

export function sendError(req: Request, res: Response, code: ErrorCode, opts: ErrorOptions = {}): void {
  const status = opts.status ?? statusFor(code);
  const message = opts.message ?? messageFor(code);
  if (code === "RETRY_LATER" && !res.getHeader("Retry-After")) {
    res.setHeader("Retry-After", String(RETRY_AFTER_SECONDS));
  }
  if (wantsHtml(req)) {
    const body = html`<h1>${message}</h1><p><a href="/">Back to the shop</a></p>`;
    res.status(status).type("html").send(layout({ title: message, body }));
    return;
  }
  res.status(status).json({
    data: opts.data ?? null,
    error: { code, message },
    meta: { requestId: requestIdOf(res) },
  });
}
