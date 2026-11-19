import { html, domId, type SafeHtml } from "@agentdoor/ui";
import type { GapCategory } from "@agentdoor/core";
import type { IssueCard } from "../cards.js";
import { labelOfPath, valueOfPath } from "./describe.js";
import { frame, failedCard, jobCard, type ViewCtx } from "./frame.js";
import { badge, notice, postForm, type Tone } from "./kit.js";
import { ruleLine } from "./rules.js";

interface CategoryInfo {
  key: GapCategory;
  title: string;
  hint: string;
}

/** Four separate figures, in this order. They are never added into one number. */
const CATEGORIES: CategoryInfo[] = [
  { key: "policy", title: "Business-policy gaps", hint: "Decisions about your business that are still open" },
  { key: "approval", title: "Pending approvals", hint: "Rules waiting for you to read and approve" },
  { key: "scenario", title: "Scenario mismatches", hint: "Customer cases where the shop's answer is not what you would do" },
  { key: "engine", title: "Engine failures", hint: "Built-in checks of the price and rules engine that failed" },
];

const toneOf = (n: number): Tone => (n === 0 ? "ok" : n > 0 ? "warn" : "mute");

function tiles(ctx: ViewCtx): SafeHtml {
  const counts = ctx.ready.counts;
  return html`<ul class="tiles" aria-label="Rehearsal results">${CATEGORIES.map((c) => {
    const n = counts ? counts[c.key] : null;
    return html`<li class="tile tile--${n === null ? "mute" : toneOf(n)}"><p class="tile__n">${n === null ? "–" : n}</p><p class="tile__l">${c.title}</p><p class="tile__d">${c.hint}</p></li>`;
  })}</ul>`;
}

function fixControl(ctx: ViewCtx, card: IssueCard): SafeHtml {
  const controls = card.fixes.map((f) =>
    f.needsValue
      ? postForm(
          `${ctx.base}/fix`,
          html`<input type="hidden" name="gapId" value="${card.gapId}"><input type="hidden" name="choice" value="${f.choice}">
          <label class="sr-only" for="v-${domId(card.gapId)}">Units a day</label><input id="v-${domId(card.gapId)}" class="input input--num" type="number" name="value" min="${f.needsValue.min}" max="${f.needsValue.max}" step="1" inputmode="numeric" placeholder="e.g. 8" required>
          <button class="btn btn--sm btn--primary" type="submit">Set limit</button>`,
          "inline",
        )
      : postForm(`${ctx.base}/fix`, html`<input type="hidden" name="gapId" value="${card.gapId}"><input type="hidden" name="choice" value="${f.choice}"><button class="btn btn--sm" type="submit">${f.label}</button>`, "inline"),
  );
  return html`<div class="issue__fix">${controls}${card.editHref ? html`<a class="btn btn--sm btn--quiet" href="${card.editHref}">Edit rule</a>` : ""}</div>`;
}

function issueCard(ctx: ViewCtx, card: IssueCard): SafeHtml {
  return html`<article class="issue" id="${domId(`gap-${card.gapId}`)}">
    <h3 class="issue__title">${card.title}</h3>
    <dl class="issue__body">
      <div><dt>A customer asks</dt><dd>${card.request}</dd></div>
      <div><dt>What would go wrong</dt><dd>${card.wrong}</dd></div>
      <div><dt>Why it matters</dt><dd>${card.why}</dd></div>
      <div><dt>Suggested</dt><dd>${card.suggestion}</dd></div>
    </dl>
    ${fixControl(ctx, card)}
    <details class="evidence"><summary>Show evidence</summary><pre class="evidence__pre">${card.evidence.join("\n")}</pre></details>
  </article>`;
}

function approvalList(ctx: ViewCtx, all: IssueCard[]): SafeHtml {
  const policy = ctx.state.policy;
  if (!policy) return html``;
  // One row per rule: a rule can be both unapproved and low-confidence, but it is approved once.
  const pathOf = (c: IssueCard): string => ctx.state.run?.gaps.find((g) => g.id === c.gapId)?.paths[0] ?? "";
  const seen = new Set<string>();
  const cards = all.filter((c) => !seen.has(pathOf(c)) && seen.add(pathOf(c)));
  const stated = cards.filter((c) => {
    const path = ctx.state.run?.gaps.find((g) => g.id === c.gapId)?.paths[0];
    return path !== undefined && policy.provenance[path]?.source.kind === "transcript";
  }).length;
  return html`<div class="card"><div class="card__row"><p class="muted">Read each rule, then approve it or change it.</p>${
    stated > 0 ? postForm(`${ctx.base}/approve-stated`, html`<input type="hidden" name="next" value="rehearse"><button class="btn btn--sm btn--primary" type="submit">Approve all I stated (${stated})</button>`) : ""
  }</div><ul class="rules">${cards.map((c) => {
    const path = ctx.state.run?.gaps.find((g) => g.id === c.gapId)?.paths[0] ?? "";
    return ruleLine(ctx, path, labelOfPath(policy, path), valueOfPath(policy, path), "rehearse");
  })}</ul></div>`;
}

