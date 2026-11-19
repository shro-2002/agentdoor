import type { LaunchState } from "../db/launch-state.js";
import type { ContactMessage, DashboardOrder } from "../db/queries.js";
import type { BusinessView } from "../services/business-view.js";
import { html, layout, type Safe } from "./html.js";

const PAISE_PER_RUPEE = 100;
const NOT_LAUNCHED_BANNER = "Not launched: this shop cannot take orders until its rules are verified.";

/** Whole rupees show as "600", others as "600.50". */
export const inr = (paise: number): string =>
  `₹${Number.isInteger(paise / PAISE_PER_RUPEE) ? paise / PAISE_PER_RUPEE : (paise / PAISE_PER_RUPEE).toFixed(2)}`;

const bannerFor = (launch: LaunchState): string | undefined => (launch.launched ? undefined : NOT_LAUNCHED_BANNER);

const nav = html`<nav><a href="/">Menu</a> · <a href="/launch-report">Launch report</a> · <a href="/contact">Contact</a></nav>`;

export function storefrontPage(launch: LaunchState, view: BusinessView | null): string {
  const body = view
    ? html`<h1>${view.name}</h1>
${nav}
<p>${view.city}. Prices are fixed. Agents can order through <code>/mcp</code>.</p>
<h2>Menu</h2>
<ul>${view.catalog.map((i) => html`<li>${i.name.en} — ${inr(i.pricePaise)} per ${i.unit} (id <code>${i.id}</code>)</li>`)}</ul>
<h2>Delivery</h2>
<ul>${view.delivery.areas.map((a) => html`<li>${a.name}: ${inr(a.feePaise)}</li>`)}</ul>
<p>Minimum order ${inr(view.rules.minOrderPaise)}. Quotes are valid for ${view.rules.quoteValidityMinutes} minutes.</p>`
    : html`<h1>Shop</h1>${nav}<p>This shop is not available yet.</p>`;
  return layout({ title: view?.name ?? "Shop", body, banner: bannerFor(launch) });
}

export function launchReportPage(launch: LaunchState): string {
  const body = launch.launched
    ? html`<h1>Launch report</h1>${nav}
<dl>
<dt>Shop</dt><dd>${launch.record.shop}</dd>
<dt>Policy hash</dt><dd><code>${launch.policyHash}</code></dd>
<dt>Policy version</dt><dd>${launch.record.policyVersion}</dd>
<dt>Rehearsal</dt><dd>${launch.record.rehearsal.passed} of ${launch.record.rehearsal.probes + launch.record.rehearsal.scenarios} checks passed, ${launch.record.rehearsal.criticalOpen} critical gaps open</dd>
<dt>Rules approved</dt><dd>${launch.record.approvals.approved} of ${launch.record.approvals.required}</dd>
<dt>Signed</dt><dd>${launch.record.signedAt}</dd>
</dl>`
    : html`<h1>Launch report</h1>${nav}<p>Not launched. Reason: ${launch.reason}</p>`;
  return layout({ title: "Launch report", body, banner: bannerFor(launch) });
}

export interface OrderPageData {
  orderId: string;
  status: string;
  fulfilDate: string;
  totalPaise: number;
  lines: { itemId: string; qty: number }[];
}

const STATUS_TEXT: Record<string, string> = {
  PENDING_OWNER: "Waiting for the owner to confirm",
  CONFIRMED: "Confirmed by the owner",
  DECLINED: "Declined by the owner",
  CANCELLED: "Cancelled",
};

export function orderStatusPage(o: OrderPageData): string {
  const body = html`<h1>Order ${o.orderId}</h1>${nav}
<p>${STATUS_TEXT[o.status] ?? o.status}</p>
<p>For ${o.fulfilDate}. Total ${inr(o.totalPaise)}.</p>
<ul>${o.lines.map((l) => html`<li>${l.qty} × ${l.itemId}</li>`)}</ul>`;
  return layout({ title: "Order status", body });
}

export function loginPage(error?: string): string {
  const body = html`<h1>Owner sign in</h1>
${error ? html`<p role="alert">${error}</p>` : ""}
<form method="post" action="/owner/login">
<label>Owner token <input type="password" name="token" autocomplete="current-password" required></label>
<button type="submit">Sign in</button>
</form>`;
  return layout({ title: "Owner sign in", body });
}

const TRANSITIONS: Record<string, { to: string; label: string }[]> = {
  PENDING_OWNER: [
    { to: "CONFIRMED", label: "Confirm" },
    { to: "DECLINED", label: "Decline" },
  ],
  CONFIRMED: [{ to: "CANCELLED", label: "Cancel" }],
};

function orderRow(o: DashboardOrder): Safe {
  const actions = (TRANSITIONS[o.status] ?? []).map(
    (t) => html`<form method="post" action="/owner/orders/${o.id}/transition">
<input type="hidden" name="to" value="${t.to}"><button type="submit">${t.label}</button></form>`,
  );
  return html`<li>
<strong>${o.id}</strong> · ${o.status} · for ${o.fulfilDate} · ${inr(o.totalPaise)} · via ${o.channel}<br>
${o.customerName}, ${o.customerPhone}${o.deliveryAddress ? html`, ${o.deliveryAddress}` : ""}<br>
${o.notes ? html`Notes: ${o.notes}` : ""}
${actions}
</li>`;
}

export function dashboardPage(orders: DashboardOrder[], contacts: ContactMessage[]): string {
  const body = html`<h1>Owner dashboard</h1>
<form method="post" action="/owner/logout"><button type="submit">Sign out</button></form>
<h2>Orders</h2>
${orders.length === 0 ? html`<p>No orders yet.</p>` : html`<ul>${orders.map(orderRow)}</ul>`}
<h2>Contact messages</h2>
${contacts.length === 0
  ? html`<p>No messages.</p>`
  : html`<ul>${contacts.map((c) => html`<li>${c.createdAt} · ${c.name} &lt;${c.email}&gt; · email ${c.emailStatus}<br>${c.message}</li>`)}</ul>`}`;
  return layout({ title: "Owner dashboard", body });
}

export type ContactNotice = "sent" | "saved" | null;

export function contactPage(notice: ContactNotice): string {
  const message =
    notice === "sent"
      ? html`<p role="status">Thank you. Your message was sent.</p>`
      : notice === "saved"
        ? html`<p role="status">We saved your message but could not email it just now. The owner will still see it.</p>`
        : "";
  const body = html`<h1>Contact</h1>${nav}${message}
<form method="post" action="/contact">
<label>Name <input name="name" maxlength="60" required></label>
<label>Email <input type="email" name="email" maxlength="120" required></label>
<label>Message <textarea name="message" maxlength="2000" required></textarea></label>
<div hidden><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>
<button type="submit">Send</button>
</form>`;
  return layout({ title: "Contact", body });
}
