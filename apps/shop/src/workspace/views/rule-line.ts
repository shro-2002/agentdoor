import { html, domId, type SafeHtml } from "@agentdoor/ui";
import { sourceOf } from "./describe.js";
import type { Tab, ViewCtx } from "./frame.js";
import { icon } from "./icons.js";
import { badge, postForm } from "./kit.js";

const MAX_QUOTE_CHARS = 160;
const clip = (t: string): string => (t.length > MAX_QUOTE_CHARS ? `${t.slice(0, MAX_QUOTE_CHARS - 1).trimEnd()}…` : t);

/** Where a rule came from: the owner's own quoted words, or a quiet tag when AgentDoor suggested it. */
function provenance(ctx: ViewCtx, path: string): SafeHtml {
  const src = sourceOf(ctx.state.policy?.provenance[path]);
  if (src.quote) return html`<p class="rule__src"><span class="rule__said">You said:</span> <q>${clip(src.quote)}</q></p>`;
  if (src.kind === "suggested") return html`<p class="rule__src"><span class="tag">${icon("sparkle")}${src.label}</span></p>`;
  return html`<p class="rule__src rule__src--plain">${src.label}</p>`;
}

/** One rule as a row: its name and where it came from, its value, and its approval. `resolve` marks it for in-place updates (Rehearse). */
export function ruleLine(ctx: ViewCtx, path: string, label: string, value: string, back: Tab, resolve = false): SafeHtml {
  const approved = ctx.state.policy?.provenance[path]?.status === "approved";
  const act = approved
    ? badge("ok", "Approved")
    : postForm(
        `${ctx.base}/approve`,
        html`<input type="hidden" name="path" value="${path}"><input type="hidden" name="next" value="${back}"><button class="btn btn--sm" type="submit">Approve</button>`,
        resolve ? "js-resolve" : "",
      );
  return html`<li class="rule${approved ? " is-approved" : ""}" id="${domId(`rule-${path}`)}">
    <div class="rule__left"><span class="rule__label">${label}</span>${provenance(ctx, path)}</div>
    <span class="rule__value">${value}</span>
    <div class="rule__act">${act}</div>
  </li>`;
}

/** Rules in the owner's own words that still wait for a yes. */
export const statedPending = (ctx: ViewCtx): number =>
  Object.values(ctx.state.policy?.provenance ?? {}).filter((v) => v.status !== "approved" && v.source.kind === "transcript").length;

/** One click to approve every rule the owner themselves stated (suggestions are never included). */
export function approveAll(ctx: ViewCtx, next: Tab, count: number, resolve = false): SafeHtml {
  if (count === 0) return html``;
  return postForm(
    `${ctx.base}/approve-stated`,
    html`<input type="hidden" name="next" value="${next}"><button class="btn btn--primary btn--sm" type="submit">${icon("check")}Approve everything I said (${count})</button>`,
    resolve ? "js-resolve" : "",
  );
}
