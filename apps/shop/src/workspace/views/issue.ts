import { html, domId, type SafeHtml } from "@agentdoor/ui";
import { DISMISS } from "../../../../launcher/src/flows/gapFix.js";
import type { IssueCard, IssueFix } from "../cards.js";
import type { ViewCtx } from "./frame.js";
import { rupees } from "../money.js";
import { icon } from "./icons.js";
import { postForm } from "./kit.js";

/** Pairs of choices that are really one either/or decision, shown as a segmented control. */
const SEGMENT_LABELS: Record<string, string> = {
  "unlisted-refuse": "Refuse",
  "unlisted-ask": "Ask me first",
  "custom-refuse": "Refuse",
  "custom-ask": "Ask me first",
};

const hidden = (card: IssueCard): SafeHtml => html`<input type="hidden" name="gapId" value="${card.gapId}">`;
const fixForm = (ctx: ViewCtx, className: string, inner: SafeHtml): SafeHtml => postForm(`${ctx.base}/fix`, inner, `${className} js-resolve`);

const choiceButtons = (fixes: IssueFix[], className: string, label: (f: IssueFix) => string): SafeHtml =>
  html`${fixes.map((f) => html`<button class="${className}" type="submit" name="choice" value="${f.choice}">${label(f)}</button>`)}`;

/** A number the owner types, with plus and minus buttons that appear when JavaScript is on. */
function stepper(ctx: ViewCtx, card: IssueCard, fix: IssueFix & { needsValue: { min: number; max: number } }): SafeHtml {
  const id = `v-${domId(card.gapId)}`;
  const { min, max } = fix.needsValue;
  return fixForm(
    ctx,
    "fix-limit",
    html`${hidden(card)}<input type="hidden" name="choice" value="${fix.choice}">
    <label class="fix-label" for="${id}">${fix.label}</label>
    <div class="fix-limit__row">
      <div class="stepper"><button class="stepper__btn" type="button" data-step="-1" aria-label="One fewer">${icon("minus")}</button><input id="${id}" class="input stepper__input" type="number" name="value" min="${min}" max="${max}" step="1" inputmode="numeric" placeholder="Units a day" required><button class="stepper__btn" type="button" data-step="1" aria-label="One more">${icon("plus")}</button></div>
      <button class="btn btn--primary btn--sm" type="submit">Set limit</button>
    </div>`,
  );
}

function controls(ctx: ViewCtx, card: IssueCard): SafeHtml {
  const segments = card.fixes.filter((f) => SEGMENT_LABELS[f.choice]);
  const limit = card.fixes.find((f) => f.needsValue);
  const quick = card.fixes.filter((f) => !SEGMENT_LABELS[f.choice] && !f.needsValue && f.choice !== DISMISS);
  const accept = card.fixes.filter((f) => f.choice === DISMISS);
  return html`${segments.length > 0 ? fixForm(ctx, "fix-seg", html`${hidden(card)}<div class="seg" role="group" aria-label="What should the shop do?">${choiceButtons(segments, "seg__btn", (f) => SEGMENT_LABELS[f.choice] ?? f.label)}</div>`) : ""}
    ${quick.length > 0 ? fixForm(ctx, "fix-quick", html`${hidden(card)}<div class="quick">${choiceButtons(quick, "btn btn--sm", (f) => f.label)}</div>`) : ""}
    ${limit?.needsValue ? stepper(ctx, card, { ...limit, needsValue: limit.needsValue }) : ""}
    <div class="issue__more">
      ${accept.length > 0 ? fixForm(ctx, "inline", html`${hidden(card)}<button class="btn btn--sm btn--ghost" type="submit" name="choice" value="${DISMISS}" title="${accept[0]?.label ?? ""}">${icon("check")}Accept</button>`) : ""}
      ${card.editHref ? html`<a class="btn btn--sm btn--ghost" href="${card.editHref}">${icon("pencil")}Edit rule</a>` : ""}
    </div>`;
}

/** A real customer wrote this (scenario) or it is an example the checks built from the rule. */
function bubble(card: IssueCard): SafeHtml {
  const real = card.category === "scenario";
  return html`<figure class="bubble${real ? "" : " bubble--example"}"><span class="bubble__avatar">${icon("user")}</span><div><figcaption class="bubble__who">${real ? "A customer writes" : "For example"}</figcaption><blockquote class="bubble__text">${card.request}</blockquote></div></figure>`;
}

/** The rupee figure and the working beside it. Only drawn when an engine quote of a concrete order gives one. */
const stakeLine = (card: IssueCard): SafeHtml =>
  card.stake ? html`<p class="issue__stake"><strong>Money at stake: ${rupees(card.stake.paise)}</strong><span>${card.stake.line}</span></p>` : html``;

/** Shown for a moment when a fix lands. `data-accept` lets the script tell "Accept" (nothing protected) from a real fix. */
const resolvedPanel = (card: IssueCard): SafeHtml =>
  html`<div class="issue__resolved" aria-hidden="true" data-accept="${DISMISS}">${icon("check")}<span>Resolved</span>${card.stake ? html`<span class="issue__protected">Protected: ${rupees(card.stake.paise)}</span><small class="issue__protected-how">${card.stake.line}</small>` : ""}</div>`;

/** One finding: the customer's message, what would happen, why it matters, and the fix right there. */
export function issueCard(ctx: ViewCtx, card: IssueCard): SafeHtml {
  return html`<article class="issue" id="${domId(`gap-${card.gapId}`)}">
    <div class="issue__body">
      ${card.category === "scenario" ? "" : html`<h3 class="issue__title">${card.title}</h3>`}
      ${bubble(card)}
      <dl class="issue__facts"><div><dt>What would happen</dt><dd>${card.wrong}</dd></div>${card.why ? html`<div><dt>Why it matters</dt><dd>${card.why}</dd></div>` : ""}</dl>
      ${stakeLine(card)}
      ${controls(ctx, card)}
      <details class="evidence"><summary>See details</summary><pre class="evidence__pre">${card.evidence.join("\n")}</pre></details>
    </div>
    ${resolvedPanel(card)}
  </article>`;
}
