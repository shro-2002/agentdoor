import type { BusinessPolicy } from "@agentdoor/core";
import { html, icon, type SafeHtml } from "@agentdoor/ui";
import type { LaunchState } from "../db/launch-state.js";
import { DIETARY, UNIT_WORD, earliestDate, hoursLine, inr, plainRules, shortDate, spanOfHours } from "./format.js";
import { layout, type ShopIdentity } from "./layout.js";

export const NOT_LAUNCHED_BANNER = "Not launched: this shop isn't taking orders yet.";

export const identityOf = (launch: LaunchState): ShopIdentity | undefined =>
  launch.launched ? { name: launch.policy.business.name, hours: hoursLine(launch.policy) } : undefined;

/** The policy has no tagline field, so the short line is fixed: "<Shop name> · Order online". */
export const HOME_TAGLINE = "Order online";
export const homeTitle = (shopName: string, tagline: string = HOME_TAGLINE): string => `${shopName} · ${tagline}`;

export const bannerFor = (launch: LaunchState): string | undefined => (launch.launched ? undefined : NOT_LAUNCHED_BANNER);

function dietaryTags(tags: string[]): SafeHtml {
  if (tags.length === 0) return html``;
  return html`<ul class="tags" aria-label="Dietary">${tags.map((t) => {
    const d = DIETARY[t] ?? { label: t.replace(/_/g, " "), caution: false };
    return html`<li class="tag ${d.caution ? "tag--caution" : "tag--ok"}">${icon(d.caution ? "alert" : "check")}<span>${d.label}</span></li>`;
  })}</ul>`;
}

function dish(policy: BusinessPolicy, item: BusinessPolicy["catalog"][number]): SafeHtml {
  const unit = UNIT_WORD[item.unit] ?? { one: item.unit, many: item.unit, per: `per ${item.unit}` };
  const qty = item.minQty === item.maxQtyPerOrder ? `${item.minQty}` : `${item.minQty} to ${item.maxQtyPerOrder}`;
  const unitWord = item.maxQtyPerOrder > 1 ? unit.many : unit.one;
  return html`<li class="dish">
    <article aria-labelledby="dish-${item.id}">
      <header class="dish__head">
        <h3 class="dish__name" id="dish-${item.id}">${item.name.en}</h3>
        ${item.name.hi ? html`<p class="dish__hi" lang="hi">${item.name.hi}</p>` : ""}
      </header>
      <p class="dish__price"><span class="dish__amt">${inr(item.unitPricePaise)}</span> <span class="dish__unit">${unit.per}</span></p>
      ${dietaryTags(item.dietary)}
      <ul class="dish__facts">
        <li>${icon("clock")}<span>Made to order: ready ${spanOfHours(Math.max(item.prepHours, policy.schedule.minLeadHours))} after you order</span></li>
        <li>${icon("receipt")}<span>${qty} ${unitWord} per order</span></li>
      </ul>
      ${item.options.length > 0
        ? html`<p class="dish__extras"><span class="dish__extras-label">Add:</span> ${item.options.map((o, i) => html`${i > 0 ? ", " : ""}${o.label.en} <span class="nowrap">+${inr(o.surchargePaise)}</span>`)}</p>`
        : ""}
      <p class="dish__cta"><a class="btn btn--secondary" href="/order?item=${item.id}">Order ${item.name.en}</a></p>
    </article>
  </li>`;
}

const STEPS = [
  { t: "Pick and ask", d: "Choose what you want and the day. You get a price straight away, no waiting." },
  { t: "Check the quote", d: "The quote is signed and holds for a short while. Nothing is charged online." },
  { t: "The owner confirms", d: "Your request goes to the baker, who confirms it by hand. You keep a private link to check the status." },
];

function howItWorks(): SafeHtml {
  return html`<section class="band" aria-labelledby="how-h">
    <div class="wrap">
      <h2 id="how-h" class="band__title">How ordering works</h2>
      <ol class="how">${STEPS.map((s, i) => html`<li><span class="how__n" aria-hidden="true">${i + 1}</span><h3>${s.t}</h3><p>${s.d}</p></li>`)}</ol>
    </div>
  </section>`;
}

