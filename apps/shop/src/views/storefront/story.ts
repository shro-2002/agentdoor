import type { BusinessPolicy } from "@agentdoor/core";
import { html, type SafeHtml } from "@agentdoor/ui";
import { spanOfHours } from "../format.js";
import { sprig, wave } from "./ornaments.js";
import { KITCHEN_PHOTOS, OCCASION_PHOTOS, photoImg } from "./photos.js";

/** Section 4: a warm, generic introduction. It says only what the policy backs up: home kitchen, to order, small batches. */
export function kitchen(policy: BusinessPolicy): SafeHtml {
  const { business, schedule } = policy;
  const [flour, hands] = KITCHEN_PHOTOS;
  return html`<section class="kitchen" aria-labelledby="kitchen-h">
    <div class="wrap kitchen__grid">
      <div class="kitchen__photos">
        <div class="kitchen__a">${photoImg(flour!, { className: "photo" })}</div>
        <div class="kitchen__b">${photoImg(hands!, { className: "photo" })}</div>
      </div>
      <div class="kitchen__text">
        <p class="eyebrow">From our kitchen</p>
        <h2 id="kitchen-h">Baked at home, one order at a time</h2>
        ${wave()}
        <p>Everything here is baked in a home kitchen in ${business.city}, and only after you order. Nothing sits on a shelf waiting for you.</p>
        <p>That is why we ask for ${spanOfHours(schedule.minLeadHours)} of notice and take a limited number of orders each day: every bake gets the time it deserves.</p>
        <ul class="kitchen__points">
          <li>Baked to order, never in advance</li>
          <li>Small batches, a limited number of orders a day</li>
          <li>${business.ownerFirstName} confirms every order by hand</li>
        </ul>
      </div>
    </div>
  </section>`;
}

const OCCASIONS = [
  { key: "birthday", title: "Birthdays", text: "A cake to gather around. Pick a favourite, tell us the day, and we will bake it fresh.", cta: "Order for a birthday" },
  { key: "anniversary", title: "Anniversaries", text: "Something sweet to share, whether it is a quiet evening for two or a full table.", cta: "Order for an anniversary" },
  { key: "gifting", title: "Gifting", text: "A box of brownies or cookies is easy to carry and lovely to hand over. Choose pickup or delivery.", cta: "Order a gift" },
] as const;

/** Section 5: three occasions, each a photo-led card that leads to the order page. */
export function occasions(): SafeHtml {
  return html`<section class="occasions" id="occasions" aria-labelledby="occasions-h">
    <div class="wrap">
      <header class="section-head">
        <p class="eyebrow">Occasions</p>
        <h2 id="occasions-h">Made for the days you remember</h2>
        ${wave()}
      </header>
      <ul class="occ-grid">${OCCASIONS.map((o) => html`<li class="occ occ--${o.key}">
        <article aria-labelledby="occ-${o.key}">
          <div class="occ__photo">${photoImg(OCCASION_PHOTOS[o.key], { className: "photo" })}</div>
          <div class="occ__body">
            <h3 id="occ-${o.key}">${o.title}</h3>
            <p>${o.text}</p>
            <p class="occ__cta"><a class="pcard__link" href="/order">${o.cta} <span aria-hidden="true">→</span></a></p>
          </div>
        </article>
      </li>`)}</ul>
    </div>
  </section>`;
}

/** Section 6: custom requests follow the policy: welcome (after the owner agrees) or menu only. */
export function custom(policy: BusinessPolicy): SafeHtml {
  const owner = policy.business.ownerFirstName;
  const open = policy.orderRules.customRequests !== "REFUSE";
  return html`<section class="custom" aria-labelledby="custom-h">
    <div class="wrap custom__card">
      <span class="custom__sprig">${sprig()}</span>
      <div>
        <h2 id="custom-h">${open ? "Dreaming of something special?" : "Questions before you order?"}</h2>
        <p>${open
          ? `Custom cakes and designs start with a message. Tell ${owner} what you have in mind, and ${owner} will let you know whether it can be done.`
          : `Everything we bake is on the menu above. If you are unsure about anything, send ${owner} a message.`}</p>
      </div>
      <a class="btn btn--primary btn--lg" href="/contact">${open ? "Ask about a custom cake" : "Send a message"}</a>
    </div>
  </section>`;
}
