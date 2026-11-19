import { addDays, evaluate, istDateOf, type BusinessPolicy, type PricedLine, type QuoteRequest, type Reason } from "@agentdoor/core";
import { html, icon, raw, type SafeHtml } from "@agentdoor/ui";
import type { LaunchState } from "../db/launch-state.js";
import { UNIT_WORD, WEEKDAYS, inr, istClock, shortDate, spanOfHours } from "./format.js";
import { layout } from "./layout.js";
import { bannerFor, identityOf } from "./storefront.js";

/** What the visitor typed in step 1, kept as plain strings so a refused quote re-fills the form. */
export interface OrderFormValues {
  qty: Record<string, string>;
  options: string[];
  date: string;
  fulfilment: "pickup" | "delivery";
  area: string;
  otherArea: string;
  notes: string;
}

export const OTHER_AREA = "__other";
const DEMO_NOTE = "Demo shop — please don't enter real phone numbers.";

export const emptyValues = (): OrderFormValues => ({ qty: {}, options: [], date: "", fulfilment: "pickup", area: "", otherArea: "", notes: "" });

/* ---------- reasons in plain words ---------- */

type Field = "items" | "date" | "delivery" | "general";
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
export function firstWorkingDate(policy: BusinessPolicy, request: QuoteRequest, nowMs: number): string | null {
  const today = istDateOf(nowMs);
  for (let ahead = 0; ahead <= policy.schedule.maxAdvanceDays; ahead++) {
    const date = addDays(today, ahead);
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

/* ---------- step 1: the form ---------- */

const errId = (f: Field): string => `err-${f}`;
const fieldProblems = (ps: Problem[], f: Field): Problem[] => ps.filter((p) => p.field === f);

function fieldErrors(ps: Problem[], f: Field): SafeHtml {
  const mine = fieldProblems(ps, f);
  if (mine.length === 0) return html``;
  return html`<ul class="field-error" id="${errId(f)}">${mine.map((p) => html`<li>${icon("alert")}<span>${p.text}${p.contact ? html` <a href="/contact">Message the owner</a>` : ""}</span></li>`)}</ul>`;
}

const describedBy = (ps: Problem[], f: Field): SafeHtml =>
  fieldProblems(ps, f).length > 0 ? raw(`aria-describedby="${errId(f)}" aria-invalid="true"`) : raw("");

function itemRow(item: BusinessPolicy["catalog"][number], v: OrderFormValues, ps: Problem[]): SafeHtml {
  const unit = UNIT_WORD[item.unit] ?? { one: item.unit, many: item.unit, per: `per ${item.unit}` };
  const id = `qty-${item.id}`;
  return html`<li class="pick">
    <div class="pick__main">
      <label class="pick__name" for="${id}">${item.name.en}</label>
      <p class="pick__price" id="${id}-hint">${inr(item.unitPricePaise)} ${unit.per} · ${item.minQty === item.maxQtyPerOrder ? item.minQty : `${item.minQty} to ${item.maxQtyPerOrder}`} ${unit.many} per order</p>
      ${item.options.length > 0
        ? html`<fieldset class="pick__opts"><legend class="visually-hidden">Extras for ${item.name.en}</legend>
            ${item.options.map((o) => html`<label class="check-inline"><input type="checkbox" name="opt.${item.id}" value="${o.id}" ${v.options.includes(`${item.id}:${o.id}`) ? raw("checked") : ""}> <span>${o.label.en} <span class="nowrap">+${inr(o.surchargePaise)}</span></span></label>`)}
          </fieldset>`
        : ""}
    </div>
    <div class="qty" data-qty>
      <input class="input qty__input" id="${id}" name="qty.${item.id}" type="number" inputmode="numeric" min="0" max="${item.maxQtyPerOrder}" step="1" value="${v.qty[item.id] ?? ""}" placeholder="0" aria-describedby="${id}-hint${fieldProblems(ps, "items").length > 0 ? ` ${errId("items")}` : ""}">
      <span class="qty__unit">${unit.many}</span>
    </div>
  </li>`;
}

function whenFieldset(policy: BusinessPolicy, v: OrderFormValues, ps: Problem[], earliest: string | null, nowMs: number): SafeHtml {
  const today = istDateOf(nowMs);
  const max = addDays(today, policy.schedule.maxAdvanceDays);
  const closed = policy.schedule.closedWeekdays.map((d) => `${WEEKDAYS[d]}s`);
  return html`<fieldset class="group">
    <legend>2 · When do you want it?</legend>
    <label class="label" for="date">Date</label>
    <input class="input date-input" id="date" name="date" type="date" required min="${today}" max="${max}" value="${v.date || earliest || ""}"
      aria-describedby="date-hint${fieldProblems(ps, "date").length > 0 ? ` ${errId("date")}` : ""}" ${fieldProblems(ps, "date").length > 0 ? raw('aria-invalid="true"') : ""}>
    <p class="hint" id="date-hint">${earliest ? `The earliest day is ${shortDate(earliest)}. ` : ""}${closed.length > 0 ? `Closed on ${closed.join(" and ")}. ` : ""}Order up to ${policy.schedule.maxAdvanceDays} days ahead.</p>
    ${fieldErrors(ps, "date")}
  </fieldset>`;
}

function howFieldset(policy: BusinessPolicy, v: OrderFormValues, ps: Problem[]): SafeHtml {
  const { pickup, delivery } = policy.fulfilment;
  const other = delivery.unlistedArea === "ASK_OWNER";
  return html`<fieldset class="group">
    <legend>3 · Pickup or delivery?</legend>
    <div class="choice-cards">
      ${pickup.enabled
        ? html`<label class="choice-card"><input type="radio" name="fulfilment" value="pickup" ${v.fulfilment === "pickup" ? raw("checked") : ""}><span><strong>${icon("door")}Pickup</strong><small>${pickup.areaLabel ?? "From the baker"} · free</small></span></label>`
        : ""}
      ${delivery.enabled
        ? html`<label class="choice-card"><input type="radio" name="fulfilment" value="delivery" ${v.fulfilment === "delivery" || !pickup.enabled ? raw("checked") : ""}><span><strong>${icon("truck")}Delivery</strong><small>Pick your area below</small></span></label>`
        : ""}
    </div>
    ${delivery.enabled
      ? html`<div class="area-box">
          <label class="label" for="area">Delivery area <span class="muted">(only if you chose delivery)</span></label>
          <select class="input" id="area" name="area">
            <option value="">Choose an area</option>
            ${delivery.areas.map((a) => html`<option value="${a.name}" ${v.area === a.name ? raw("selected") : ""}>${a.name} · ${a.feePaise === 0 ? "free" : inr(a.feePaise)}</option>`)}
            ${other ? html`<option value="${OTHER_AREA}" ${v.area === OTHER_AREA ? raw("selected") : ""}>Another area (the owner decides)</option>` : ""}
          </select>
          ${other
            ? html`<label class="label" for="other-area">Area name <span class="muted">(if you chose “Another area”)</span></label><input class="input" id="other-area" name="otherArea" maxlength="80" autocomplete="off" value="${v.otherArea}">`
            : ""}
        </div>`
      : ""}
    ${fieldErrors(ps, "delivery")}
  </fieldset>`;
}

function errorSummary(ps: Problem[]): SafeHtml {
  if (ps.length === 0) return html``;
  return html`<div class="alert alert--error" role="alert" id="problems">
    <p class="alert__title">${icon("alert")}We can't quote this yet</p>
    <ul>${ps.map((p) => html`<li>${p.text}</li>`)}</ul>
  </div>`;
}

export interface OrderPageInput {
  launch: LaunchState;
  values: OrderFormValues;
  problems?: Problem[];
  earliest: string | null;
  nowMs: number;
  /** Shown above the form, e.g. "This quote expired". */
  notice?: string;
}

export function orderPage(i: OrderPageInput): string {
  const { launch, values, nowMs } = i;
  const problems = i.problems ?? [];
  if (!launch.launched) {
    const body = html`<section class="wrap section narrow"><h1 class="page-title">Order</h1>
      <p class="alert alert--error" role="alert">${icon("alert")}<span>This shop is not taking orders right now, so the form is switched off.</span></p></section>`;
    return layout({ title: "Order", body, banner: bannerFor(launch), active: "order" });
  }
  const { policy } = launch;
  const body = html`<section class="wrap section narrow">
    <h1 class="page-title">Order from ${policy.business.name}</h1>
    <p class="demo-note">${icon("alert")}<span>${DEMO_NOTE}</span></p>
    <ol class="stepper" aria-label="Steps"><li aria-current="step"><span>1</span>Choose</li><li><span>2</span>Check the quote</li><li><span>3</span>Request</li></ol>
    ${i.notice ? html`<p class="alert alert--note" role="status">${icon("clock")}<span>${i.notice}</span></p>` : ""}
    ${errorSummary(problems)}
    <form method="post" action="/order/quote" class="order-form">
      <fieldset class="group">
        <legend>1 · What would you like?</legend>
        <p class="hint">Leave a quantity empty for items you don't want.</p>
        <ul class="picks">${policy.catalog.map((c) => itemRow(c, values, problems))}</ul>
        ${fieldErrors(problems, "items")}
      </fieldset>
      ${whenFieldset(policy, values, problems, i.earliest, nowMs)}
      ${howFieldset(policy, values, problems)}
      <fieldset class="group">
        <legend>4 · Anything to tell the baker?</legend>
        <label class="label" for="notes">Notes <span class="muted">(optional · the owner reads them, they never change the price)</span></label>
        <textarea class="input textarea" id="notes" name="notes" rows="3" maxlength="500">${values.notes}</textarea>
      </fieldset>
      ${fieldErrors(problems, "general")}
      <p class="form-actions"><button class="btn btn--primary btn--lg" type="submit">Get my quote</button></p>
    </form>
  </section>`;
  return layout({ title: "Order", body, shop: identityOf(launch), active: "order", scripts: ["shop.js"] });
}

/* ---------- step 2: the quote and the customer details ---------- */

export interface QuoteView {
  token: string;
  expiresAtMs: number;
  totalPaise: number;
  lines: PricedLine[];
  isRush: boolean;
  rushPaise: number;
  deliveryPaise: number;
}

export interface CustomerValues {
  name: string;
  phone: string;
  address: string;
}

export interface QuotePageInput {
  launch: LaunchState & { launched: true };
  values: OrderFormValues;
  quote: QuoteView;
  request: QuoteRequest;
  idempotencyKey: string;
  customer: CustomerValues;
  /** Field name -> message, from the customer-details validation. */
  fieldErrors?: Record<string, string>;
  /** A failed placement: expired, used, full... */
  failure?: { text: string; fresh: boolean };
  /** Link back to step 1 with everything prefilled. */
  changeHref: string;
}

function quoteTable(policy: BusinessPolicy, q: QuoteView): SafeHtml {
  const name = (id: string): string => policy.catalog.find((c) => c.id === id)?.name.en ?? id;
  return html`<table class="quote-table"><caption class="visually-hidden">Your quote</caption>
    <thead><tr><th scope="col">Item</th><th scope="col" class="num">Amount</th></tr></thead>
    <tbody>
      ${q.lines.map((l) => html`<tr><th scope="row">${name(l.itemId)}<small>${l.qty} × ${inr(l.unitPricePaise + l.optionsPaise)}${l.optionsPaise > 0 ? " (with extras)" : ""}</small></th><td class="num">${inr(l.lineTotalPaise)}</td></tr>`)}
      ${q.deliveryPaise > 0 ? html`<tr><th scope="row">Delivery</th><td class="num">${inr(q.deliveryPaise)}</td></tr>` : ""}
      ${q.rushPaise > 0 ? html`<tr><th scope="row">Rush order<small>Needed within the rush window</small></th><td class="num">${inr(q.rushPaise)}</td></tr>` : ""}
    </tbody>
    <tfoot><tr><th scope="row">Total</th><td class="num">${inr(q.totalPaise)}</td></tr></tfoot>
  </table>`;
}

function recap(req: QuoteRequest): SafeHtml {
  const where = req.fulfilment.kind === "pickup" ? "Pickup" : `Delivery to ${req.fulfilment.area}`;
  return html`<p class="recap">${icon("clock")}<span><strong>${shortDate(req.date)}</strong> · ${where}</span></p>`;
}

const hiddenFields = (v: OrderFormValues, q: QuoteView, key: string): SafeHtml =>
  html`<input type="hidden" name="quoteToken" value="${q.token}"><input type="hidden" name="idempotencyKey" value="${key}"><input type="hidden" name="notes" value="${v.notes}">`;

export function quotePage(i: QuotePageInput): string {
  const { launch, quote: q, customer: c } = i;
  const { policy } = launch;
  const delivery = i.request.fulfilment.kind === "delivery";
  const errs = i.fieldErrors ?? {};
  const err = (f: string): SafeHtml =>
    errs[f] ? html`<p class="field-error" id="err-${f}">${icon("alert")}<span>${errs[f]}</span></p>` : html``;
  const inv = (f: string): SafeHtml => (errs[f] ? raw(`aria-invalid="true" aria-describedby="err-${f}"`) : raw(""));
  const body = html`<section class="wrap section narrow">
    <h1 class="page-title">Your quote</h1>
    <p class="demo-note">${icon("alert")}<span>${DEMO_NOTE}</span></p>
    <ol class="stepper" aria-label="Steps"><li class="is-done"><span>✓</span>Choose</li><li aria-current="step"><span>2</span>Check the quote</li><li><span>3</span>Request</li></ol>
    ${i.failure
      ? html`<div class="alert alert--error" role="alert"><p class="alert__title">${icon("alert")}${i.failure.text}</p>${i.failure.fresh ? html`<p><a class="btn btn--primary" href="${i.changeHref}">Get a new quote</a></p>` : ""}</div>`
      : ""}
    <div class="slip">
      <div class="slip__head">
        <p class="slip__brand">${icon("receipt")}<span>${policy.business.name}</span></p>
        ${recap(i.request)}
      </div>
      ${quoteTable(policy, q)}
      <p class="slip__valid">${icon("clock")}<span>Valid until <strong>${istClock(q.expiresAtMs)}</strong> IST. Prices are set by the owner and signed.</span></p>
    </div>
    <form method="post" action="/order/place" class="order-form">
      ${hiddenFields(i.values, q, i.idempotencyKey)}
      <fieldset class="group">
        <legend>Your details</legend>
        <label class="label" for="cname">Name</label>
        <input class="input" id="cname" name="name" required maxlength="60" autocomplete="name" value="${c.name}" ${inv("name")}>
        ${err("name")}
        <label class="label" for="cphone">Phone <span class="muted">(10-digit mobile, or +country code · the owner calls to confirm)</span></label>
        <input class="input" id="cphone" name="phone" type="tel" inputmode="tel" required maxlength="16" autocomplete="tel" value="${c.phone}" ${inv("phone")}>
        ${err("phone")}
        ${delivery
          ? html`<label class="label" for="caddress">Delivery address</label><textarea class="input textarea" id="caddress" name="address" required rows="3" maxlength="200" autocomplete="street-address" ${inv("address")}>${c.address}</textarea>${err("address")}`
          : ""}
      </fieldset>
      <p class="form-actions">
        <button class="btn btn--primary btn--lg" type="submit">Request order</button>
        <a class="btn btn--secondary btn--lg" href="${i.changeHref}">Change my order</a>
      </p>
      <p class="hint">${icon("check")} Nothing is charged online. ${policy.business.ownerFirstName} confirms by hand, and you get a private link to follow the order.</p>
    </form>
  </section>`;
  return layout({ title: "Your quote", body, shop: identityOf(launch), active: "order" });
}
