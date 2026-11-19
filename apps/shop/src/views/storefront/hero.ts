import type { BusinessPolicy } from "@agentdoor/core";
import { html, icon, type SafeHtml } from "@agentdoor/ui";
import { spanOfHours } from "../format.js";
import { sprig } from "./ornaments.js";
import { HERO_PHOTO, photoImg } from "./photos.js";

/** Facts for the hero chips, all read from the policy so a changed rule changes the page. */
function chips(policy: BusinessPolicy): string[] {
  const hasEggless = policy.catalog.some((i) => i.dietary.includes("eggless"));
  return [
    "Baked to order",
    ...(hasEggless ? ["Eggless options"] : []),
    `Order ${spanOfHours(policy.schedule.minLeadHours)} ahead`,
  ];
}

export function hero(policy: BusinessPolicy): SafeHtml {
  const { business } = policy;
  return html`<section class="hero" aria-labelledby="hero-h">
    <div class="wrap hero__grid">
      <div class="hero__text">
        <p class="eyebrow">${business.city} · home-baked to order</p>
        <h1 id="hero-h" class="hero__title">Home-baked cakes for the <em>moments</em> that matter</h1>
        <p class="hero__lead">Small-batch cakes, brownies and cookie boxes, baked to order in a home kitchen in ${business.city}. Choose your day and ${business.ownerFirstName} will quote you an exact price.</p>
        <p class="hero__cta">
          <a class="btn btn--primary btn--lg" href="/order">Order a cake <span aria-hidden="true">→</span></a>
          <a class="btn btn--quiet btn--lg" href="#menu">See what's baking</a>
        </p>
        <ul class="hero__chips" aria-label="Good to know">${chips(policy).map((c) => html`<li>${icon("check")}<span>${c}</span></li>`)}</ul>
      </div>
      <figure class="hero__frame">
        <div class="hero__photo">${photoImg(HERO_PHOTO, { hero: true, className: "photo photo--hero" })}</div>
        <span class="hero__sprig">${sprig()}</span>
      </figure>
    </div>
  </section>`;
}
