import { addDays, istDateOf, type BusinessPolicy } from "@agentdoor/core";
import { html, icon, raw, type SafeHtml } from "@agentdoor/ui";
import type { LaunchState } from "../../db/launch-state.js";
import { DIETARY, UNIT_WORD, WEEKDAYS, earliestDate, inr, listWords, shortDate } from "../format.js";
import { layout } from "../layout.js";
import { PRODUCT_PHOTOS, photoImg } from "../storefront/photos.js";
import { bannerFor, identityOf } from "../storefront.js";
import { errId, fieldErrors, fieldProblems, type Problem } from "./problems.js";
import { OTHER_AREA, demoNote, stepper, type OrderFormValues } from "./values.js";

type Item = BusinessPolicy["catalog"][number];

const checked = (on: boolean): SafeHtml => (on ? raw("checked") : raw(""));

function optionBoxes(item: Item, v: OrderFormValues): SafeHtml {
  if (item.options.length === 0) return html``;
  return html`<fieldset class="pick__opts"><legend class="visually-hidden">Extras for ${item.name.en}</legend>
    ${item.options.map((o) => html`<label class="check-inline"><input type="checkbox" name="opt.${item.id}" value="${o.id}" ${checked(v.options.includes(`${item.id}:${o.id}`))}> <span>${o.label.en} <span class="nowrap">+${inr(o.surchargePaise)}</span></span></label>`)}
  </fieldset>`;
}

function itemCard(item: Item, v: OrderFormValues, ps: Problem[]): SafeHtml {
  const unit = UNIT_WORD[item.unit] ?? { one: item.unit, many: item.unit, per: `per ${item.unit}` };
  const id = `qty-${item.id}`;
  const photo = PRODUCT_PHOTOS[item.id];
  const range = item.minQty === item.maxQtyPerOrder ? item.minQty : `${item.minQty} to ${item.maxQtyPerOrder}`;
  const tags = item.dietary.map((t) => DIETARY[t]?.label ?? t.replace(/_/g, " "));
  return html`<li class="pick" data-pick data-name="${item.name.en}" data-unit="${unit.many}">
    <div class="pick__photo">${photo ? photoImg(photo, { className: "photo" }) : ""}</div>
    <div class="pick__main">
      <label class="pick__name" for="${id}">${item.name.en}</label>
      <p class="pick__price" id="${id}-hint">${inr(item.unitPricePaise)} ${unit.per} · ${range} ${unit.many} per order${tags.length > 0 ? ` · ${listWords(tags)}` : ""}</p>
      ${optionBoxes(item, v)}
    </div>
    <div class="qty" data-qty>
      <input class="input qty__input" id="${id}" name="qty.${item.id}" type="number" inputmode="numeric" min="0" max="${item.maxQtyPerOrder}" step="1" value="${v.qty[item.id] ?? ""}" placeholder="0" aria-describedby="${id}-hint${fieldProblems(ps, "items").length > 0 ? ` ${errId("items")}` : ""}">
      <span class="qty__unit">${unit.many}</span>
    </div>
  </li>`;
}

function whenFieldset(policy: BusinessPolicy, v: OrderFormValues, ps: Problem[], earliest: string | null, nowMs: number): SafeHtml {
  const max = addDays(istDateOf(nowMs), policy.schedule.maxAdvanceDays);
  // The first day the engine itself would quote: an earlier date could only end in a refusal.
  const min = earliestDate(policy, nowMs);
  const closed = policy.schedule.closedWeekdays.map((d) => `${WEEKDAYS[d]}s`);
  const bad = fieldProblems(ps, "date").length > 0;
  return html`<fieldset class="group">
    <legend>2 · When do you want it?</legend>
    <label class="label" for="date">Date</label>
    <input class="input date-input" id="date" name="date" type="date" required ${min ? html`min="${min}"` : ""} max="${max}" value="${v.date || earliest || ""}"
      aria-describedby="date-hint${bad ? ` ${errId("date")}` : ""}" ${bad ? raw('aria-invalid="true"') : ""}>
    <p class="hint" id="date-hint">${earliest ? `The earliest day is ${shortDate(earliest)}. ` : ""}${earliest && min && min < earliest ? "Sooner dates may be possible with a rush charge. " : ""}${closed.length > 0 ? `Closed on ${listWords(closed)}. ` : ""}Order up to ${policy.schedule.maxAdvanceDays} days ahead.</p>
    ${fieldErrors(ps, "date")}
  </fieldset>`;
}

