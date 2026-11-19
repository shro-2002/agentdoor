import { html, domId, type SafeHtml } from "@agentdoor/ui";
import type { BusinessPolicy } from "@agentdoor/core";
import { inr } from "../../views/format.js";
import { optionsText } from "../edit.js";
import { editBox, field, input, money, num, saveRow, select, toggleValue } from "./form-bits.js";
import { frame, type ViewCtx } from "./frame.js";
import { postForm } from "./kit.js";
import { approveAll, ruleLine, statedPending } from "./rule-line.js";
import { group } from "./rules.js";

const UNITS = ["piece", "kg", "box", "dozen"] as const;
const DIETARY: [string, string][] = [
  ["eggless", "Eggless"],
  ["vegan", "Vegan"],
  ["contains_nuts", "Contains nuts"],
  ["gluten_free", "Gluten free"],
];
const MAX_QTY = 1000;
const MAX_PREP_HOURS = 720;
const unitOptions = (current: string): [string, string, boolean][] => UNITS.map((u) => [u, u, u === current]);

type Item = BusinessPolicy["catalog"][number];

function productForm(ctx: ViewCtx, item: Item, i: number): SafeHtml {
  return postForm(
    `${ctx.base}/products/${item.id}`,
    html`<div class="grid2">${field(`pn${i}`, "Name", input(`pn${i}`, "name", item.name.en, 'maxlength="80" required'))}${field(`pp${i}`, "Price (₹)", money(`pp${i}`, "price", item.unitPricePaise))}</div>
    <div class="grid3">${field(`pu${i}`, "Sold by", select(`pu${i}`, "unit", unitOptions(item.unit)))}${field(`pmn${i}`, "Least per order", num(`pmn${i}`, "minQty", item.minQty, 1, MAX_QTY))}${field(`pmx${i}`, "Most per order", num(`pmx${i}`, "maxQty", item.maxQtyPerOrder, 1, MAX_QTY))}</div>
    ${field(`ph${i}`, "Notice needed (hours)", num(`ph${i}`, "prepHours", item.prepHours, 0, MAX_PREP_HOURS))}
    <fieldset class="field"><legend>Labels</legend><div class="checks">${DIETARY.map(([v, l]) => toggleValue("dietary", v, l, item.dietary.includes(v as "vegan")))}</div></fieldset>
    ${field(`po${i}`, "Extras, one per line: name, price", html`<textarea id="po${i}" class="input input--area" name="options" rows="3" maxlength="1200">${optionsText(item)}</textarea>`, "For example: Eggless, 50")}
    ${saveRow()}`,
  );
}

function productBlock(ctx: ViewCtx, item: Item, i: number, canRemove: boolean): SafeHtml {
  const base = `catalog[${item.id}]`;
  const labels = item.dietary.map((d) => html`<span class="tag tag--plain">${d.replace("_", " ")}</span>`);
  const remove = canRemove ? postForm(`${ctx.base}/products/${item.id}/remove`, html`<button class="link link--bad" type="submit">Remove this product</button>`) : "";
  return html`<article class="block product" id="${domId(`product-${item.id}`)}" aria-labelledby="ph-${i}">
    <header class="product__head"><h3 id="ph-${i}" class="block__title">${item.name.en}</h3><p class="product__price">${inr(item.unitPricePaise)} <span>per ${item.unit}</span></p>${labels}</header>
    <ul class="rules">
      ${ruleLine(ctx, `${base}.unitPricePaise`, "Price", `${inr(item.unitPricePaise)} per ${item.unit}`, "products")}
      ${ruleLine(ctx, `${base}.maxQtyPerOrder`, "Most per order", String(item.maxQtyPerOrder), "products")}
      ${ruleLine(ctx, `${base}.prepHours`, "Notice needed", `${item.prepHours} hours`, "products")}
    </ul>
    ${editBox("Edit product", html`${productForm(ctx, item, i)}${remove}`)}
  </article>`;
}

function addBlock(ctx: ViewCtx): SafeHtml {
  const form = postForm(
    `${ctx.base}/products/add`,
    html`<div class="grid3">${field("npn", "Name", input("npn", "name", "", 'maxlength="80" required'))}${field("npp", "Price (₹)", input("npp", "price", "", 'type="text" inputmode="decimal" required'))}${field("npu", "Sold by", select("npu", "unit", unitOptions("")))}</div>${saveRow("Add product")}`,
  );
  return html`<div class="block" id="add-product"><h3 class="block__title">Add a product</h3>${form}</div>`;
}

export function productsPage(ctx: ViewCtx): string {
  const p = ctx.state.policy;
  const head = { title: "Products", lede: "Your menu. Prices are in rupees and every change is checked before it is saved." };
  if (!p) return frame(ctx, "products", head, html`<section class="empty"><p>Your products appear once your business is set up.</p><p><a class="btn btn--primary" href="${ctx.base}/setup">Go to Setup</a></p></section>`);
  const blocks = p.catalog.map((c, i) => productBlock(ctx, c, i, p.catalog.length > 1));
  return frame(ctx, "products", { ...head, actions: approveAll(ctx, "products", statedPending(ctx)) }, html`<div class="stack stack--lg">${group("menu", "Menu", [...blocks, addBlock(ctx)])}</div>`);
}
