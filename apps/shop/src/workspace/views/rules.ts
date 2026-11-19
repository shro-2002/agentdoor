import { html, domId, raw, type SafeHtml } from "@agentdoor/ui";
import type { BusinessPolicy } from "@agentdoor/core";
import { inr } from "../../views/format.js";
import { optionsText } from "../edit.js";
import { RULES, rupeesInput, sourceOf, type RuleDef } from "./describe.js";
import { frame, type Tab, type ViewCtx } from "./frame.js";
import { badge, postForm } from "./kit.js";

const MAX_QUOTE_CHARS = 160;
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const clip = (t: string): string => (t.length > MAX_QUOTE_CHARS ? `${t.slice(0, MAX_QUOTE_CHARS - 1).trimEnd()}…` : t);

const checked = (on: boolean): SafeHtml => (on ? raw(" checked") : raw(""));
const selected = (on: boolean): SafeHtml => (on ? raw(" selected") : raw(""));

/** One rule: its value, whose words it came from (or "Suggested by AgentDoor"), and its approval. */
export function ruleLine(ctx: ViewCtx, path: string, label: string, value: string, back: Tab): SafeHtml {
  const prov = ctx.state.policy?.provenance[path];
  const src = sourceOf(prov);
  const approved = prov?.status === "approved";
  return html`<li class="rule" id="${domId(`rule-${path}`)}">
    <div class="rule__main"><span class="rule__label">${label}</span><span class="rule__value">${value}</span></div>
    <div class="rule__src">${
      src.quote
        ? html`<span class="rule__said">You said:</span> <q>${clip(src.quote)}</q>`
        : src.kind === "suggested"
          ? badge("info", src.label)
          : html`<span class="muted">${src.label}</span>`
    }</div>
    <div class="rule__act">${
      approved
        ? badge("ok", "Approved")
        : postForm(`${ctx.base}/approve`, html`<input type="hidden" name="path" value="${path}"><input type="hidden" name="next" value="${back}"><button class="btn btn--sm" type="submit">Approve</button>`)
    }</div>
  </li>`;
}

const toggle = (name: string, label: string, on: boolean): SafeHtml =>
  html`<label class="check"><input type="checkbox" name="${name}"${checked(on)}><span>${label}</span></label>`;

const field = (id: string, label: string, control: SafeHtml, hint = ""): SafeHtml =>
  html`<div class="field"><label for="${id}">${label}</label>${control}${hint ? html`<p class="hint">${hint}</p>` : ""}</div>`;

const input = (id: string, name: string, value: string | number, attrs = ""): SafeHtml =>
  html`<input id="${id}" class="input" name="${name}" value="${value}" ${raw(attrs)}>`;

const num = (id: string, name: string, value: number, min: number, max: number): SafeHtml =>
  input(id, name, value, `type="number" inputmode="numeric" min="${min}" max="${max}" step="1" required`);

const money = (id: string, name: string, paise: number): SafeHtml => input(id, name, rupeesInput(paise), 'type="text" inputmode="decimal" required');

function editBox(summary: string, form: SafeHtml): SafeHtml {
  return html`<details class="edit"><summary>${summary}</summary><div class="edit__body">${form}</div></details>`;
}

function ruleList(ctx: ViewCtx, defs: RuleDef[], back: Tab): SafeHtml {
  const policy = ctx.state.policy as BusinessPolicy;
  return html`<ul class="rules">${defs.filter((d) => d.when?.(policy) ?? true).map((d) => ruleLine(ctx, d.path, d.label, d.value(policy), back))}</ul>`;
}

function section(ctx: ViewCtx, id: string, title: string, defs: RuleDef[], form: SafeHtml): SafeHtml {
  return html`<section class="card" id="${id}" aria-labelledby="${id}-h"><h2 id="${id}-h" class="card__title">${title}</h2>${ruleList(ctx, defs, "rules")}${editBox("Edit", form)}</section>`;
}

const saveRow = (): SafeHtml => html`<div class="row"><button class="btn btn--primary" type="submit">Save</button></div>`;

