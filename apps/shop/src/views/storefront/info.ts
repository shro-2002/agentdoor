import type { BusinessPolicy } from "@agentdoor/core";
import { html, icon, type SafeHtml } from "@agentdoor/ui";
import { WEEKDAYS, areaFee, inr, listWords, rushFee, spanOfHours } from "../format.js";
import { wave } from "./ornaments.js";
import { ownerName } from "./words.js";

/** Section 7: the real flow in four steps: choose, exact quote, place, owner confirms. */
export function howItWorks(policy: BusinessPolicy): SafeHtml {
  const owner = ownerName(policy);
  const steps = [
    { t: "Choose your bakes", d: "Pick what you would like and the day you need it. You can start from any bake above." },
    { t: "Get an exact quote", d: `Your price appears straight away and is held for ${policy.orderRules.quoteValidityMinutes} minutes. Prices are fixed, with no haggling.` },
    { t: "Place your order", d: "Add your name and phone number and send your request. Nothing is charged online." },
    { t: `${ownerName(policy, true)} confirms`, d: `${ownerName(policy, true)} confirms your order by hand, and you get a private link to follow its status.` },
  ];
  return html`<section class="how" id="how" aria-labelledby="how-h">
    <div class="wrap">
      <header class="section-head">
        <p class="eyebrow">Simple and friendly</p>
        <h2 id="how-h">How ordering works</h2>
        ${wave()}
      </header>
      <ol class="steps">${steps.map((s, i) => html`<li class="step"><span class="step__n" aria-hidden="true">${i + 1}</span><h3>${s.t}</h3><p>${s.d}</p></li>`)}</ol>
    </div>
  </section>`;
}

const closedDays = (policy: BusinessPolicy): string[] => policy.schedule.closedWeekdays.map((d) => `${WEEKDAYS[d]}s`);

/** Section 8: pickup, delivery areas and fees, notice and rush, as chips and short sentences (no tables). */
export function delivery(policy: BusinessPolicy): SafeHtml {
  const { pickup, delivery: d } = policy.fulfilment;
  const { schedule, rush, orderRules } = policy;
  const closed = closedDays(policy);
  const owner = ownerName(policy);
  return html`<section class="delivery" id="delivery" aria-labelledby="delivery-h">
    <div class="wrap delivery__grid">
      <div>
        <p class="eyebrow">Getting it to you</p>
        <h2 id="delivery-h">Delivery and pickup</h2>
        ${wave()}
        ${pickup.enabled ? html`<p>${pickup.areaLabel ? `Collect your order from ${pickup.areaLabel}, free of charge.` : "Collect your order from the baker, free of charge."}</p>` : ""}
        ${d.enabled
          ? html`<p>${pickup.enabled ? "Prefer it brought to you? " : ""}We deliver to these areas:</p>
            <ul class="chips" aria-label="Delivery fee by area">${d.areas.map((a) => html`<li class="chip"><strong>${a.name}</strong><span>${areaFee(a.feePaise)}</span></li>`)}</ul>
            <p class="delivery__other">${d.unlistedArea === "REFUSE" ? "We do not deliver outside these areas." : `Another area? Send ${owner} a message first, and ${owner} will decide.`}</p>`
          : ""}
      </div>
      <ul class="facts-list">
        <li>${icon("clock")}<span>Please order at least <strong>${spanOfHours(schedule.minLeadHours)}</strong> ahead, and up to ${schedule.maxAdvanceDays} days in advance.</span></li>
        ${rush ? html`<li>${icon("rupee")}<span>Need it sooner? For dates within ${spanOfHours(rush.withinHours)}, a rush charge of <strong>${rushFee(rush)}</strong> applies, and rush places are limited each day.</span></li>` : ""}
        ${closed.length > 0 ? html`<li>${icon("door")}<span>Closed on ${listWords(closed)}, so nothing can be collected or delivered then.</span></li>` : ""}
        ${orderRules.minOrderPaise > 0 ? html`<li>${icon("receipt")}<span>Minimum order ${inr(orderRules.minOrderPaise)}, before delivery.</span></li>` : ""}
      </ul>
    </div>
  </section>`;
}

interface Faq {
  q: string;
  a: string;
}

/** Answers use only what the policy states; a question with nothing to answer is left out. */
function faqs(policy: BusinessPolicy): Faq[] {
  const { schedule, cancellation, orderRules, fulfilment } = policy;
  const owner = ownerName(policy);
  const eggless = policy.catalog.filter((i) => i.dietary.includes("eggless")).map((i) => i.name.en);
  const areas = fulfilment.delivery.enabled ? fulfilment.delivery.areas.map((a) => `${a.name} (${areaFee(a.feePaise).toLowerCase()})`) : [];
  const out: Faq[] = [
    { q: "How much notice do you need?", a: `Please order at least ${spanOfHours(schedule.minLeadHours)} ahead, and up to ${schedule.maxAdvanceDays} days in advance. Each bake is made to order.` },
  ];
  if (eggless.length > 0) out.push({ q: "Do you have eggless options?", a: `Yes: ${listWords(eggless)}. Dietary labels are shown on each bake.` });
  out.push({ q: "Can I cancel an order?", a: cancellation.note.en || `Free cancellation up to ${spanOfHours(cancellation.freeCancelHours)} before.` });
  if (areas.length > 0) out.push({ q: "Which areas do you deliver to?", a: `${listWords(areas)}. ${fulfilment.delivery.unlistedArea === "REFUSE" ? "We do not deliver elsewhere." : `For another area, message ${owner} first.`}` });
  out.push({ q: "How is my order confirmed, and how do I pay?", a: `Nothing is charged on this site. After you place an order, ${owner} confirms it by hand, and you get a private link to follow its status.` });
  out.push({
    q: "Can I ask for a custom design?",
    a: orderRules.customRequests === "REFUSE" ? "We bake only what is on the menu." : `Yes, please send ${owner} a message first. Custom requests are agreed by hand before anything is booked.`,
  });
  return out;
}

/** Section 9: a compact FAQ with native details/summary, so it works without any script. */
export function faq(policy: BusinessPolicy): SafeHtml {
  return html`<section class="faq" aria-labelledby="faq-h">
    <div class="wrap faq__wrap">
      <header class="section-head">
        <p class="eyebrow">Good to know</p>
        <h2 id="faq-h">Questions, answered</h2>
        ${wave()}
      </header>
      <div class="faq__list">${faqs(policy).map((f) => html`<details class="faq__item"><summary>${f.q}</summary><p>${f.a}</p></details>`)}</div>
    </div>
  </section>`;
}
