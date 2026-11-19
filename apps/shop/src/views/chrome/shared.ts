import { html, type SafeHtml } from "@agentdoor/ui";

export interface ShopIdentity {
  name: string;
  /** One plain line for the footer, e.g. "Closed on Mondays". */
  hours?: string;
  ownerFirstName?: string;
  city?: string;
  /** Delivery areas by name, for the footer's "where we deliver" line. */
  areas?: string[];
}

/** Only a plain mailbox is linked: anything else shows nothing rather than a broken mailto. */
export const MAILBOX = /^[^\s<>"'@]+@[^\s<>"'@]+\.[^\s<>"'@]+$/;
export const contactLink = (email: string): SafeHtml => (MAILBOX.test(email) ? html`<a href="mailto:${email}">${email}</a>` : html``);

export const PEXELS_URL = "https://www.pexels.com";