function deliveryForm(ctx: ViewCtx, p: BusinessPolicy): SafeHtml {
  const d = p.fulfilment.delivery;
  return postForm(
    `${ctx.base}/rules/delivery`,
    html`<div class="grid2">
      ${toggle("deliveryEnabled", "We deliver", d.enabled)}${toggle("pickupEnabled", "Customers can pick up", p.fulfilment.pickup.enabled)}
    </div>
    ${field("pickupLabel", "Pickup place (optional)", input("pickupLabel", "pickupLabel", p.fulfilment.pickup.areaLabel ?? "", 'maxlength="80"'))}
    ${field("unlisted", "Orders for other areas", html`<select id="unlisted" class="input" name="unlistedArea"><option value="REFUSE"${selected(d.unlistedArea === "REFUSE")}>Refuse them</option><option value="ASK_OWNER"${selected(d.unlistedArea === "ASK_OWNER")}>Ask me first</option></select>`)}
    ${saveRow()}`,
  );
}

function areasCard(ctx: ViewCtx, p: BusinessPolicy): SafeHtml {
  const areas = p.fulfilment.delivery.areas;
  const items = areas.map((a, i) => {
    const path = `fulfilment.delivery.areas[${a.id}].feePaise`;
    return html`<li class="area" id="${domId(`area-${a.id}`)}">
      <ul class="rules">${ruleLine(ctx, path, a.name, a.feePaise === 0 ? "Free delivery" : `${inr(a.feePaise)} delivery`, "rules")}</ul>
      ${editBox(
        `Edit ${a.name}`,
        html`${postForm(
          `${ctx.base}/areas/${a.id}`,
          html`<div class="grid2">${field(`an${i}`, "Area name", input(`an${i}`, "name", a.name, 'maxlength="80" required'))}${field(`af${i}`, "Delivery fee (₹)", money(`af${i}`, "fee", a.feePaise))}</div>
          ${field(`aa${i}`, "Other names, separated by commas", input(`aa${i}`, "aliases", a.aliases.join(", "), 'maxlength="400"'))}
          ${saveRow()}`,
        )}
        ${postForm(`${ctx.base}/areas/${a.id}/remove`, html`<button class="link link--bad" type="submit">Remove ${a.name}</button>`)}`,
      )}
    </li>`;
  });
  return html`<section class="card" id="areas" aria-labelledby="areas-h"><h2 id="areas-h" class="card__title">Delivery areas</h2>
    ${areas.length === 0 ? html`<p class="muted">No delivery areas yet.</p>` : html`<ul class="areas">${items}</ul>`}
    ${editBox(
      "Add an area",
      postForm(
        `${ctx.base}/areas/add`,
        html`<div class="grid2">${field("newArea", "Area name", input("newArea", "name", "", 'maxlength="80" required'))}${field("newFee", "Delivery fee (₹)", input("newFee", "fee", "0", 'type="text" inputmode="decimal" required'))}</div>
        ${field("newAlias", "Other names, separated by commas", input("newAlias", "aliases", "", 'maxlength="400"'))}
        <div class="row"><button class="btn btn--primary" type="submit">Add area</button></div>`,
      ),
    )}
  </section>`;
}

function timingForm(ctx: ViewCtx, p: BusinessPolicy): SafeHtml {
  const s = p.schedule;
  return postForm(
    `${ctx.base}/rules/timing`,
    html`<div class="grid2">${field("lead", "Notice needed (hours)", num("lead", "minLeadHours", s.minLeadHours, 0, 336))}${field("adv", "Orders accepted up to (days ahead)", num("adv", "maxAdvanceDays", s.maxAdvanceDays, 1, 90))}</div>
    <fieldset class="field"><legend>Closed on</legend><div class="checks">${WEEKDAY_NAMES.map((d, i) => toggleValue("closedWeekdays", String(i), d, s.closedWeekdays.includes(i)))}</div></fieldset>
    ${field("cutoff", "Daily order cut-off (optional, like 17:00)", input("cutoff", "dailyCutoff", s.dailyCutoff ?? "", 'maxlength="5" placeholder="17:00"'))}
    ${saveRow()}`,
  );
}

const toggleValue = (name: string, value: string, label: string, on: boolean): SafeHtml =>
  html`<label class="check"><input type="checkbox" name="${name}" value="${value}"${checked(on)}><span>${label}</span></label>`;

function capacityForm(ctx: ViewCtx, p: BusinessPolicy): SafeHtml {
  return postForm(`${ctx.base}/rules/capacity`, html`${field("cap", "Units you can make in a day", num("cap", "unitsPerDay", p.capacity.unitsPerDay, 1, 500))}${saveRow()}`);
}

