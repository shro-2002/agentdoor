import { html, icon, type SafeHtml } from "@agentdoor/ui";
import { agentDoorFooter, agentDoorHeader, type AgentDoorNav } from "./chrome/agentdoor.js";
import { bakeryFooter, bakeryHeader, type BakeryNav } from "./chrome/bakery.js";
import { ownerFooter, ownerHeader, ownerRibbon } from "./chrome/owner.js";
import type { ShopIdentity } from "./chrome/shared.js";
import { personaNote } from "./persona.js";
import { REPO_URL, getOwnerContact } from "./site.js";

export { contactLink, type ShopIdentity } from "./chrome/shared.js";

/**
 * Three looks share one shell: the bakery storefront, the AgentDoor platform pages (/launch, /try,
 * /launch-report) and the private owner pages, which keep their original chrome.
 */
export type Chrome = "bakery" | "agentdoor" | "owner";
export type NavKey = BakeryNav | AgentDoorNav;

export interface LayoutOptions {
  title: string;
  body: SafeHtml;
  /** The shop-isn't-open banner (chili, top of page). */
  banner?: string;
  shop?: ShopIdentity;
  /** Overrides the address from site settings (tests); empty shows no address. */
  contactEmail?: string;
  /** Overrides REPO_URL (tests). */
  repoUrl?: string;
  /** The home page: `title` is already the whole <title>. */
  fullTitle?: boolean;
  active?: NavKey;
  chrome?: Chrome;
  /** AgentDoor pages only: replaces the header (the /try pages bring their own step navigation). */
  nav?: SafeHtml;
  description?: string;
  /** AgentDoor pages: extra stylesheets under /assets for just that page (each page loads only what it needs). */
  styles?: string[];
  /** Script files under /assets (never inline: strict CSP). */
  scripts?: string[];
  bodyClass?: string;
  /** A workspace preview of a draft shop: this bar on top, no persona note, no contact address. */
  preview?: SafeHtml;
}

const DEFAULT_SHOP: ShopIdentity = { name: "The shop" };
const PLATFORM_NAME = "AgentDoor";

const FONT_CSS = {
  bakery: "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..600&family=Nunito+Sans:wght@400;600;700&display=swap",
  agentdoor: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap",
};

/** Each page loads one look only, so every page stays far under the CSS budget. */
function styles(chrome: Chrome, extra: string[] = []): SafeHtml {
  if (chrome === "owner") {
    return html`<link rel="stylesheet" href="/assets/tokens.css"><link rel="stylesheet" href="/assets/ui.css"><link rel="stylesheet" href="/assets/shop.css">`;
  }
  const more = extra.map((f) => html`<link rel="stylesheet" href="/assets/${f}">`);
  const own =
    chrome === "bakery"
      ? html`<link rel="stylesheet" href="/assets/bakery.css">${more}`
      : html`<link rel="stylesheet" href="/assets/ui.css"><link rel="stylesheet" href="/assets/agentdoor.css">${more}`;
  return html`<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONT_CSS[chrome]}">${own}`;
}

/** A page title never repeats the shop name: the shop name is appended only when the title does not already hold it. */
export function pageTitle(title: string, shopName: string | null, fullTitle = false): string {
  if (fullTitle || !shopName || title === shopName || title.includes(shopName)) return title;
  return `${title} · ${shopName}`;
}

const defaultDescription = (chrome: Chrome, shop: ShopIdentity): string =>
  chrome === "agentdoor" ? "AgentDoor rehearses a business before its first customer arrives." : `${shop.name}: order home-baked goods with prices and rules set by the owner.`;

interface Parts {
  head: SafeHtml;
  foot: SafeHtml;
  /** Above everything else: only the owner pages carry the original ribbon. */
  top: SafeHtml;
}

function parts(o: LayoutOptions, chrome: Chrome, shop: ShopIdentity): Parts {
  const email = o.contactEmail ?? getOwnerContact();
  const repoUrl = o.repoUrl ?? REPO_URL;
  if (chrome === "agentdoor") {
    const head = o.nav ? html`${o.nav}<div class="wrap">${personaNote()}</div>` : agentDoorHeader(o.active as AgentDoorNav | undefined);
    return { head, foot: agentDoorFooter(repoUrl), top: html`` };
  }
  if (chrome === "owner") return { head: ownerHeader(shop), foot: ownerFooter(shop, email, repoUrl), top: ownerRibbon };
  const preview = o.preview !== undefined;
  return { head: bakeryHeader(shop, o.active as BakeryNav | undefined), foot: bakeryFooter(shop, preview ? "" : email, !preview), top: o.preview ?? html`` };
}

/** The page shell: no inline script or style anywhere, so the strict CSP holds. */
export function layout(o: LayoutOptions): string {
  const shop = o.shop ?? DEFAULT_SHOP;
  const chrome = o.chrome ?? "bakery";
  const { head, foot, top } = parts(o, chrome, shop);
  const shopName = chrome === "agentdoor" ? PLATFORM_NAME : shop === DEFAULT_SHOP ? null : shop.name;
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle(o.title, shopName, o.fullTitle)}</title>
<meta name="description" content="${o.description ?? defaultDescription(chrome, shop)}">
<meta name="color-scheme" content="light">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
${styles(chrome, o.styles)}
</head>
<body class="${[`look-${chrome}`, o.bodyClass].filter(Boolean).join(" ")}">
<a class="skip" href="#main">Skip to the content</a>
${top}
${o.banner ? html`<p class="banner-closed" role="alert">${icon("alert")}<strong>${o.banner}</strong></p>` : ""}
${head}
<main id="main" tabindex="-1">
${o.body}
</main>
${foot}
${(o.scripts ?? []).map((s) => html`<script src="/assets/${s}" defer></script>`)}
</body>
</html>`.value;
}
