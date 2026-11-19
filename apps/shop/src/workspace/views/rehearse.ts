import { html, type SafeHtml } from "@agentdoor/ui";
import type { GapCategory } from "@agentdoor/core";
import type { IssueCard } from "../cards.js";
import { labelOfPath, valueOfPath } from "./describe.js";
import { rupees } from "../money.js";
import { protectedTotal } from "../stakes.js";
import { busyDaySection, type BusyDayView } from "./busy-day.js";
import { frame, type PageHead, type ViewCtx } from "./frame.js";
import { icon, type IconName } from "./icons.js";
import { issueCard } from "./issue.js";
import { failedCard, jobCard } from "./progress.js";
import { notice, postForm, type Tone } from "./kit.js";
import { readinessRing, settledPercent } from "./ring.js";
import { approveAll, ruleLine, statedPending } from "./rule-line.js";

interface Category {
  key: GapCategory;
  title: string;
  hint: string;
  /** What the chip in the summary says. */
  short: string;
  clear: string;
  icon: IconName;
}

/** Four separate figures, in this order. They are never added into one number. */
const CATEGORIES: Category[] = [
  { key: "policy", title: "Decisions to make", short: "Decisions", hint: "Choices about your business that only you can make.", clear: "Nothing left to decide.", icon: "setup" },
  { key: "approval", title: "Rules to confirm", short: "Rules to confirm", hint: "Read each rule, then approve it or change it.", clear: "Every rule is confirmed.", icon: "rules" },
  { key: "scenario", title: "Customers who got the wrong answer", short: "Wrong answers", hint: "Made-up customers whose answer from the shop wasn't what you'd want.", clear: "Every customer got the answer you'd want.", icon: "message" },
  { key: "engine", title: "Technical checks", short: "Technical checks", hint: "Built-in checks of the price and rules engine.", clear: "", icon: "lock" },
];

const toneOf = (n: number | null): Tone => (n === null ? "mute" : n === 0 ? "ok" : "warn");
const running = (ctx: ViewCtx): boolean => ctx.job !== null && (ctx.job.status === "queued" || ctx.job.status === "running");

function headline(ctx: ViewCtx): { title: string; text: string } {
  const { ready } = ctx;
  if (!ready.hasRun) return { title: "Rehearse your business", text: "Customers will test your rules before anyone orders. The checks are free and instant; Claude writes the customer messages." };
  if (ready.canPublish) return { title: "Ready for its first customer", text: "Every decision is made and every rule is confirmed." };
  if (ready.stale) return { title: "Your rules changed", text: "Run the checks again to bring this picture up to date." };
  return { title: "A few things to settle", text: ready.blockers.slice(0, 2).join(" ") };
}

function chips(ctx: ViewCtx): SafeHtml {
  const counts = ctx.ready.counts;
  return html`<ul class="chips-row" aria-label="Rehearsal results">${CATEGORIES.map((c) => {
    const n = counts ? counts[c.key] : null;
    return html`<li class="stat stat--${toneOf(n)}"><span class="stat__n">${n ?? "–"}</span><span class="stat__l">${c.short}</span></li>`;
  })}</ul>`;
}

/** The sum of the stakes on issues the owner fixed. Its own figure: it is never mixed into the four counts. */
function protectedBlock(ctx: ViewCtx): SafeHtml {
  const saved = ctx.state.protectedStakes ?? [];
  if (saved.length === 0) return html``;
  return html`<div class="protected">
    <p class="protected__total"><strong>Protected so far: ${rupees(protectedTotal(ctx.state))}</strong><span>The money that was at stake on the issues you have fixed. It is not one of the four counts.</span></p>
    <details class="protected__list"><summary>See what was protected</summary><ul>${saved.map((s) => html`<li><span class="protected__what">${s.title}</span><strong>${rupees(s.paise)}</strong><small>${s.line}</small></li>`)}</ul></details>
  </div>`;
}

function summary(ctx: ViewCtx): SafeHtml {
  const { ready, state } = ctx;
  const words = headline(ctx);
  const run = state.run;
  const lock = ready.hasRun
    ? ready.canPublish
      ? html`<p class="lockline lockline--ok">${icon("check")}Publishing is unlocked</p>`
      : html`<p class="lockline">${icon("lock")}Publishing is locked</p>`
    : "";
  const go = ready.canPublish ? html`<a class="btn btn--primary" href="${ctx.base}/storefront">See your storefront${icon("arrow")}</a>` : "";
  return html`<section class="hero-card${ready.canPublish ? " is-ready" : ""}" aria-labelledby="ready-h">
    ${readinessRing(settledPercent(state, ready))}
    <div class="hero-card__text"><h2 id="ready-h" class="hero-card__title">${words.title}</h2><p>${words.text}</p>${lock}${go}</div>
    ${chips(ctx)}
    ${protectedBlock(ctx)}
    ${run ? html`<p class="hero-card__meta">${run.summary.probes} technical checks and ${run.summary.scenarios} customer tests were run.</p>` : ""}
  </section>`;
}

