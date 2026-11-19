import { html, icon, statusChip, type SafeHtml } from "@agentdoor/ui";
import type { LaunchState } from "../db/launch-state.js";
import type { ContactMessage, DashboardOrder } from "../db/queries.js";
import { inr, shortDate } from "./format.js";
import { layout } from "./layout.js";

/** Owner pages are private tools, not storefront: they keep the ribbon but not the shop header links to ordering. */

export function loginPage(error?: string): string {
  const body = html`<section class="wrap section login">
    <div class="login__card">
      <p class="eyebrow">Owner area</p>
      <h1 class="page-title">Sign in</h1>
      <p class="section__lead">Paste the owner token you were given when the shop was launched.</p>
      ${error ? html`<p class="alert alert--error" role="alert" id="login-error">${icon("alert")}<span>${error}</span></p>` : ""}
      <form method="post" action="/owner/login" class="order-form">
        <label class="label" for="token">Owner token</label>
        <input class="input mono" id="token" type="password" name="token" autocomplete="off" required ${error ? html`aria-invalid="true" aria-describedby="login-error"` : ""}>
        <p class="form-actions"><button type="submit" class="btn btn--primary btn--lg">${icon("lock")}Sign in</button></p>
      </form>
      <p class="hint">Customers never see this page. Too many wrong tries pause sign-in for a while.</p>
    </div>
  </section>`;
  return layout({ title: "Owner sign in", body });
}

/* ---------- dashboard ---------- */

export type OwnerTab = "pending" | "confirmed" | "all";
const TABS: { id: OwnerTab; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "confirmed", label: "Confirmed" },
  { id: "all", label: "All" },
];

const STATUS_CHIP: Record<string, SafeHtml> = {
  PENDING_OWNER: statusChip("needs", "PENDING"),
  CONFIRMED: statusChip("approved", "CONFIRMED"),
  DECLINED: statusChip("failed", "DECLINED"),
  CANCELLED: statusChip("failed", "CANCELLED"),
};

const maskPhone = (phone: string): string => `${"•".repeat(Math.max(phone.length - 4, 0))}${phone.slice(-4)}`;

function action(o: DashboardOrder, to: string, label: string, kind: "primary" | "danger" | "secondary", confirm: boolean): SafeHtml {
  const form = (button: SafeHtml): SafeHtml => html`<form method="post" action="/owner/orders/${o.id}/transition" class="inline-form"><input type="hidden" name="to" value="${to}">${button}</form>`;
  const aria = `${label} order ${o.id}`;
  if (!confirm) return form(html`<button type="submit" class="btn btn--${kind}" aria-label="${aria}">${label}</button>`);
  // No script needed: opening the details is the "are you sure" step.
  return html`<details class="confirm"><summary class="btn btn--secondary" aria-label="${aria}?">${label}</summary>
    <div class="confirm__box"><p>${label} this order for ${o.customerName}?</p>${form(html`<button type="submit" class="btn btn--${kind}" aria-label="Yes, ${aria}">Yes, ${label.toLowerCase()}</button>`)}</div></details>`;
}

function actions(o: DashboardOrder): SafeHtml {
  if (o.status === "PENDING_OWNER") return html`${action(o, "CONFIRMED", "Confirm", "primary", false)}${action(o, "DECLINED", "Decline", "danger", true)}`;
  if (o.status === "CONFIRMED") return action(o, "CANCELLED", "Cancel", "danger", true);
  return html`<span class="muted">No actions</span>`;
}

function orderRow(o: DashboardOrder): SafeHtml {
  return html`<tr>
    <td data-label="Order"><span class="mono wrap-anywhere">${o.id}</span><br>${STATUS_CHIP[o.status] ?? o.status}</td>
    <td data-label="For">${shortDate(o.fulfilDate)}${o.deliveryAddress ? html`<br><span class="muted">${icon("truck")}Delivery</span>` : html`<br><span class="muted">Pickup</span>`}</td>
    <td data-label="Total" class="num">${inr(o.totalPaise)}</td>
    <td data-label="Via"><span class="chan">${icon(o.channel === "mcp" ? "globe" : "receipt")}${o.channel === "mcp" ? "AI agent" : "Website"}</span></td>
    <td data-label="Customer">${o.customerName}<br>
      <details class="reveal"><summary>${maskPhone(o.customerPhone)} <span class="reveal__hint">show</span></summary><p>${o.customerPhone}</p></details>
      ${o.deliveryAddress ? html`<span class="muted">${o.deliveryAddress}</span>` : ""}
      ${o.notes ? html`<p class="notes"><strong>Notes:</strong> ${o.notes}</p>` : ""}</td>
    <td data-label="Actions" class="actions">${actions(o)}</td>
  </tr>`;
}