function categorySection(ctx: ViewCtx, info: CategoryInfo, cards: IssueCard[]): SafeHtml {
  if (cards.length === 0) return html``;
  const shown = info.key === "approval" ? (ctx.ready.counts?.approval ?? cards.length) : cards.length;
  const body = info.key === "approval" ? approvalList(ctx, cards) : html`<div class="stack">${cards.map((c) => issueCard(ctx, c))}</div>`;
  return html`<section class="cat" aria-labelledby="cat-${info.key}"><h2 id="cat-${info.key}" class="cat__title">${info.title} <span class="count">${shown}</span></h2>${body}</section>`;
}

function publishBar(ctx: ViewCtx): SafeHtml {
  const { ready } = ctx;
  if (!ready.hasRun) return html``;
  if (ready.canPublish)
    return html`<div class="lock lock--ok"><p><strong>Publishing is unlocked.</strong> Everything checks out.</p><a class="btn btn--primary" href="${ctx.base}/storefront">Go to Storefront</a></div>`;
  return html`<div class="lock"><p><strong>Publishing is locked.</strong> ${ready.blockers.join(" ")}</p></div>`;
}

function toolbar(ctx: ViewCtx, running: boolean): SafeHtml {
  const { ready, roundsLeft } = ctx;
  if (running || !ready.hasPolicy) return html``;
  const mode = (m: string, label: string, primary: boolean): SafeHtml =>
    postForm(`${ctx.base}/rehearse`, html`<input type="hidden" name="mode" value="${m}"><button class="btn${primary ? " btn--primary" : ""}" type="submit">${label}</button>`, "inline");
  if (!ready.hasRun) {
    const blocked = roundsLeft.scenarios <= 0;
    return html`<div class="toolbar">${blocked ? notice("warn", "The customer-scenario runs for this business are used up.") : mode("full", "Run rehearsal", true)}</div>`;
  }
  return html`<div class="toolbar">${mode("recheck", "Run checks again", true)}${
    roundsLeft.scenarios > 0 ? postForm(`${ctx.base}/rehearse`, html`<input type="hidden" name="mode" value="regenerate"><button class="link link--quiet" type="submit">Write new customer scenarios (uses AI)</button>`, "inline") : ""
  }<p class="muted toolbar__text">Free checks re-run instantly. AI is used only for new customer scenarios.</p></div>`;
}

export function rehearsePage(ctx: ViewCtx, cards: IssueCard[]): string {
  const { state, job, ready } = ctx;
  const running = job !== null && (job.status === "queued" || job.status === "running");
  if (!ready.hasPolicy)
    return frame(ctx, "rehearse", "Rehearse", html`<section class="card"><p>Set up your business first, then rehearse it against realistic customers.</p><p><a class="btn btn--primary" href="${ctx.base}/setup">Go to Setup</a></p></section>`);
  const open = cards.filter((c) => !c.dismissed);
  const failed = !running && job?.status === "failed" && job.kind === "rehearse" ? failedCard(ctx, job) : html``;
  const run = state.run;
  const clear = ready.hasRun && open.length === 0;
  return frame(
    ctx,
    "rehearse",
    "Rehearse",
    html`${running && job ? jobCard(ctx, job) : ""}${failed}
    ${toolbar(ctx, running)}
    ${ready.hasRun && ready.stale ? notice("warn", "Your rules changed since this run. Run the checks again to update the numbers.") : ""}
    ${tiles(ctx)}
    ${publishBar(ctx)}
    ${run ? html`<p class="muted run__meta">${run.summary.probes} engine checks and ${run.summary.scenarios} customer scenarios were tested.</p>` : ""}
    ${clear ? html`<section class="card card--ok"><p class="card__title">${badge("ok", "All clear")}</p><p>No open items. Your rules handled every case.</p></section>` : ""}
    <div class="cats">${CATEGORIES.map((c) => categorySection(ctx, c, open.filter((x) => x.category === c.key)))}</div>`,
  );
}