function areaBox(policy: BusinessPolicy, v: OrderFormValues): SafeHtml {
  const d = policy.fulfilment.delivery;
  if (!d.enabled) return html``;
  const other = d.unlistedArea === "ASK_OWNER";
  return html`<div class="area-box" data-area-box>
    <label class="label" for="area">Delivery area <span class="muted">(only if you chose delivery)</span></label>
    <select class="input" id="area" name="area">
      <option value="">Choose an area</option>
      ${d.areas.map((a) => html`<option value="${a.name}" ${v.area === a.name ? raw("selected") : ""}>${a.name} · ${a.feePaise === 0 ? "free" : inr(a.feePaise)}</option>`)}
      ${other ? html`<option value="${OTHER_AREA}" ${v.area === OTHER_AREA ? raw("selected") : ""}>Another area (the owner decides)</option>` : ""}
    </select>
    ${other
      ? html`<label class="label" for="other-area">Area name <span class="muted">(if you chose “Another area”)</span></label><input class="input" id="other-area" name="otherArea" maxlength="80" autocomplete="off" value="${v.otherArea}">`
      : ""}
  </div>`;
}

function howFieldset(policy: BusinessPolicy, v: OrderFormValues, ps: Problem[]): SafeHtml {
  const { pickup, delivery } = policy.fulfilment;
  return html`<fieldset class="group">
    <legend>3 · Pickup or delivery?</legend>
    <div class="choice-cards">
      ${pickup.enabled
        ? html`<label class="choice-card"><input type="radio" name="fulfilment" value="pickup" ${checked(v.fulfilment === "pickup")}><span><strong>${icon("door")}Pickup</strong><small>${pickup.areaLabel ?? "From the baker"} · free</small></span></label>`
        : ""}
      ${delivery.enabled
        ? html`<label class="choice-card"><input type="radio" name="fulfilment" value="delivery" ${checked(v.fulfilment === "delivery" || !pickup.enabled)}><span><strong>${icon("truck")}Delivery</strong><small>Pick your area below</small></span></label>`
        : ""}
    </div>
    ${areaBox(policy, v)}
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

/** What has been chosen so far. It is rendered here for the no-script case and kept current by shop.js. */
function summary(policy: BusinessPolicy, v: OrderFormValues, earliest: string | null): SafeHtml {
  const chosen = policy.catalog.flatMap((c) => (Number(v.qty[c.id]) > 0 ? [`${Number(v.qty[c.id])} × ${c.name.en}`] : []));
  const date = v.date || earliest;
  return html`<aside class="summary" aria-labelledby="summary-h">
    <h2 id="summary-h">Your order</h2>
    <ul class="summary__list" data-summary-items aria-live="polite">${chosen.length > 0 ? chosen.map((c) => html`<li>${c}</li>`) : html`<li class="summary__empty">Nothing chosen yet</li>`}</ul>
    <dl class="summary__meta">
      <div><dt>Day</dt><dd data-summary-date>${date ? shortDate(date) : "Not chosen yet"}</dd></div>
      <div><dt>How</dt><dd data-summary-how>${v.fulfilment === "delivery" ? "Delivery" : "Pickup"}</dd></div>
    </dl>
    <p class="summary__note">Your exact price, with any delivery or rush charge, comes in your quote. Nothing is charged online, and you can still change anything.</p>
    <p class="summary__go"><button class="btn btn--primary btn--lg" type="submit">Get my quote</button></p>
  </aside>`;
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
    const body = html`<section class="wrap page narrow"><h1 class="page-title">Order</h1>
      <p class="alert alert--error" role="alert">${icon("alert")}<span>This shop is not taking orders right now, so the form is switched off.</span></p></section>`;
    return layout({ title: "Order", body, banner: bannerFor(launch), active: "order" });
  }
  const { policy } = launch;
  const body = html`<section class="wrap page">
    <p class="eyebrow">Order</p>
    <h1 class="page-title">Order from ${policy.business.name}</h1>
    ${demoNote()}
    ${stepper(1)}
    ${i.notice ? html`<p class="alert alert--note" role="status">${icon("clock")}<span>${i.notice}</span></p>` : ""}
    ${errorSummary(problems)}
    <form method="post" action="/order/quote" class="checkout">
      <div class="checkout__main">
        <fieldset class="group">
          <legend>1 · What would you like?</legend>
          <p class="hint">Leave a quantity empty for items you don't want.</p>
          <ul class="picks">${policy.catalog.map((c) => itemCard(c, values, problems))}</ul>
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
      </div>
      ${summary(policy, values, i.earliest)}
    </form>
  </section>`;
  return layout({ title: "Order", body, shop: identityOf(launch), active: "order", scripts: ["shop.js"] });
}
