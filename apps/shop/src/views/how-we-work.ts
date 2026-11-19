import { UNBOUNDED_CAPACITY, type BusinessPolicy } from "@agentdoor/core";
import { html, icon, type SafeHtml } from "@agentdoor/ui";
import { ownerQuoteFor } from "../services/figures.js";
import { WEEKDAYS, UNIT_WORD, areaFee, inr, isoDay, listWords, rushFee, spanOfHours } from "./format.js";
import { wave } from "./storefront/ornaments.js";
import { ownerName } from "./storefront/words.js";
import type { Trust } from "./trust.js";

/** One rule in plain words, and the policy path whose provenance holds the owner's own words for it. */
interface RuleLine {
  text: string;
  path: string;
}

interface RuleGroup {
  id: string;
  title: string;
  lines: RuleLine[];
}

function priceLines(policy: BusinessPolicy): RuleLine[] {
  const prices = policy.catalog.map((c) => ({ text: `${c.name.en}: ${inr(c.unitPricePaise)} ${UNIT_WORD[c.unit]?.per ?? c.unit}.`, path: `catalog[${c.id}].unitPricePaise` }));
  const min = policy.orderRules.minOrderPaise;
  return min > 0 ? [...prices, { text: `Minimum order ${inr(min)}, before delivery.`, path: "orderRules.minOrderPaise" }] : prices;
}

function deliveryLines(policy: BusinessPolicy): RuleLine[] {
  const { pickup, delivery } = policy.fulfilment;
  const lines: RuleLine[] = [];
  if (pickup.enabled) lines.push({ text: pickup.areaLabel ? `Pickup from ${pickup.areaLabel} is free.` : "Pickup is free.", path: "fulfilment.pickup.enabled" });
  if (!delivery.enabled) return [...lines, { text: "Delivery is not offered.", path: "fulfilment.delivery.enabled" }];
  const areas = delivery.areas.map((a) => ({ text: `Delivery to ${a.name}: ${areaFee(a.feePaise).toLowerCase()}.`, path: `fulfilment.delivery.areas[${a.id}].feePaise` }));
  const other = delivery.unlistedArea === "REFUSE" ? "Areas that are not listed are not served." : "For an area that is not listed, the owner decides by hand first.";
  return [...lines, ...areas, { text: other, path: "fulfilment.delivery.unlistedArea" }];
}

function timingLines(policy: BusinessPolicy): RuleLine[] {
  const { schedule, rush } = policy;
  const rushText = rush
    ? `Orders wanted within ${spanOfHours(rush.withinHours)} are rush orders: a rush charge of ${rushFee(rush)}, and at most ${rush.maxRushUnitsPerDay} rush units a day.`
    : "There are no rush orders: nothing is taken inside the notice period.";
  return [
    { text: `Orders need at least ${spanOfHours(schedule.minLeadHours)} of notice, and can be placed up to ${schedule.maxAdvanceDays} days ahead.`, path: "schedule.minLeadHours" },
    { text: rushText, path: "rush" },
  ];
}

function limitLines(policy: BusinessPolicy): RuleLine[] {
  const { capacity, schedule, cancellation } = policy;
  const closed = schedule.closedWeekdays.map((d) => `${WEEKDAYS[d]}s`);
  const limit = capacity.unitsPerDay >= UNBOUNDED_CAPACITY ? "No daily limit has been set." : `At most ${capacity.unitsPerDay} units are baked a day. When a day is full, further orders for it are refused.`;
  return [
    { text: limit, path: "capacity.unitsPerDay" },
    { text: closed.length > 0 ? `Closed on ${listWords(closed)}.` : "Open every day.", path: "schedule.closedWeekdays" },
    { text: cancellation.note.en || `Free cancellation up to ${spanOfHours(cancellation.freeCancelHours)} before.`, path: "cancellation.freeCancelHours" },
  ];
}

function groups(policy: BusinessPolicy): RuleGroup[] {
  return [
    { id: "prices", title: "Prices", lines: priceLines(policy) },
    { id: "delivery", title: "Delivery and pickup", lines: deliveryLines(policy) },
    { id: "timing", title: "Notice and rush orders", lines: timingLines(policy) },
    { id: "limits", title: "Daily limit, closed days and cancellation", lines: limitLines(policy) },
  ];
}

/** The owner's quoted words where the rule was stated; otherwise only what the record says about its approval. */
function provenance(policy: BusinessPolicy, path: string): SafeHtml {
  const prov = policy.provenance[path];
  if (!prov) return html``;
  const quote = ownerQuoteFor(path, prov);
  if (quote) return html`<blockquote class="rule-line__quote"><p>“${quote}”</p><footer>In the owner's own words</footer></blockquote>`;
  return html`<p class="rule-line__source">${prov.status === "approved" ? "Approved by the owner. No spoken quote is on record for this rule." : "A suggested starting point, not yet confirmed by the owner."}</p>`;
}

function verifiedNote(trust: Trust): SafeHtml {
  if (trust.kind === "preview") {
    return html`<p>${trust.rehearsed ? `This is a preview of a draft. Its rules passed ${trust.checks} checks, and the owner has not published it yet.` : "This is a preview of a draft that has not been rehearsed yet."} Nothing here is signed.</p>`;
  }
  return html`<p>These rules match policy fingerprint <code class="mono">${trust.hashPrefix}</code>. That fingerprint is in the launch record, which was signed with this shop's own key. The signature was checked when the shop started; if it had not matched, the shop would not take orders.</p>
    <p>Before launch the rules were rehearsed with ${trust.checks} checks (version ${trust.policyVersion}, signed ${isoDay(trust.signedAt)}), no serious issue was left open, and the owner approved ${trust.approved} of ${trust.required} required rules.</p>`;
}

/** /how-we-work: every rule the shop enforces, in plain words, with the owner's quoted words and what was verified. */
export function howWeWorkBody(policy: BusinessPolicy, trust: Trust): SafeHtml {
  return html`<section class="how-we-work">
    <div class="wrap narrow">
      <header class="section-head">
        <p class="eyebrow">How we work</p>
        <h1 class="page-title">The rules this shop follows</h1>
        <p class="section-head__lead">${policy.business.name} was rehearsed before its first customer. These are the rules it keeps for every order, in plain words, each with ${ownerName(policy)}'s own words where they were said.</p>
        ${wave()}
      </header>
      ${groups(policy).map((g) => html`<section class="rule-group" aria-labelledby="rg-${g.id}"><h2 id="rg-${g.id}">${g.title}</h2><ul class="rule-lines">${g.lines.map((l) => html`<li class="rule-line"><p class="rule-line__text">${l.text}</p>${provenance(policy, l.path)}</li>`)}</ul></section>`)}
      <section class="verified" aria-labelledby="verified-h"><h2 id="verified-h">${icon("check")}Verified</h2>${verifiedNote(trust)}</section>
    </div>
  </section>`;
}
