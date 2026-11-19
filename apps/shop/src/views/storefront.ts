import type { BusinessPolicy } from "@agentdoor/core";
import { html } from "@agentdoor/ui";
import type { LaunchState } from "../db/launch-state.js";
import { hoursLine } from "./format.js";
import { layout, type ShopIdentity } from "./layout.js";
import { hero } from "./storefront/hero.js";
import { delivery, faq, howItWorks } from "./storefront/info.js";
import { collection } from "./storefront/products.js";
import { custom, kitchen, occasions } from "./storefront/story.js";

export const NOT_LAUNCHED_BANNER = "Not launched: this shop isn't taking orders yet.";

export const identityOfPolicy = (policy: BusinessPolicy): ShopIdentity => ({
  name: policy.business.name,
  hours: hoursLine(policy),
  ownerFirstName: policy.business.ownerFirstName,
  city: policy.business.city,
  areas: policy.fulfilment.delivery.enabled ? policy.fulfilment.delivery.areas.map((a) => a.name) : [],
});

export const identityOf = (launch: LaunchState): ShopIdentity | undefined => (launch.launched ? identityOfPolicy(launch.policy) : undefined);

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

const PREVIEW_OFF = "Preview: orders are off";
const ORDER_LINK = /<a\b([^>]*?)\shref="\/(?:order|contact)(?:\?[^"]*)?"([^>]*)>([\s\S]*?)<\/a>/g;

/** Ordering links become inert, so a draft can never lead a visitor into the live shop's order form. */
function inert(attrs: string): string {
  const withClass = /\sclass="([^"]*)"/.test(attrs) ? attrs.replace(/\sclass="([^"]*)"/, ' class="$1 is-off"') : `${attrs} class="is-off"`;
  return `${withClass} aria-disabled="true" title="${PREVIEW_OFF}"`;
}

/**
 * The draft's own storefront, drawn by the same renderer as the live shop and then made read-only:
 * order and contact links are disabled and in-page links stay on the preview, never the live site.
 */
export function previewStorefrontPage(policy: BusinessPolicy, previewPath: string): string {
  const body = html`${hero(policy)}${collection(policy)}${kitchen(policy)}${occasions()}${custom(policy)}${howItWorks(policy)}${delivery(policy)}${faq(policy)}`;
  const bar = html`<div class="pvbar" role="status"><span class="pvbar__tag">Preview</span><span>${PREVIEW_OFF}</span><span class="pvbar__more">This is a draft of your storefront, not a live website.</span></div>`;
  const page = layout({
    title: homeTitle(policy.business.name),
    fullTitle: true,
    body,
    shop: identityOfPolicy(policy),
    description: `Preview of ${policy.business.name}.`,
    preview: bar,
    styles: ["workspace-preview.css"],
    bodyClass: "is-preview",
  });
  return page
    .replace(ORDER_LINK, (_m, a: string, b: string, inner: string) => `<span${inert(`${a}${b}`)}>${inner}</span>`)
    .replace(/href="\/#/g, 'href="#')
    .replace(/href="\/"/g, `href="${previewPath}"`)
    .replace("<head>", '<head>\n<meta name="robots" content="noindex">');
}