function houseRules(policy: BusinessPolicy): SafeHtml {
  return html`<section class="wrap section" aria-labelledby="rules-h">
    <h2 id="rules-h" class="section__title">House rules, in plain words</h2>
    <p class="section__lead">These are the owner's own rules. The shop enforces every one of them before it quotes.</p>
    <dl class="ledger">${plainRules(policy).map((r) => html`<div class="ledger__row"><dt>${icon(r.icon)}<span>${r.title}</span></dt><dd>${r.text}</dd></div>`)}</dl>
  </section>`;
}

function delivery(policy: BusinessPolicy): SafeHtml {
  const { delivery: d, pickup } = policy.fulfilment;
  return html`<section class="wrap section" aria-labelledby="deliver-h">
    <h2 id="deliver-h" class="section__title">Pickup and delivery</h2>
    <div class="twin">
      ${pickup.enabled ? html`<div class="panel"><h3>${icon("door")}Pickup</h3><p>${pickup.areaLabel ? `Collect from ${pickup.areaLabel}.` : "Collect from the baker."} Free.</p></div>` : ""}
      ${d.enabled
        ? html`<div class="panel"><h3>${icon("truck")}Delivery</h3>
            <table class="fees"><caption class="visually-hidden">Delivery fee by area</caption>
              <thead><tr><th scope="col">Area</th><th scope="col" class="num">Fee</th></tr></thead>
              <tbody>${d.areas.map((a) => html`<tr><th scope="row">${a.name}</th><td class="num">${a.feePaise === 0 ? "Free" : inr(a.feePaise)}</td></tr>`)}</tbody>
            </table></div>`
        : ""}
    </div>
  </section>`;
}

function hero(policy: BusinessPolicy, nowMs: number): SafeHtml {
  const first = earliestDate(policy, nowMs);
  const { business, schedule, capacity, orderRules } = policy;
  const closed = schedule.closedWeekdays.length;
  return html`<section class="hero">
    <div class="wrap hero__grid">
      <div>
        <p class="eyebrow">${business.city} · home-baked to order</p>
        <h1 class="hero__title">${business.name}</h1>
        <p class="hero__lead">Fixed prices, written down by ${business.ownerFirstName}. Ask for a quote, see the total, and ${business.ownerFirstName} confirms your order by hand.</p>
        <p class="hero__cta">
          <a class="btn btn--primary btn--lg" href="/order${first ? `?date=${first}` : ""}">${first ? `Order for ${shortDate(first)}` : "Order"}</a>
          <a class="btn btn--secondary btn--lg" href="#menu">See the menu</a>
        </p>
      </div>
      <aside class="notice" aria-label="Notice and capacity">
        <p class="notice__title">${icon("clock")}Good to know</p>
        <ul>
          <li>Order at least <strong>${spanOfHours(schedule.minLeadHours)}</strong> ahead</li>
          <li>Up to <strong>${capacity.unitsPerDay} units</strong> of baking a day</li>
          ${closed > 0 ? html`<li>${hoursLine(policy)}</li>` : ""}
          <li>Minimum order <strong>${inr(orderRules.minOrderPaise)}</strong></li>
        </ul>
      </aside>
    </div>
  </section>`;
}

export function storefrontPage(launch: LaunchState, nowMs: number): string {
  if (!launch.launched) {
    const body = html`<section class="hero"><div class="wrap">
      <h1 class="hero__title">This shop isn't open yet</h1>
      <p class="hero__lead">Its rules haven't been checked and signed, so it cannot take orders. Come back soon.</p>
    </div></section>`;
    return layout({ title: "Not open yet", body, banner: NOT_LAUNCHED_BANNER, active: "menu" });
  }
  const { policy } = launch;
  const body = html`${hero(policy, nowMs)}
    <section class="wrap section" id="menu" aria-labelledby="menu-h">
      <h2 id="menu-h" class="section__title">The menu</h2>
      <ul class="menu">${policy.catalog.map((i) => dish(policy, i))}</ul>
    </section>
    ${howItWorks()}
    ${houseRules(policy)}
    ${delivery(policy)}`;
  return layout({
    title: homeTitle(policy.business.name),
    fullTitle: true,
    body,
    shop: identityOf(launch),
    active: "menu",
    description: `${policy.business.name} in ${policy.business.city}: menu, prices and house rules, with ordering for people and AI agents.`,
  });
}