function rushForm(ctx: ViewCtx, p: BusinessPolicy): SafeHtml {
  const r = p.rush;
  const percent = r?.surcharge.kind === "percent";
  const amount = r ? (r.surcharge.kind === "flat" ? rupeesInput(r.surcharge.paise) : String(r.surcharge.bp / 100)) : "0";
  return postForm(
    `${ctx.base}/rules/rush`,
    html`${toggle("rushEnabled", "Take rush orders", r !== null)}
    <div class="grid2">${field("rw", "Counts as rush within (hours)", num("rw", "withinHours", r?.withinHours ?? 24, 0, 336))}${field("rc", "Rush units per day", num("rc", "maxRushUnitsPerDay", r?.maxRushUnitsPerDay ?? 2, 0, 500))}</div>
    <div class="grid2">${field("rk", "Extra charge", html`<select id="rk" class="input" name="surchargeKind"><option value="flat"${selected(!percent)}>Flat (₹)</option><option value="percent"${selected(percent)}>Percent (%)</option></select>`)}${field("rv", "Amount", input("rv", "surchargeValue", amount, 'type="text" inputmode="decimal"'))}</div>
    ${saveRow()}`,
  );
}

function ordersForm(ctx: ViewCtx, p: BusinessPolicy): SafeHtml {
  const o = p.orderRules;
  return postForm(
    `${ctx.base}/rules/orders`,
    html`<div class="grid2">${field("mo", "Minimum order (₹)", money("mo", "minOrder", o.minOrderPaise))}${field("ml", "Items per order, at most", num("ml", "maxLinesPerOrder", o.maxLinesPerOrder, 1, 20))}</div>
    <div class="grid2">${field("cr", "Custom requests", html`<select id="cr" class="input" name="customRequests"><option value="REFUSE"${selected(o.customRequests === "REFUSE")}>Refuse them</option><option value="ASK_OWNER"${selected(o.customRequests === "ASK_OWNER")}>Ask me first</option></select>`)}${field("qv", "Quote holds for (minutes)", num("qv", "quoteValidityMinutes", o.quoteValidityMinutes, 5, 1440))}</div>
    ${saveRow()}`,
  );
}

function cancellationCard(ctx: ViewCtx, p: BusinessPolicy): SafeHtml {
  const c = p.cancellation;
  return html`<section class="card" id="cancellation" aria-labelledby="cancel-h"><h2 id="cancel-h" class="card__title">Cancellation</h2>
    <p>${c.note.en || (c.freeCancelHours === 0 ? "No free cancellation." : `Free to cancel up to ${c.freeCancelHours} hours before.`)}</p>
    ${editBox(
      "Edit",
      postForm(
        `${ctx.base}/rules/cancellation`,
        html`${field("fc", "Free cancellation up to (hours before)", num("fc", "freeCancelHours", c.freeCancelHours, 0, 720))}
        ${field("cn", "Note for customers", input("cn", "cancelNote", c.note.en, 'maxlength="200"'))}${saveRow()}`,
      ),
    )}
  </section>`;
}

export function rulesPage(ctx: ViewCtx): string {
  const p = ctx.state.policy;
  if (!p) return frame(ctx, "rules", "Rules", html`<section class="card"><p>Your rules appear once your business is set up.</p><p><a class="btn btn--primary" href="${ctx.base}/setup">Go to Setup</a></p></section>`);
  const pending = Object.values(p.provenance).filter((v) => v.status !== "approved" && v.source.kind === "transcript").length;
  const bulk =
    pending > 0
      ? postForm(`${ctx.base}/approve-stated`, html`<input type="hidden" name="next" value="rules"><button class="btn btn--primary" type="submit">Approve all I stated (${pending})</button>`)
      : html``;
  return frame(
    ctx,
    "rules",
    "Rules",
    html`<div class="toolbar"><p class="muted toolbar__text">Rules you stated show your own words. Anything else is marked as suggested by AgentDoor.</p>${bulk}</div>
    <div class="stack">
      ${section(ctx, "delivery", "Delivery and pickup", RULES.delivery, deliveryForm(ctx, p))}
      ${areasCard(ctx, p)}
      ${section(ctx, "timing", "Notice and closed days", RULES.timing, timingForm(ctx, p))}
      ${section(ctx, "capacity", "Daily capacity", RULES.capacity, capacityForm(ctx, p))}
      ${section(ctx, "rush", "Rush orders", RULES.rush, rushForm(ctx, p))}
      ${section(ctx, "orders", "Orders", RULES.orders, ordersForm(ctx, p))}
      ${cancellationCard(ctx, p)}
    </div>`,
  );
}

const UNITS = ["piece", "kg", "box", "dozen"] as const;
const DIETARY: [string, string][] = [
  ["eggless", "Eggless"],
  ["vegan", "Vegan"],
  ["contains_nuts", "Contains nuts"],
  ["gluten_free", "Gluten free"],
];

