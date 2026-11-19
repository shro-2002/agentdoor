import { UNBOUNDED_CAPACITY, type BusinessPolicy, type BusyDayResult, type RefusalGroup, type SimResult } from "@agentdoor/core";
import { html, type SafeHtml } from "@agentdoor/ui";
import { istClock, shortDate } from "../../views/format.js";
import { rupees } from "../money.js";
import type { ViewCtx } from "./frame.js";
import { icon } from "./icons.js";
import { notice, postForm } from "./kit.js";

/** The "Your busiest day" section of Rehearse: what the owner's rules do when 50 customers arrive in an hour. */
export interface BusyDayView {
  requested: boolean;
  /** Null when the simulation was not asked for, or the shop has no open day to book. */
  result: BusyDayResult | null;
}

const HONEST_LABEL = "A simulation using your rules. No real orders were placed.";
const OVERSOLD_WORDS = "Orders are booked one at a time against your limit, exactly like the live shop, so nothing is sold beyond it.";
const FULL = 100;
const BAR_WIDTH = 100;

const REFUSAL_WORDS: Record<RefusalGroup, string> = {
  DAILY_LIMIT: "Daily limit reached",
  RUSH_FULL: "Rush slots full",
  TOO_SOON: "Too soon",
  CLOSED: "Closed that day",
  AREA: "Area not served",
  OVER_LIMIT: "Over the per-order limit",
  BELOW_MINIMUM: "Below your minimum order",
  NEEDS_OWNER: "Waiting for your OK",
  OTHER: "Not accepted by your rules",
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "2 × Chocolate cake · delivery to Baner · for Sun 22 Nov": the request in a customer's short words. */
function requestWords(policy: BusinessPolicy, r: SimResult["order"]["request"]): string {
  const items = r.lines.map((l) => `${l.qty} × ${policy.catalog.find((c) => c.id === l.itemId)?.name.en ?? l.itemId}`).join(" + ");
  const where = r.fulfilment.kind === "pickup" ? "pickup" : `delivery to ${r.fulfilment.area}`;
  return `${items} · ${where} · for ${shortDate(r.date)}`;
}

function orderRow(policy: BusinessPolicy, r: SimResult): SafeHtml {
  const { outcome, order } = r;
  const accepted = outcome.kind === "accepted";
  const label = outcome.kind === "accepted" ? (outcome.isRush ? "Accepted (rush)" : "Accepted") : REFUSAL_WORDS[outcome.group];
  return html`<li class="busy__order busy__order--${accepted ? "yes" : "no"}">
    <span class="busy__time">${istClock(order.atMs)}</span>
    <span class="busy__what">${requestWords(policy, order.request)}</span>
    <span class="busy__outcome">${accepted ? icon("check") : icon("lock")}${label}</span>
    <span class="busy__amount">${outcome.kind === "accepted" ? rupees(outcome.totalPaise) : "–"}</span>
  </li>`;
}

/** A bar drawn from SVG attributes (no inline style): units booked on the busy day against that day's limit. */
function capacityBar(r: BusyDayResult): SafeHtml {
  const { units, limit } = r.booked;
  const share = limit > 0 ? Math.min(FULL, Math.round((units / limit) * FULL)) : 0;
  const day = shortDate(r.calendar.rushDay);
  const words = r.noDailyLimit ? `${units} units booked for ${day}, with no daily limit set` : `${units} of ${limit} units booked for ${day}`;
  return html`<div class="busy__bar${r.noDailyLimit ? " is-open" : ""}">
    <p class="busy__barlabel">${words}</p>
    <svg viewBox="0 0 ${BAR_WIDTH} 4" preserveAspectRatio="none" aria-hidden="true" focusable="false" width="100%" height="10"><rect width="${BAR_WIDTH}" height="4" rx="2" class="busy__track"/><rect width="${share}" height="4" rx="2" class="busy__fill"/></svg>
  </div>`;
}

function limitForm(ctx: ViewCtx): SafeHtml {
  const max = UNBOUNDED_CAPACITY - 1;
  return postForm(
    `${ctx.base}/busy-day/limit`,
    html`<label class="fix-label" for="busy-limit">How many units can you really make in a day?</label>
    <div class="fix-limit__row">
      <div class="stepper"><button class="stepper__btn" type="button" data-step="-1" aria-label="One fewer">${icon("minus")}</button><input id="busy-limit" class="input stepper__input" type="number" name="unitsPerDay" min="1" max="${max}" step="1" inputmode="numeric" placeholder="Units a day" required><button class="stepper__btn" type="button" data-step="1" aria-label="One more">${icon("plus")}</button></div>
      <button class="btn btn--primary btn--sm" type="submit">Set a daily limit</button>
    </div>`,
    "fix-limit",
  );
}

/** With no daily limit nothing stops the rush, so the result says so in plain words and offers the fix right there. */
function noLimitWarning(ctx: ViewCtx, r: BusyDayResult): SafeHtml {
  const total = r.results.length;
  const lead = r.accepted === total ? `All ${total} accepted` : `${r.accepted} of ${total} accepted`;
  return html`<div class="busy__warn" role="note">
    <p class="busy__warnhead">${icon("alert")}<strong>${lead}: ${r.booked.units} units booked for ${shortDate(r.calendar.rushDay)}. Is that possible for you?</strong></p>
    <p>You have not set a daily limit, so nothing stopped the rush. Set what you can really make and run it again.</p>
    ${limitForm(ctx)}
  </div>`;
}

const stat = (label: string, value: string, tone = ""): SafeHtml => html`<li class="busy__stat${tone ? ` busy__stat--${tone}` : ""}"><span class="busy__n">${value}</span><span class="busy__l">${label}</span></li>`;

function results(ctx: ViewCtx, policy: BusinessPolicy, r: BusyDayResult): SafeHtml {
  const total = r.results.length;
  const refused = total - r.accepted;
  return html`<div class="busy__result">
    <p class="busy__lead">${total} customers arrive within one hour. The shop answers each, one at a time, for <strong>${shortDate(r.calendar.rushDay)}</strong>, your next open day with enough notice.</p>
    <ul class="busy__stats" aria-label="Results of the busy day">
      ${stat("Orders accepted", `${r.accepted} of ${total}`, "ok")}
      ${stat("Revenue accepted", rupees(r.revenuePaise))}
      ${stat("Orders refused", String(refused), refused > 0 ? "warn" : "")}
    </ul>
    ${r.noDailyLimit ? noLimitWarning(ctx, r) : ""}
    ${capacityBar(r)}
    <p class="busy__oversold busy__oversold--${r.oversold === 0 ? "ok" : "bad"}"><strong>Oversold: ${r.oversold}</strong><span>${OVERSOLD_WORDS}</span></p>
    ${r.refusals.length > 0 ? html`<div class="busy__refused"><h3 class="busy__h">Why orders were refused</h3><ul class="busy__reasons">${r.refusals.map((x) => html`<li><span>${REFUSAL_WORDS[x.group]}</span><strong>${plural(x.count, "order", "orders")}</strong></li>`)}</ul></div>` : ""}
    <details class="busy__all"><summary>See every order (${total})</summary><ol class="busy__orders">${r.results.map((x) => orderRow(policy, x))}</ol></details>
  </div>`;
}

export function busyDaySection(ctx: ViewCtx, policy: BusinessPolicy, busy: BusyDayView): SafeHtml {
  const body = busy.result
    ? results(ctx, policy, busy.result)
    : busy.requested
      ? notice("warn", "No day is open for orders in your booking window, so there is nothing to simulate. Check your closed days and notice period in Rules.")
      : "";
  return html`<section class="busy" id="busy-day" aria-labelledby="busy-h">
    <header class="busy__head">
      <div><h2 id="busy-h" class="busy__title">Your busiest day</h2><p class="busy__intro">See what your rules do when a festival sends 50 customers in one hour.</p></div>
      <form method="get" action="${ctx.base}/rehearse#busy-day"><input type="hidden" name="simulate" value="1"><button class="btn btn--primary" type="submit">${icon("sparkle")}Simulate a festival rush</button></form>
    </header>
    ${body}
    <p class="busy__note">${HONEST_LABEL}</p>
  </section>`;
}
