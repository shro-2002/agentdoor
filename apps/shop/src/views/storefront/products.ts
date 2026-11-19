import type { BusinessPolicy } from "@agentdoor/core";
import { html, icon, type SafeHtml } from "@agentdoor/ui";
import { DIETARY, UNIT_WORD, inr, spanOfHours } from "../format.js";
import { wave } from "./ornaments.js";
import { photoImg, productPhotoFor } from "./photos.js";
import { ownerName } from "./words.js";

type Item = BusinessPolicy["catalog"][number];

/** Appetising one-liners by catalog id. Prices, units and dietary cues are never written here: they come from the policy. */
const BLURBS: Record<string, string> = {
  "chocolate-cake": "A deep, moist chocolate sponge with silky chocolate cream, baked fresh for your day.",
  "eggless-vanilla-cake": "A soft, tender vanilla sponge finished with whipped cream swirls.",
  "cookie-box": "Chocolate cookies, crisp at the edges and soft in the middle, boxed up and ready to share.",
  brownies: "Fudgy chocolate brownies cut into generous squares, made in small batches.",
};

const blurbFor = (item: Item): string => BLURBS[item.id] ?? `${item.name.en}, baked to order in small batches.`;

function dietaryTags(tags: string[]): SafeHtml {
  if (tags.length === 0) return html``;
  return html`<ul class="tags" aria-label="Dietary">${tags.map((t) => {
    const d = DIETARY[t] ?? { label: t.replace(/_/g, " "), caution: false };
    return html`<li class="tag ${d.caution ? "tag--caution" : "tag--ok"}">${icon(d.caution ? "alert" : "check")}<span>${d.label}</span></li>`;
  })}</ul>`;
}

function photoFor(item: Item): SafeHtml {
  return html`<div class="pcard__photo">${photoImg(productPhotoFor(item), { className: "photo" })}</div>`;
}

function card(policy: BusinessPolicy, item: Item): SafeHtml {
  const unit = UNIT_WORD[item.unit] ?? { one: item.unit, many: item.unit, per: `per ${item.unit}` };
  const qty = item.minQty === item.maxQtyPerOrder ? `${item.minQty}` : `${item.minQty} to ${item.maxQtyPerOrder}`;
  const notice = spanOfHours(Math.max(item.prepHours, policy.schedule.minLeadHours));
  return html`<li class="pcard">
    <article aria-labelledby="dish-${item.id}">
      ${photoFor(item)}
      <div class="pcard__body">
        <h3 class="pcard__name" id="dish-${item.id}">${item.name.en}</h3>
        ${item.name.hi ? html`<p class="pcard__hi" lang="hi">${item.name.hi}</p>` : ""}
        <p class="pcard__blurb">${blurbFor(item)}</p>
        <p class="pcard__price"><span class="pcard__amt">${inr(item.unitPricePaise)}</span> <span class="pcard__unit">${unit.per}</span></p>
        ${dietaryTags(item.dietary)}
        <p class="pcard__facts">${notice} notice · ${qty} ${item.maxQtyPerOrder > 1 ? unit.many : unit.one} per order</p>
        ${item.options.length > 0
          ? html`<p class="pcard__facts">Add: ${item.options.map((o, i) => html`${i > 0 ? ", " : ""}${o.label.en} <span class="nowrap">+${inr(o.surchargePaise)}</span>`)}</p>`
          : ""}
        <p class="pcard__cta"><a class="pcard__link" href="/order?item=${item.id}">Order ${item.name.en} <span aria-hidden="true">→</span></a></p>
      </div>
    </article>
  </li>`;
}

/** Sections 2 and 3: the collection heading, then one photo-led card per product (the first is featured on wide screens). */
export function collection(policy: BusinessPolicy): SafeHtml {
  const owner = ownerName(policy);
  return html`<section class="collection" id="menu" aria-labelledby="menu-h">
    <div class="wrap">
      <header class="section-head">
        <p class="eyebrow">The collection</p>
        <h2 id="menu-h">Fresh from the oven</h2>
        ${wave()}
        <p class="section-head__lead">Every price is set by ${owner}. Your exact total, with any delivery or rush charge, comes with your quote before you place anything.</p>
      </header>
      <ul class="products products--n${policy.catalog.length}">${policy.catalog.map((i) => card(policy, i))}</ul>
    </div>
  </section>`;
}
