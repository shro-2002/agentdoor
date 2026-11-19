import { html, icon, statusChip, type SafeHtml } from "@agentdoor/ui";
import type { LaunchState } from "../db/launch-state.js";
import type { OrderSummary } from "../db/queries.js";
import { inr, longDate } from "./format.js";
import { layout } from "./layout.js";
import { bannerFor, identityOf } from "./storefront.js";

interface Stage {
  chip: SafeHtml;
  headline: (owner: string) => string;
  detail: (owner: string, date: string) => string;
  tone: "wait" | "ok" | "no";
}

const STAGES: Record<string, Stage> = {
  PENDING_OWNER: {
    chip: statusChip("needs", "WAITING"),
    headline: (o) => `Waiting for ${o} to confirm`,
    detail: (o) => `${o} has your request and will confirm it by hand. Nothing is charged online. Check this page again later.`,
    tone: "wait",
  },
  CONFIRMED: {
    chip: statusChip("approved", "CONFIRMED"),
    headline: (o) => `${o} confirmed your order`,
    detail: (_o, d) => `It is booked for ${d}. See you then.`,
    tone: "ok",
  },
  DECLINED: {
    chip: statusChip("failed", "DECLINED"),
    headline: (o) => `${o} could not take this order`,
    detail: () => "Nothing was charged. You are welcome to ask for a quote on another day.",
    tone: "no",
  },
  CANCELLED: {
    chip: statusChip("failed", "CANCELLED"),
    headline: () => "This order was cancelled",
    detail: () => "Nothing was charged. You are welcome to order again.",
    tone: "no",
  },
};

interface Line {
  itemId: string;
  qty: number;
  optionIds?: string[];
}

export function orderStatusPage(o: OrderSummary, launch: LaunchState, selfPath: string, selfUrl: string): string {
  const owner = launch.launched ? launch.policy.business.ownerFirstName : "The owner";
  const stage = STAGES[o.status] ?? STAGES.PENDING_OWNER!;
  const req = (o.request ?? {}) as { lines?: Line[]; fulfilment?: { kind: string; area?: string } };
  const name = (id: string): string => (launch.launched ? launch.policy.catalog.find((c) => c.id === id)?.name.en : undefined) ?? id;
  const where = req.fulfilment?.kind === "delivery" ? `Delivery to ${req.fulfilment.area ?? "your address"}` : "Pickup";
  const date = longDate(o.fulfilDate);
  const body = html`<section class="wrap section narrow">
    <p class="eyebrow">Order ${o.orderId.slice(-8)}</p>
    <h1 class="page-title">${stage.headline(owner)}</h1>
    <div class="status status--${stage.tone}">
      <p class="status__chip">${stage.chip}</p>
      <p>${stage.detail(owner, date)}</p>
    </div>
    <ol class="track" aria-label="Order progress">
      <li class="is-done">${icon("check")}<span>Request sent</span></li>
      <li class="${o.status === "PENDING_OWNER" ? "is-now" : o.status === "CONFIRMED" ? "is-done" : "is-off"}" ${o.status === "PENDING_OWNER" ? html`aria-current="step"` : ""}>${icon(o.status === "CONFIRMED" ? "check" : o.status === "PENDING_OWNER" ? "clock" : "x")}<span>${owner} confirms</span></li>
      <li class="${o.status === "CONFIRMED" ? "is-now" : "is-off"}">${icon("door")}<span>${o.status === "CONFIRMED" ? `Ready ${date}` : "Ready on the day"}</span></li>
    </ol>
    <div class="slip">
      <div class="slip__head"><p class="slip__brand">${icon("receipt")}<span>Your order</span></p><p class="recap">${icon("clock")}<span><strong>${date}</strong> · ${where}</span></p></div>
      <table class="quote-table"><caption class="visually-hidden">What you ordered</caption>
        <thead><tr><th scope="col">Item</th><th scope="col" class="num">Qty</th></tr></thead>
        <tbody>${(req.lines ?? []).map((l) => html`<tr><th scope="row">${name(l.itemId)}</th><td class="num">${l.qty}</td></tr>`)}</tbody>
        <tfoot><tr><th scope="row">Total${o.isRush ? " (rush)" : ""}</th><td class="num">${inr(o.totalPaise)}</td></tr></tfoot>
      </table>
    </div>
    <div class="panel savelink">
      <h2>Save this link</h2>
      <p>It is the only way back to this page, and it is private to you.</p>
      <label class="visually-hidden" for="statuslink">Private link to this order</label>
      <input class="input mono" id="statuslink" readonly value="${selfUrl}">
      <p class="form-actions"><a class="btn btn--secondary" href="${selfPath}">Refresh status</a><a class="btn btn--ghost" href="/">Back to the menu</a></p>
    </div>
  </section>`;
  return layout({ title: "Order status", body, shop: identityOf(launch), banner: bannerFor(launch), scripts: ["shop.js"] });
}
