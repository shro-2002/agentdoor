import type { BusinessPolicy } from "@agentdoor/core";
import { html, type SafeHtml } from "@agentdoor/ui";
import type { LaunchState } from "../db/launch-state.js";
import { hoursLine } from "./format.js";
import { layout, type ShopIdentity } from "./layout.js";
import { howWeWorkBody } from "./how-we-work.js";
import { hero } from "./storefront/hero.js";
import { delivery, faq, howItWorks } from "./storefront/info.js";
import { collection } from "./storefront/products.js";
import { custom, kitchen, occasions } from "./storefront/story.js";
import { HOW_WE_WORK_PATH, trustBadge, trustOfLaunch, type Trust } from "./trust.js";

export const NOT_LAUNCHED_BANNER = "Not launched: this shop isn't taking orders yet.";

export const identityOfPolicy = (policy: BusinessPolicy, rulesHref?: string): ShopIdentity => ({
  ...(rulesHref ? { rulesHref } : {}),
  name: policy.business.name,
  hours: hoursLine(policy),
  ownerFirstName: policy.business.ownerFirstName,
  city: policy.business.city,
  areas: policy.fulfilment.delivery.enabled ? policy.fulfilment.delivery.areas.map((a) => a.name) : [],
});

export const identityOf = (launch: LaunchState): ShopIdentity | undefined => (launch.launched ? identityOfPolicy(launch.policy, HOW_WE_WORK_PATH) : undefined);

/** The policy has no tagline field, so the short line is fixed: "<Shop name> · Order online". */
export const HOME_TAGLINE = "Order online";
export const homeTitle = (shopName: string, tagline: string = HOME_TAGLINE): string => `${shopName} · ${tagline}`;

export const bannerFor = (launch: LaunchState): string | undefined => (launch.launched ? undefined : NOT_LAUNCHED_BANNER);

const homePage = (policy: BusinessPolicy, badge: SafeHtml): SafeHtml =>
  html`${hero(policy, badge)}${collection(policy)}${kitchen(policy)}${occasions()}${custom(policy)}${howItWorks(policy)}${delivery(policy)}${faq(policy)}`;

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
  const body = homePage(policy, trustBadge(trustOfLaunch(launch), HOW_WE_WORK_PATH));
  return layout({
    title: homeTitle(policy.business.name),
    fullTitle: true,
    body,
    shop: identityOf(launch),
    description: `${policy.business.name} in ${policy.business.city}: home-baked cakes, brownies and cookie boxes, made to order with fixed prices.`,
  });
}

/** /how-we-work for the live shop: the rules in plain words and what was verified. Null until the shop is launched. */
export function howWeWorkPage(launch: LaunchState): string | null {
  const trust = trustOfLaunch(launch);
  if (!launch.launched || !trust) return null;
  return layout({
    title: "How we work",
    body: howWeWorkBody(launch.policy, trust),
    shop: identityOf(launch),
    description: `The rules ${launch.policy.business.name} follows for every order, in plain words, and how they were checked.`,
  });
}

const PREVIEW_OFF = "Preview: orders are off";
const ORDER_LINK = /<a\b([^>]*?)\shref="\/(?:order|contact)(?:\?[^"]*)?"([^>]*)>([\s\S]*?)<\/a>/g;

/** Ordering links become inert, so a draft can never lead a visitor into the live shop's order form. */
function inert(attrs: string): string {
  const withClass = /\sclass="([^"]*)"/.test(attrs) ? attrs.replace(/\sclass="([^"]*)"/, ' class="$1 is-off"') : `${attrs} class="is-off"`;
  return `${withClass} aria-disabled="true" title="${PREVIEW_OFF}"`;
}

/** A draft that has not passed its gate says so in the bar; one that has shows the badge in the hero instead. */
function previewBar(trust: Trust): SafeHtml {
  const chip = trust.kind === "preview" && !trust.rehearsed ? html`<span class="pvbar__chip">Not yet rehearsed</span>` : html``;
  return html`<div class="pvbar" role="status"><span class="pvbar__tag">Preview</span><span>${PREVIEW_OFF}</span>${chip}<span class="pvbar__more">This is a draft of your storefront, not a live website.</span></div>`;
}

interface PreviewParts {
  fullTitle: boolean;
  title: string;
  body: SafeHtml;
  description: string;
  policy: BusinessPolicy;
  previewPath: string;
  trust: Trust;
  /** In-page "/#section" links point here: nothing for the home page itself, the preview's address elsewhere. */
  anchorBase: string;
}

/** A draft page drawn by the live renderer and then made read-only: order links disabled, links kept on the preview. */
function previewPage(o: PreviewParts): string {
  const page = layout({
    title: o.title,
    fullTitle: o.fullTitle,
    body: o.body,
    shop: identityOfPolicy(o.policy, `${o.previewPath}/how-we-work`),
    description: o.description,
    preview: previewBar(o.trust),
    styles: ["workspace-preview.css"],
    bodyClass: "is-preview",
  });
  return page
    .replace(ORDER_LINK, (_m, a: string, b: string, inner: string) => `<span${inert(`${a}${b}`)}>${inner}</span>`)
    .replace(/href="\/#/g, `href="${o.anchorBase}#`)
    .replace(/href="\/"/g, `href="${o.previewPath}"`)
    .replace("<head>", '<head>\n<meta name="robots" content="noindex">');
}

/** The draft's own storefront. The "Rehearsed" badge appears only when the draft's gate passes. */
export function previewStorefrontPage(policy: BusinessPolicy, previewPath: string, trust: Trust): string {
  return previewPage({
    fullTitle: true,
    title: homeTitle(policy.business.name),
    body: homePage(policy, trustBadge(trust, `${previewPath}/how-we-work`)),
    description: `Preview of ${policy.business.name}.`,
    policy,
    previewPath,
    trust,
    anchorBase: "",
  });
}

export function previewHowWeWorkPage(policy: BusinessPolicy, previewPath: string, trust: Trust): string {
  return previewPage({ fullTitle: false, title: "How we work", body: howWeWorkBody(policy, trust), description: `Preview of the rules ${policy.business.name} follows.`, policy, previewPath, trust, anchorBase: previewPath });
}
