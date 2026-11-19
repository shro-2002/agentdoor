import type { BusinessPolicy, PricedLine, QuoteRequest } from "@agentdoor/core";
import { html, icon, raw, type SafeHtml } from "@agentdoor/ui";
import type { LaunchState } from "../../db/launch-state.js";
import { inr, istClock, shortDate } from "../format.js";
import { layout } from "../layout.js";
import { identityOf } from "../storefront.js";
import { demoNote, stepper, type OrderFormValues } from "./values.js";

/** The deterministic quote, exactly as the engine priced and signed it. Nothing here is recomputed. */
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

function breakdown(policy: BusinessPolicy, q: QuoteView, delivers: boolean): SafeHtml {
  const name = (id: string): string => policy.catalog.find((c) => c.id === id)?.name.en ?? id;
  return html`<table class="quote-table"><caption class="visually-hidden">Your quote</caption>
    <thead><tr><th scope="col">Item</th><th scope="col" class="num">Amount</th></tr></thead>
    <tbody>
      ${q.lines.map((l) => html`<tr><th scope="row">${name(l.itemId)}<small>${l.qty} × ${inr(l.unitPricePaise + l.optionsPaise)}${l.optionsPaise > 0 ? " (with extras)" : ""}</small></th><td class="num">${inr(l.lineTotalPaise)}</td></tr>`)}
      ${q.rushPaise > 0 ? html`<tr><th scope="row">Rush order<small>Needed at short notice</small></th><td class="num">${inr(q.rushPaise)}</td></tr>` : ""}
      ${delivers ? html`<tr><th scope="row">Delivery</th><td class="num">${q.deliveryPaise > 0 ? inr(q.deliveryPaise) : "Free"}</td></tr>` : ""}
    </tbody>
    <tfoot><tr><th scope="row">Total</th><td class="num">${inr(q.totalPaise)}</td></tr></tfoot>
  </table>`;
}

function recap(req: QuoteRequest): SafeHtml {
  const where = req.fulfilment.kind === "pickup" ? "Pickup" : `Delivery to ${req.fulfilment.area}`;
  return html`<p class="recap">${icon("clock")}<span><strong>${shortDate(req.date)}</strong> · ${where}</span></p>`;
}

function slip(i: QuotePageInput): SafeHtml {
  const { quote: q, launch } = i;
  return html`<aside class="slip" aria-label="Your quote">
    <div class="slip__head">
      <p class="slip__brand">${icon("receipt")}<span>${launch.policy.business.name}</span></p>
      ${recap(i.request)}
    </div>
    ${breakdown(launch.policy, q, i.request.fulfilment.kind === "delivery")}
    <p class="slip__valid">${icon("clock")}<span>Valid until <strong>${istClock(q.expiresAtMs)}</strong> IST. Prices are set by the owner and signed.</span></p>
  </aside>`;
}

const hiddenFields = (v: OrderFormValues, q: QuoteView, key: string): SafeHtml =>
  html`<input type="hidden" name="quoteToken" value="${q.token}"><input type="hidden" name="idempotencyKey" value="${key}"><input type="hidden" name="notes" value="${v.notes}">`;

function detailsForm(i: QuotePageInput): SafeHtml {
  const { policy } = i.launch;
  const c = i.customer;
  const errs = i.fieldErrors ?? {};
  const err = (f: string): SafeHtml => (errs[f] ? html`<p class="field-error" id="err-${f}">${icon("alert")}<span>${errs[f]}</span></p>` : html``);
  const inv = (f: string): SafeHtml => (errs[f] ? raw(`aria-invalid="true" aria-describedby="err-${f}"`) : raw(""));
  const delivery = i.request.fulfilment.kind === "delivery";
  return html`<form method="post" action="/order/place" class="details">
    ${hiddenFields(i.values, i.quote, i.idempotencyKey)}
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
      <a class="btn btn--quiet btn--lg" href="${i.changeHref}">Change my order</a>
    </p>
    <p class="hint">${icon("check")} Nothing is charged online. ${policy.business.ownerFirstName} confirms by hand, and you get a private link to follow the order.</p>
  </form>`;
}

export function quotePage(i: QuotePageInput): string {
  const failure = i.failure
    ? html`<div class="alert alert--error" role="alert"><p class="alert__title">${icon("alert")}${i.failure.text}</p>${i.failure.fresh ? html`<p><a class="btn btn--primary" href="${i.changeHref}">Get a new quote</a></p>` : ""}</div>`
    : "";
  const body = html`<section class="wrap page">
    <p class="eyebrow">Order</p>
    <h1 class="page-title">Your quote</h1>
    ${demoNote()}
    ${stepper(2)}
    ${failure}
    <div class="quote-grid">${slip(i)}${detailsForm(i)}</div>
  </section>`;
  return layout({ title: "Your quote", body, shop: identityOf(i.launch), active: "order" });
}
