import { html, domId, type SafeHtml } from "@agentdoor/ui";
import type { BusinessPolicy } from "@agentdoor/core";
import { inr } from "../../views/format.js";
import { RULES, rupeesInput, type RuleDef } from "./describe.js";
import { editBox, field, input, money, num, saveRow, select, toggle, toggleValue } from "./form-bits.js";
import { frame, type ViewCtx } from "./frame.js";
import { postForm } from "./kit.js";
import { approveAll, ruleLine, statedPending } from "./rule-line.js";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MAX_LEAD_HOURS = 336;
const MAX_ADVANCE_DAYS = 90;
const MAX_UNITS = 500;
const MAX_LINES = 20;
const MAX_HOLD_MINUTES = 1440;
const MAX_CANCEL_HOURS = 720;
const MIN_HOLD_MINUTES = 5;
const REFUSE_OR_ASK: [string, string][] = [["REFUSE", "Refuse them"], ["ASK_OWNER", "Ask me first"]];
const pick = (current: string): [string, string, boolean][] => REFUSE_OR_ASK.map(([v, l]) => [v, l, v === current]);

/** A titled block inside a group: its rule rows, then one edit form that opens in place. */
function block(ctx: ViewCtx, id: string, title: string, defs: RuleDef[], form: SafeHtml): SafeHtml {
  const p = ctx.state.policy as BusinessPolicy;
  const rows = defs.filter((d) => d.when?.(p) ?? true).map((d) => ruleLine(ctx, d.path, d.label, d.value(p), "rules"));
  return html`<div class="block" id="${id}"><h3 class="block__title">${title}</h3><ul class="rules">${rows}</ul>${editBox("Edit", form)}</div>`;
}

export function group(id: string, title: string, blocks: SafeHtml[]): SafeHtml {
  return html`<section class="group" aria-labelledby="${id}-h"><h2 id="${id}-h" class="group__title">${title}</h2><div class="panel">${blocks}</div></section>`;
}

function deliveryForm(ctx: ViewCtx, p: BusinessPolicy): SafeHtml {
  const d = p.fulfilment.delivery;
  return postForm(
    `${ctx.base}/rules/delivery`,
    html`<div class="grid2">${toggle("deliveryEnabled", "We deliver", d.enabled)}${toggle("pickupEnabled", "Customers can pick up", p.fulfilment.pickup.enabled)}</div>
    ${field("pickupLabel", "Pickup place (optional)", input("pickupLabel", "pickupLabel", p.fulfilment.pickup.areaLabel ?? "", 'maxlength="80"'))}
    ${field("unlisted", "Orders for other areas", select("unlisted", "unlistedArea", pick(d.unlistedArea)))}
    ${saveRow()}`,
  );
}

function areaRow(ctx: ViewCtx, a: BusinessPolicy["fulfilment"]["delivery"]["areas"][number], i: number): SafeHtml {
  const path = `fulfilment.delivery.areas[${a.id}].feePaise`;
  const form = html`${postForm(
    `${ctx.base}/areas/${a.id}`,
    html`<div class="grid2">${field(`an${i}`, "Area name", input(`an${i}`, "name", a.name, 'maxlength="80" required'))}${field(`af${i}`, "Delivery fee (₹)", money(`af${i}`, "fee", a.feePaise))}</div>
    ${field(`aa${i}`, "Other names, separated by commas", input(`aa${i}`, "aliases", a.aliases.join(", "), 'maxlength="400"'))}${saveRow()}`,
  )}${postForm(`${ctx.base}/areas/${a.id}/remove`, html`<button class="link link--bad" type="submit">Remove ${a.name}</button>`)}`;
  return html`<li class="area" id="${domId(`area-${a.id}`)}"><ul class="rules">${ruleLine(ctx, path, a.name, a.feePaise === 0 ? "Free delivery" : `${inr(a.feePaise)} delivery`, "rules")}</ul>${editBox(`Edit ${a.name}`, form)}</li>`;
}

function areasBlock(ctx: ViewCtx, p: BusinessPolicy): SafeHtml {
  const areas = p.fulfilment.delivery.areas;
  const add = postForm(
    `${ctx.base}/areas/add`,
    html`<div class="grid2">${field("newArea", "Area name", input("newArea", "name", "", 'maxlength="80" required'))}${field("newFee", "Delivery fee (₹)", input("newFee", "fee", "0", 'type="text" inputmode="decimal" required'))}</div>
    ${field("newAlias", "Other names, separated by commas", input("newAlias", "aliases", "", 'maxlength="400"'))}${saveRow("Add area")}`,
  );
  return html`<div class="block" id="areas"><h3 class="block__title">Delivery areas</h3>
    ${areas.length === 0 ? html`<p class="muted">No delivery areas yet.</p>` : html`<ul class="areas">${areas.map((a, i) => areaRow(ctx, a, i))}</ul>`}${editBox("Add an area", add)}</div>`;
}

