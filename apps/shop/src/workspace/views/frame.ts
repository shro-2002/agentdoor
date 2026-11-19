import { html, type SafeHtml } from "@agentdoor/ui";
import type { Readiness } from "../readiness.js";
import type { DraftState, JobRow } from "../state.js";
import { nextQuestion } from "../questions.js";
import { badge, brand, notice, pageDocument, postForm, type Tone } from "./kit.js";

export type Tab = "overview" | "setup" | "products" | "rules" | "rehearse" | "storefront";

export interface ViewCtx {
  id: string;
  /** `/launch/w/<id>` */
  base: string;
  state: DraftState;
  job: JobRow | null;
  ready: Readiness;
  flash: { tone: Tone; text: string } | null;
  owner: boolean;
  /** `/launch/p/<previewId>` once one exists. */
  previewPath: string | null;
  prepared: boolean;
  /** Absolute origin for links the owner copies. */
  origin: string;
  /** Rounds left for AI steps (compile, scenarios). */
  roundsLeft: { compile: number; scenarios: number };
}

const TABS: { key: Tab; label: string; path: string }[] = [
  { key: "overview", label: "Overview", path: "" },
  { key: "setup", label: "Setup", path: "/setup" },
  { key: "products", label: "Products", path: "/products" },
  { key: "rules", label: "Rules", path: "/rules" },
  { key: "rehearse", label: "Rehearse", path: "/rehearse" },
  { key: "storefront", label: "Storefront", path: "/storefront" },
];

/** Which steps are finished, for the quiet dot beside each nav item. */
function done(ctx: ViewCtx): Record<Tab, boolean> {
  const { state, ready } = ctx;
  const approved = ready.approvals.required > 0 && ready.approvals.approved === ready.approvals.required;
  return {
    overview: false,
    setup: state.policy !== null && nextQuestion(state) === null && ctx.job?.status !== "running",
    products: state.policy !== null,
    rules: approved,
    rehearse: ready.canPublish,
    storefront: ctx.previewPath !== null,
  };
}

function nav(ctx: ViewCtx, active: Tab): SafeHtml {
  const finished = done(ctx);
  return html`<nav class="side__nav" aria-label="Workspace"><ul>${TABS.map((t) => {
    const here = t.key === active;
    return html`<li><a href="${ctx.base}${t.path}"${here ? html` aria-current="page"` : ""} class="navlink${here ? " is-active" : ""}"><span class="dot${finished[t.key] ? " is-done" : ""}" aria-hidden="true"></span>${t.label}${finished[t.key] ? html`<span class="sr-only"> (done)</span>` : ""}</a></li>`;
  })}</ul></nav>`;
}

export function frame(ctx: ViewCtx, active: Tab, title: string, content: SafeHtml): string {
  const biz = ctx.state.policy?.business;
  const label = TABS.find((t) => t.key === active)?.label ?? "";
  const body = html`<div class="app">
    <aside class="side">
      <div class="side__top">${brand("/launch")}</div>
      <div class="side__biz">
        <p class="side__name">${biz?.name ?? "Your business"}</p>
        <p class="side__sub">${biz?.city ?? "Setting up"}</p>
      </div>
      ${nav(ctx, active)}
      <p class="side__foot"><a href="/launch">New business</a></p>
    </aside>
    <div class="content">
      <main id="main" class="page" tabindex="-1">
        <header class="page__head"><h1 class="page__title">${title}</h1></header>
        ${ctx.flash ? notice(ctx.flash.tone, ctx.flash.text) : ""}
        ${content}
      </main>
    </div>
  </div>`;
  return pageDocument({ title: `${label} · ${biz?.name ?? "AgentDoor"}`, body });
}

const JOB_WORDS: Record<string, { title: string; hint: string }> = {
  compile: { title: "Reading your description", hint: "Claude is turning it into a business. This usually takes under a minute." },
  clarify: { title: "Updating your business", hint: "Claude is applying your answers. This usually takes under a minute." },
  rehearse: { title: "Rehearsing with customers", hint: "Claude is writing realistic customers, then the rules are tested against them. This can take a minute." },
};

/** A running job: the script polls it; without JavaScript the link reloads the page. */
export function jobCard(ctx: ViewCtx, job: JobRow): SafeHtml {
  const words = JOB_WORDS[job.kind] ?? JOB_WORDS.compile!;
  return html`<section class="card job" data-job-url="${ctx.base}/jobs/${job.id}.json" aria-live="polite">
    <p class="job__title">${words.title}<span class="job__dots" aria-hidden="true"></span></p>
    <div class="bar" aria-hidden="true"><span class="bar__fill"></span></div>
    <p class="muted">${words.hint}</p>
    <p class="job__link"><a href="${ctx.base}${pathOfKind(job.kind)}">Check progress</a></p>
  </section>`;
}

const pathOfKind = (kind: string): string => (kind === "rehearse" ? "/rehearse" : "/setup");

/** A failed job: plain words, and a retry when trying again can help. */
export function failedCard(ctx: ViewCtx, job: JobRow, extra: SafeHtml = html``): SafeHtml {
  return html`<section class="card card--bad" role="alert">
    <p class="card__title">That did not finish</p>
    <p>${job.errorMessage ?? "Something went wrong."}</p>
    ${extra}
    ${job.retryable ? postForm(`${ctx.base}/retry`, html`<button class="btn btn--primary" type="submit">Try again</button>`) : ""}
  </section>`;
}

export const statTone = (n: number): Tone => (n === 0 ? "ok" : "warn");
export { badge, notice, postForm };
