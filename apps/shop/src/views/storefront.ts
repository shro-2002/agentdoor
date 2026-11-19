import { html } from "@agentdoor/ui";
import type { LaunchState } from "../db/launch-state.js";
import { hoursLine } from "./format.js";
import { layout, type ShopIdentity } from "./layout.js";
import { hero } from "./storefront/hero.js";
import { delivery, faq, howItWorks } from "./storefront/info.js";
import { collection } from "./storefront/products.js";
import { custom, kitchen, occasions } from "./storefront/story.js";

export const NOT_LAUNCHED_BANNER = "Not launched: this shop isn't taking orders yet.";

export const identityOf = (launch: LaunchState): ShopIdentity | undefined =>
  launch.launched
    ? {
        name: launch.policy.business.name,
        hours: hoursLine(launch.policy),
        ownerFirstName: launch.policy.business.ownerFirstName,
        city: launch.policy.business.city,
        areas: launch.policy.fulfilment.delivery.enabled ? launch.policy.fulfilment.delivery.areas.map((a) => a.name) : [],
      }
    : undefined;

/** The policy has no tagline field, so the short line is fixed: "<Shop name> · Order online". */
export const HOME_TAGLINE = "Order online";
export const homeTitle = (shopName: string, tagline: string = HOME_TAGLINE): string => `${shopName} · ${tagline}`;

export const bannerFor = (launch: LaunchState): string | undefined => (launch.launched ? undefined : NOT_LAUNCHED_BANNER);

/** The ten homepage sections, in order: hero, collection and products, kitchen, occasions, custom, how, delivery, FAQ (header and footer come from the layout). */
export function storefrontPage(launch: LaunchState): string {
  if (!launch.launched) {
    const body = html`<section class="notopen"><div class="wrap">
      <h1 class="notopen__title">This shop isn't open yet</h1>
      <p class="notopen__lead">Its rules haven't been checked and signed, so it cannot take orders. Come back soon.</p>
    </div></section>`;
    return layout({ title: "Not open yet", body, banner: NOT_LAUNCHED_BANNER });
  }
  const { policy } = launch;
  const body = html`${hero(policy)}${collection(policy)}${kitchen(policy)}${occasions()}${custom(policy)}${howItWorks(policy)}${delivery(policy)}${faq(policy)}`;
  return layout({
    title: homeTitle(policy.business.name),
    fullTitle: true,
    body,
    shop: identityOf(launch),
    description: `${policy.business.name} in ${policy.business.city}: home-baked cakes, brownies and cookie boxes, made to order with fixed prices.`,
  });
}