function ordersTable(orders: DashboardOrder[], tab: OwnerTab): SafeHtml {
  if (orders.length === 0) {
    const none = tab === "pending" ? "No orders are waiting for you." : tab === "confirmed" ? "No confirmed orders yet." : "No orders yet.";
    return html`<p class="empty">${none} <a href="/">Share your shop link →</a></p>`;
  }
  return html`<div class="table-wrap"><table class="orders">
    <caption class="visually-hidden">Orders</caption>
    <thead><tr><th scope="col">Order</th><th scope="col">For</th><th scope="col" class="num">Total</th><th scope="col">Via</th><th scope="col">Customer</th><th scope="col">Actions</th></tr></thead>
    <tbody>${orders.map(orderRow)}</tbody>
  </table></div>`;
}

export function dashboardPage(all: DashboardOrder[], contacts: ContactMessage[], launch: LaunchState, tab: OwnerTab): string {
  const pending = all.filter((o) => o.status === "PENDING_OWNER");
  const confirmed = all.filter((o) => o.status === "CONFIRMED");
  const shown = tab === "pending" ? pending : tab === "confirmed" ? confirmed : all;
  const counts: Record<OwnerTab, number> = { pending: pending.length, confirmed: confirmed.length, all: all.length };
  const body = html`<section class="wrap section">
    <div class="dash-head">
      <div><p class="eyebrow">Owner area</p><h1 class="page-title">Orders</h1></div>
      <form method="post" action="/owner/logout"><button type="submit" class="btn btn--secondary">Sign out</button></form>
    </div>
    <div class="dash-grid">
      <div>
        <nav class="tabs" aria-label="Order filter"><ul>
          ${TABS.map((t) => html`<li><a href="/owner?tab=${t.id}" ${t.id === tab ? html`aria-current="page"` : ""}>${t.label} <span class="count">${counts[t.id]}</span></a></li>`)}
          <li><a href="#messages">Messages <span class="count">${contacts.length}</span></a></li>
        </ul></nav>
        <h2 class="visually-hidden">${TABS.find((t) => t.id === tab)?.label} orders</h2>
        ${ordersTable(shown, tab)}
        <section class="messages" id="messages" aria-labelledby="messages-h">
          <h2 id="messages-h" class="section__title">Contact messages</h2>
          ${contacts.length === 0
            ? html`<p class="empty">No messages yet.</p>`
            : html`<ul class="msgs">${contacts.map((c) => html`<li class="msg">
                <p class="msg__head"><strong>${c.name}</strong> &lt;${c.email}&gt; <span class="muted">· ${c.createdAt}</span> ${c.emailStatus === "SENT" ? statusChip("approved", "EMAILED") : statusChip("warn", "EMAIL FAILED")}</p>
                <p class="msg__body">${c.message}</p></li>`)}</ul>`}
        </section>
      </div>
      <aside class="panel side" aria-labelledby="side-h">
        <h2 id="side-h">${icon("lock")}Your rules</h2>
        ${launch.launched
          ? html`<p>Policy fingerprint</p><p class="mono wrap-anywhere small">${launch.policyHash}</p><p><a href="/launch-report">Open the launch report</a></p>`
          : html`<p>This shop is not launched.</p>`}
        <p class="hint">To change a rule, run the AgentDoor launcher again and redeploy. Rules never change from this page.</p>
      </aside>
    </div>
  </section>`;
  return layout({ title: "Owner dashboard", body, shop: launch.launched ? { name: launch.policy.business.name } : undefined });
}
