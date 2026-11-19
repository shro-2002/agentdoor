import { html, type SafeHtml } from "@agentdoor/ui";
import type { JobRow } from "../state.js";
import type { ViewCtx } from "./frame.js";
import { icon } from "./icons.js";
import { postForm } from "./kit.js";

/** A step is "current" for this long before the next one is: the job's real order, paced by real elapsed time. */
const STEP_SECONDS = 12;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;

interface JobWords {
  title: string;
  hint: string;
  steps: string[];
  /** The screen that appears when the job is done. */
  next: "setup" | "rehearse";
}

const JOB_WORDS: Record<string, JobWords> = {
  compile: {
    title: "Claude is building your business",
    hint: "This usually takes under a minute. You can leave this page open.",
    steps: ["Reading your description", "Writing your business rules", "Preparing questions"],
    next: "setup",
  },
  clarify: {
    title: "Claude is updating your business",
    hint: "This usually takes under a minute. You can leave this page open.",
    steps: ["Reading your answers", "Updating your business rules", "Checking what is still open"],
    next: "setup",
  },
  rehearse: {
    title: "Claude is rehearsing with customers",
    hint: "This can take a minute or two. You can leave this page open.",
    steps: ["Reading your rules", "Writing realistic customers", "Testing your rules against them"],
    next: "rehearse",
  },
};

const wordsOf = (kind: string): JobWords => JOB_WORDS[kind] ?? (JOB_WORDS.compile as JobWords);

export const clock = (seconds: number): string => `${Math.floor(seconds / SECONDS_PER_MINUTE)}:${String(seconds % SECONDS_PER_MINUTE).padStart(2, "0")}`;

function stepRow(label: string, i: number, current: number): SafeHtml {
  const state = i < current ? "done" : i === current ? "active" : "todo";
  // Both marks are always present; the state class decides which one shows, so the script only flips a class.
  return html`<li class="wstep is-${state}"><span class="wstep__mark"><span class="wstep__dot"></span>${icon("check")}</span><span>${label}</span></li>`;
}

const skeletonRows = (n: number): SafeHtml => html`${Array.from({ length: n }, () => html`<span class="skel__line"></span>`)}`;

/** A calm outline of the screen that is on its way. */
function skeleton(next: JobWords["next"]): SafeHtml {
  if (next === "rehearse")
    return html`<div class="skel" aria-hidden="true"><div class="skel__panel skel__panel--wide"><span class="skel__ring"></span><div class="skel__stack">${skeletonRows(3)}</div></div><div class="skel__panel">${skeletonRows(3)}</div><div class="skel__panel">${skeletonRows(3)}</div></div>`;
  return html`<div class="skel" aria-hidden="true"><div class="skel__panel skel__panel--wide"><span class="skel__bubble"></span><span class="skel__bubble skel__bubble--short"></span><div class="skel__chips"><span></span><span></span><span></span></div></div></div>`;
}

/** A running job: what it is doing, in order, with the real elapsed time. The script polls it; without JavaScript the link reloads. */
export function jobCard(ctx: ViewCtx, job: JobRow): SafeHtml {
  const w = wordsOf(job.kind);
  const elapsed = Math.max(0, Math.floor((ctx.nowMs - job.createdMs) / MS_PER_SECOND));
  const current = Math.min(w.steps.length - 1, Math.floor(elapsed / STEP_SECONDS));
  return html`<section class="work" data-job-url="${ctx.base}/jobs/${job.id}.json" data-elapsed="${elapsed}" data-step-seconds="${STEP_SECONDS}" aria-labelledby="work-title">
    <header class="work__head"><span class="work__badge">${icon("sparkle")}</span><div class="work__text"><h2 id="work-title" class="work__title">${w.title}</h2><p class="work__hint">${w.hint}</p></div><p class="work__time" aria-hidden="true">${icon("clock")}<time data-timer>${clock(elapsed)}</time></p></header>
    <ol class="work__steps" aria-live="polite">${w.steps.map((s, i) => stepRow(s, i, current))}</ol>
    <p class="work__link"><a href="${ctx.base}/${w.next}">Refresh</a></p>
  </section>${skeleton(w.next)}`;
}

/** A failed job: plain words, and a retry when trying again can help. */
/** `extra` replaces the plain Retry button (Setup offers the description to edit first). */
export function failedCard(ctx: ViewCtx, job: JobRow, extra?: SafeHtml): SafeHtml {
  return html`<section class="alert" role="alert">
    <span class="alert__icon">${icon("alert")}</span>
    <div class="alert__body"><h2 class="alert__title">That didn't finish</h2><p>${job.errorMessage ?? "Something went wrong."}</p>
    ${extra ?? (job.retryable ? postForm(`${ctx.base}/retry`, html`<button class="btn btn--primary" type="submit">${icon("retry")}Retry</button>`) : "")}</div>
  </section>`;
}
