import { addDays, evaluate, istDateOf, type BusinessPolicy, type QuoteRequest, type Reason } from "@agentdoor/core";
import { html, icon, type SafeHtml } from "@agentdoor/ui";
import { UNIT_WORD, WEEKDAYS, inr, shortDate, spanOfHours } from "../format.js";

/* ---------- reasons in plain words ---------- */

export type Field = "items" | "date" | "delivery" | "general";
export interface Problem {
  field: Field;
  text: string;
  /** Offer the contact page: the owner has to decide this one. */
  contact?: boolean;
}

const FIELD_OF: Partial<Record<Reason["code"], Field>> = {
  CLOSED_DAY: "date",
  TOO_FAR_AHEAD: "date",
  LEAD_TIME_NOT_MET: "date",
  RUSH_NOT_OFFERED: "date",
  RUSH_CAP_REACHED: "date",
  CAPACITY_FULL: "date",
  AREA_NOT_SERVED: "delivery",
  AREA_NEEDS_OWNER: "delivery",
  DELIVERY_NOT_OFFERED: "delivery",
  UNKNOWN_ITEM: "items",
  QTY_BELOW_MIN: "items",
  QTY_ABOVE_MAX: "items",
  TOO_MANY_LINES: "items",
  BELOW_MIN_ORDER: "items",
  CUSTOM_REQUEST_NEEDS_OWNER: "items",
};

/** The first date on which the same basket would be quoted, so a refusal can say what works. */
/**
 * The first date after the one she asked for that the engine would quote. Searching from today could
 * name a date earlier than her choice (a same-day rush slot before a notice gap), which reads as a contradiction.
 */
export function firstWorkingDate(policy: BusinessPolicy, request: QuoteRequest, nowMs: number): string | null {
  const today = istDateOf(nowMs);
  const last = addDays(today, policy.schedule.maxAdvanceDays);
  let date = request.date >= today ? addDays(request.date, 1) : today;
  for (; date <= last; date = addDays(date, 1)) {
    if (evaluate(policy, { ...request, date }, nowMs).outcome === "QUOTED") return date;
  }
  return null;
}

function reasonText(r: Reason, policy: BusinessPolicy, earliest: string | null): string {
  const item = policy.catalog.find((c) => c.id === r.params.itemId);
  const unit = item ? (UNIT_WORD[item.unit]?.many ?? item.unit) : "";
  const tryDate = earliest ? ` The earliest day that works is ${shortDate(earliest)}.` : "";
  switch (r.code) {
    case "LEAD_TIME_NOT_MET":
      return `We need ${spanOfHours(Number(r.params.requiredHours))} of notice for this order.${tryDate}`;
    case "CLOSED_DAY": {
      const days = policy.schedule.closedWeekdays.map((d) => `${WEEKDAYS[d]}s`).join(" and ");
      return `We are closed on ${days || "that day"}. Please pick another day.${tryDate}`;
    }
    case "TOO_FAR_AHEAD":
      return `We take orders up to ${r.params.maxAdvanceDays} days ahead. Please pick an earlier day.`;
    case "QTY_BELOW_MIN":
      return `${item?.name.en ?? "This item"}: please order at least ${r.params.minQty} ${unit}.`;
    case "QTY_ABOVE_MAX":
      return `${item?.name.en ?? "This item"}: we can make at most ${r.params.maxQty} ${unit} in one order.`;
    case "TOO_MANY_LINES":
      return `One order can have at most ${r.params.maxLines} different items.`;
    case "BELOW_MIN_ORDER":
      return `The minimum order is ${inr(policy.orderRules.minOrderPaise)}. Yours comes to ${inr(Number(r.params.subtotalPaise))} before delivery.`;
    case "AREA_NOT_SERVED": {
      const areas = policy.fulfilment.delivery.areas.map((a) => a.name).join(", ");
      return `We do not deliver to that area. We deliver to ${areas}, or you can pick up.`;
    }
    case "AREA_NEEDS_OWNER":
      return "That area is not on our list, so the owner has to say yes first. Send a message and ask, or choose pickup.";
    case "DELIVERY_NOT_OFFERED":
      return "We do not deliver at the moment. Please choose pickup.";
    case "CAPACITY_FULL":
      return `That day is fully booked.${tryDate}`;
    case "RUSH_CAP_REACHED":
      return `No more rush orders can be taken for that day.${tryDate}`;
    case "CUSTOM_REQUEST_NEEDS_OWNER":
      return "Custom requests need the owner's OK. Send a message first.";
    case "UNKNOWN_ITEM":
      return "That item is not on the menu.";
    default:
      return "We could not price this order. Please check the details and try again.";
  }
}

/** Turns engine reasons into sentences. RUSH_NOT_OFFERED rides along with a lead refusal: one sentence is enough. */
export function problemsFor(reasons: Reason[], policy: BusinessPolicy, earliest: string | null): Problem[] {
  const useful = reasons.filter((r) => r.code !== "RUSH_NOT_OFFERED" || reasons.length === 1);
  return useful.map((r) => ({
    field: FIELD_OF[r.code] ?? "general",
    text: reasonText(r, policy, earliest),
    contact: r.code === "AREA_NEEDS_OWNER" || r.code === "CUSTOM_REQUEST_NEEDS_OWNER",
  }));
}

/* ---------- showing them next to the form fields ---------- */

export const errId = (f: Field): string => `err-${f}`;
export const fieldProblems = (ps: Problem[], f: Field): Problem[] => ps.filter((p) => p.field === f);

export function fieldErrors(ps: Problem[], f: Field): SafeHtml {
  const mine = fieldProblems(ps, f);
  if (mine.length === 0) return html``;
  return html`<ul class="field-error" id="${errId(f)}">${mine.map((p) => html`<li>${icon("alert")}<span>${p.text}${p.contact ? html` <a href="/contact">Message the owner</a>` : ""}</span></li>`)}</ul>`;
}