function timingForm(ctx: ViewCtx, p: BusinessPolicy): SafeHtml {
  const s = p.schedule;
  return postForm(
    `${ctx.base}/rules/timing`,
    html`<div class="grid2">${field("lead", "Notice needed (hours)", num("lead", "minLeadHours", s.minLeadHours, 0, MAX_LEAD_HOURS))}${field("adv", "Orders accepted up to (days ahead)", num("adv", "maxAdvanceDays", s.maxAdvanceDays, 1, MAX_ADVANCE_DAYS))}</div>
    <fieldset class="field"><legend>Closed on</legend><div class="checks">${WEEKDAY_NAMES.map((d, i) => toggleValue("closedWeekdays", String(i), d, s.closedWeekdays.includes(i)))}</div></fieldset>
    ${field("cutoff", "Daily order cut-off (optional, like 17:00)", input("cutoff", "dailyCutoff", s.dailyCutoff ?? "", 'maxlength="5" placeholder="17:00"'))}${saveRow()}`,
  );
}

const capacityForm = (ctx: ViewCtx, p: BusinessPolicy): SafeHtml =>
  postForm(`${ctx.base}/rules/capacity`, html`${field("cap", "Units you can make in a day", num("cap", "unitsPerDay", p.capacity.unitsPerDay, 1, MAX_UNITS))}${saveRow()}`);

function rushForm(ctx: ViewCtx, p: BusinessPolicy): SafeHtml {
  const r = p.rush;
  const percent = r?.surcharge.kind === "percent";
  const amount = r ? (r.surcharge.kind === "flat" ? rupeesInput(r.surcharge.paise) : String(r.surcharge.bp / 100)) : "0";
  return postForm(
    `${ctx.base}/rules/rush`,
    html`${toggle("rushEnabled", "Take rush orders", r !== null)}
    <div class="grid2">${field("rw", "Counts as rush within (hours)", num("rw", "withinHours", r?.withinHours ?? 24, 0, MAX_LEAD_HOURS))}${field("rc", "Rush units per day", num("rc", "maxRushUnitsPerDay", r?.maxRushUnitsPerDay ?? 2, 0, MAX_UNITS))}</div>
    <div class="grid2">${field("rk", "Extra charge", select("rk", "surchargeKind", [["flat", "Flat (₹)", !percent], ["percent", "Percent (%)", percent]]))}${field("rv", "Amount", input("rv", "surchargeValue", amount, 'type="text" inputmode="decimal"'))}</div>
    ${saveRow()}`,
  );
}

function ordersForm(ctx: ViewCtx, p: BusinessPolicy): SafeHtml {
  const o = p.orderRules;
  return postForm(
    `${ctx.base}/rules/orders`,
    html`<div class="grid2">${field("mo", "Minimum order (₹)", money("mo", "minOrder", o.minOrderPaise))}${field("ml", "Items per order, at most", num("ml", "maxLinesPerOrder", o.maxLinesPerOrder, 1, MAX_LINES))}</div>
    <div class="grid2">${field("cr", "Custom requests", select("cr", "customRequests", pick(o.customRequests)))}${field("qv", "Quote holds for (minutes)", num("qv", "quoteValidityMinutes", o.quoteValidityMinutes, MIN_HOLD_MINUTES, MAX_HOLD_MINUTES))}</div>
    ${saveRow()}`,
  );
}

function cancellationBlock(ctx: ViewCtx, p: BusinessPolicy): SafeHtml {
  const c = p.cancellation;
  const form = postForm(
    `${ctx.base}/rules/cancellation`,
    html`${field("fc", "Free cancellation up to (hours before)", num("fc", "freeCancelHours", c.freeCancelHours, 0, MAX_CANCEL_HOURS))}${field("cn", "Note for customers", input("cn", "cancelNote", c.note.en, 'maxlength="200"'))}${saveRow()}`,
  );
  const text = c.note.en || (c.freeCancelHours === 0 ? "No free cancellation." : `Free to cancel up to ${c.freeCancelHours} hours before.`);
  return html`<div class="block" id="cancellation"><h3 class="block__title">Cancellations</h3><p class="block__text">${text}</p>${editBox("Edit", form)}</div>`;
}

export function rulesPage(ctx: ViewCtx): string {
  const p = ctx.state.policy;
  const head = { title: "Rules", lede: "What your shop will and won't do. Rules you stated show your own words." };
  if (!p) return frame(ctx, "rules", head, html`<section class="empty"><p>Your rules appear once your business is set up.</p><p><a class="btn btn--primary" href="${ctx.base}/setup">Go to Setup</a></p></section>`);
  return frame(
    ctx,
    "rules",
    { ...head, actions: approveAll(ctx, "rules", statedPending(ctx)) },
    html`<div class="stack stack--lg">
      ${group("delivery", "Delivery and pickup", [block(ctx, "delivery-rules", "How customers get their order", RULES.delivery, deliveryForm(ctx, p)), areasBlock(ctx, p)])}
      ${group("timing", "Timing and capacity", [block(ctx, "timing-rules", "Notice and closed days", RULES.timing, timingForm(ctx, p)), block(ctx, "capacity-rules", "Daily capacity", RULES.capacity, capacityForm(ctx, p)), block(ctx, "rush-rules", "Rush orders", RULES.rush, rushForm(ctx, p))])}
      ${group("orders", "Orders and cancellations", [block(ctx, "order-rules", "Order limits", RULES.orders, ordersForm(ctx, p)), cancellationBlock(ctx, p)])}
    </div>`,
  );
}