function approvalList(ctx: ViewCtx, all: IssueCard[]): SafeHtml {
  const policy = ctx.state.policy;
  if (!policy) return html``;
  const pathOf = (c: IssueCard): string => ctx.state.run?.gaps.find((g) => g.id === c.gapId)?.paths[0] ?? "";
  // One row per rule: a rule can be both unapproved and low-confidence, but it is approved once.
  const seen = new Set<string>();
  const rows = all.filter((c) => !seen.has(pathOf(c)) && seen.add(pathOf(c)));
  return html`<ul class="rules rules--flat">${rows.map((c) => ruleLine(ctx, pathOf(c), labelOfPath(policy, pathOf(c)), valueOfPath(policy, pathOf(c)), "rehearse", true))}</ul>`;
}

const quiet = (text: string, ok = true): SafeHtml => html`<p class="quiet${ok ? " quiet--ok" : ""}">${icon("check")}${text}</p>`;

function section(ctx: ViewCtx, c: Category, cards: IssueCard[], statedLeft: number): SafeHtml {
  const counts = ctx.ready.counts;
  const n = counts ? counts[c.key] : cards.length;
  const technicalClear = c.key === "engine" && n === 0;
  const body = technicalClear
    ? quiet(`All ${ctx.state.run?.summary.probes ?? 0} built-in price and rule checks passed.`)
    : cards.length === 0
      ? quiet(c.clear)
      : c.key === "approval"
        ? approvalList(ctx, cards)
        : html`<div class="stack">${cards.map((x) => issueCard(ctx, x))}</div>`;
  const bulk = c.key === "approval" ? approveAll(ctx, "rehearse", statedLeft, true) : "";
  return html`<section class="cat cat--${toneOf(n)}" aria-labelledby="cat-${c.key}">
    <header class="cat__head"><span class="cat__icon">${icon(c.icon)}</span><div class="cat__text"><h2 id="cat-${c.key}" class="cat__title">${c.title}<span class="count count--${toneOf(n)}">${n}</span></h2><p class="cat__hint">${c.hint}</p></div>${bulk}</header>
    ${body}
  </section>`;
}

function actions(ctx: ViewCtx): SafeHtml {
  const { ready, roundsLeft } = ctx;
  if (running(ctx) || !ready.hasPolicy) return html``;
  const mode = (m: string, label: SafeHtml, cls: string): SafeHtml => postForm(`${ctx.base}/rehearse`, html`<input type="hidden" name="mode" value="${m}"><button class="btn ${cls}" type="submit">${label}</button>`, "inline");
  if (!ready.hasRun) return roundsLeft.scenarios <= 0 ? notice("warn", "The customer-test runs for this business are used up.") : mode("full", html`${icon("sparkle")}Run rehearsal`, "btn--primary");
  const again = mode("recheck", html`${icon("retry")}Run checks again`, ready.canPublish ? "" : "btn--primary");
  const fresh = roundsLeft.scenarios > 0 ? mode("regenerate", html`${icon("sparkle")}Write new customer tests`, "btn--ghost") : "";
  return html`${fresh}${again}`;
}

export function rehearsePage(ctx: ViewCtx, cards: IssueCard[], busy: BusyDayView): string {
  const { job, ready } = ctx;
  const head: PageHead = { title: "Rehearse", lede: "Test your rules against realistic customers before anyone orders.", actions: actions(ctx) };
  if (!ready.hasPolicy)
    return frame(ctx, "rehearse", head, html`<section class="empty"><p>Set up your business first, then rehearse it against realistic customers.</p><p><a class="btn btn--primary" href="${ctx.base}/setup">Go to Setup</a></p></section>`);
  if (running(ctx) && job) return frame(ctx, "rehearse", head, jobCard(ctx, job));
  const failed = job?.status === "failed" && job.kind === "rehearse" ? failedCard(ctx, job) : html``;
  const open = cards.filter((c) => !c.dismissed);
  const stated = statedPending(ctx);
  const stale = ready.hasRun && ready.stale ? notice("warn", "Your rules changed since this run. Run the checks again to update the numbers.") : "";
  const sections = ready.hasRun ? html`<div class="cats">${CATEGORIES.map((c) => section(ctx, c, open.filter((x) => x.category === c.key), stated))}</div>` : "";
  const busyDay = ctx.state.policy ? busyDaySection(ctx, ctx.state.policy, busy) : "";
  return frame(ctx, "rehearse", head, html`${failed}${stale}${summary(ctx)}${busyDay}${sections}`);
}