function productCard(ctx: ViewCtx, item: BusinessPolicy["catalog"][number], i: number): SafeHtml {
  const base = `catalog[${item.id}]`;
  const form = postForm(
    `${ctx.base}/products/${item.id}`,
    html`<div class="grid2">${field(`pn${i}`, "Name", input(`pn${i}`, "name", item.name.en, 'maxlength="80" required'))}${field(`pp${i}`, "Price (₹)", money(`pp${i}`, "price", item.unitPricePaise))}</div>
    <div class="grid3">${field(`pu${i}`, "Sold by", html`<select id="pu${i}" class="input" name="unit">${UNITS.map((u) => html`<option value="${u}"${selected(item.unit === u)}>${u}</option>`)}</select>`)}${field(`pmn${i}`, "Least per order", num(`pmn${i}`, "minQty", item.minQty, 1, 1000))}${field(`pmx${i}`, "Most per order", num(`pmx${i}`, "maxQty", item.maxQtyPerOrder, 1, 1000))}</div>
    ${field(`ph${i}`, "Notice needed (hours)", num(`ph${i}`, "prepHours", item.prepHours, 0, 720))}
    <fieldset class="field"><legend>Labels</legend><div class="checks">${DIETARY.map(([v, l]) => toggleValue("dietary", v, l, item.dietary.includes(v as "vegan")))}</div></fieldset>
    ${field(`po${i}`, "Extras, one per line: name, price", html`<textarea id="po${i}" class="input input--area" name="options" rows="3" maxlength="1200">${optionsText(item)}</textarea>`, "For example: Eggless, 50")}
    ${saveRow()}`,
  );
  return html`<article class="card product" id="${domId(`product-${item.id}`)}" aria-labelledby="ph-${i}">
    <header class="product__head"><h2 id="ph-${i}" class="card__title">${item.name.en}</h2><p class="muted">${inr(item.unitPricePaise)} per ${item.unit}${item.dietary.length ? ` · ${item.dietary.map((d) => d.replace("_", " ")).join(", ")}` : ""}</p></header>
    <ul class="rules">
      ${ruleLine(ctx, `${base}.unitPricePaise`, "Price", `${inr(item.unitPricePaise)} per ${item.unit}`, "products")}
      ${ruleLine(ctx, `${base}.maxQtyPerOrder`, "Most per order", String(item.maxQtyPerOrder), "products")}
      ${ruleLine(ctx, `${base}.prepHours`, "Notice needed", `${item.prepHours} hours`, "products")}
    </ul>
    ${editBox("Edit product", html`${form}${ctx.state.policy && ctx.state.policy.catalog.length > 1 ? postForm(`${ctx.base}/products/${item.id}/remove`, html`<button class="link link--bad" type="submit">Remove this product</button>`) : ""}`)}
  </article>`;
}

export function productsPage(ctx: ViewCtx): string {
  const p = ctx.state.policy;
  if (!p) return frame(ctx, "products", "Products", html`<section class="card"><p>Your products appear once your business is set up.</p><p><a class="btn btn--primary" href="${ctx.base}/setup">Go to Setup</a></p></section>`);
  const pending = Object.values(p.provenance).filter((v) => v.status !== "approved" && v.source.kind === "transcript").length;
  const bulk = pending > 0 ? postForm(`${ctx.base}/approve-stated`, html`<input type="hidden" name="next" value="products"><button class="btn" type="submit">Approve all I stated (${pending})</button>`) : html``;
  return frame(
    ctx,
    "products",
    "Products",
    html`<div class="toolbar"><p class="muted toolbar__text">Prices are in rupees and are kept as exact paise. Every change is checked before it is saved.</p>${bulk}</div>
    <div class="stack">${p.catalog.map((c, i) => productCard(ctx, c, i))}
      <section class="card" id="add-product"><h2 class="card__title">Add a product</h2>
        ${postForm(
          `${ctx.base}/products/add`,
          html`<div class="grid3">${field("npn", "Name", input("npn", "name", "", 'maxlength="80" required'))}${field("npp", "Price (₹)", input("npp", "price", "", 'type="text" inputmode="decimal" required'))}${field("npu", "Sold by", html`<select id="npu" class="input" name="unit">${UNITS.map((u) => html`<option value="${u}">${u}</option>`)}</select>`)}</div>
          <div class="row"><button class="btn btn--primary" type="submit">Add product</button></div>`,
        )}
      </section>
    </div>`,
  );
}
