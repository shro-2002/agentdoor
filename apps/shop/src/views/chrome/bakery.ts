import { html, raw, type SafeHtml } from "@agentdoor/ui";
import { personaNote } from "../persona.js";
import { brandMark } from "../storefront/ornaments.js";
import { MAILBOX, PEXELS_URL, contactLink, type ShopIdentity } from "./shared.js";

/** Pages that highlight their own entry in the header. */
export type BakeryNav = "order" | "contact";

const NAV: { href: string; label: string; key?: BakeryNav }[] = [
  { href: "/#menu", label: "Cakes and bakes" },
  { href: "/#occasions", label: "Occasions" },
  { href: "/#how", label: "How to order" },
  { href: "/contact", label: "Contact", key: "contact" },
];

const current = (on: boolean): SafeHtml => (on ? raw(' aria-current="page"') : raw(""));

export function bakeryHeader(shop: ShopIdentity, active: BakeryNav | undefined): SafeHtml {
  return html`<header class="head">
    <div class="wrap head__row">
      <a class="brand" href="/">${brandMark()}<span class="brand__name">${shop.name}</span></a>
      <nav class="nav" aria-label="Main">
        <ul>${NAV.map((n) => html`<li><a href="${n.href}"${current(n.key !== undefined && n.key === active)}>${n.label}</a></li>`)}</ul>
      </nav>
      <a class="btn btn--primary head__order" href="/order"${current(active === "order")}>Order</a>
    </div>
  </header>`;
}

/** "Pune: delivering to Baner, Aundh." built only from what the policy lists. */
function whereLine(shop: ShopIdentity): string {
  const areas = shop.areas ?? [];
  if (areas.length === 0) return shop.city ?? "";
  return `${shop.city ? `${shop.city}: delivering` : "Delivering"} to ${areas.join(", ")}.`;
}

export function bakeryFooter(shop: ShopIdentity, email: string, showPersona = true): SafeHtml {
  const owner = shop.ownerFirstName ?? "the owner";
  return html`<footer class="foot">
    <div class="wrap foot__grid">
      <div>
        <p class="foot__name">${shop.name}</p>
        <p>Home-baked to order${shop.city ? html` in ${shop.city}` : ""}, in small batches.</p>
        ${shop.hours ? html`<p>${shop.hours}</p>` : ""}
      </div>
      <nav class="foot__col" aria-label="Footer">
        <p class="foot__head">Say hello</p>
        <p><a href="/contact">Contact ${owner}</a></p>
        ${MAILBOX.test(email) ? html`<p>${contactLink(email)}</p>` : ""}
        <p><a href="/order">Place an order</a></p>
        ${shop.rulesHref ? html`<p><a href="${shop.rulesHref}">How we work</a></p>` : ""}
      </nav>
      <div class="foot__col">
        <p class="foot__head">Where we are</p>
        <p>${whereLine(shop)}</p>
        <p>Details are under <a href="/#delivery">delivery and pickup</a>.</p>
      </div>
    </div>
    <div class="wrap foot__legal">
      ${showPersona ? personaNote() : ""}
      <p class="foot__small">Photos: <a href="${PEXELS_URL}" rel="noopener">Pexels</a> · Powered by <a href="/launch">AgentDoor</a></p>
    </div>
  </footer>`;
}
