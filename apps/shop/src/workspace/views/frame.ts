import { html, type SafeHtml } from "@agentdoor/ui";
import type { Readiness } from "../readiness.js";
import type { DraftState, JobRow } from "../state.js";
import { nextQuestion } from "../questions.js";
import { icon, type IconName } from "./icons.js";
import { brand, notice, pageDocument, type Tone } from "./kit.js";

export type Tab = "overview" | "setup" | "products" | "rules" | "rehearse" | "storefront";
export type Device = "desktop" | "phone";

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
  /** Server time, so a running job's elapsed time never depends on the visitor's clock. */
  nowMs: number;
  /** Which preview frame the Storefront tab shows. */
  device: Device;
  /** Rounds left for AI steps (compile, scenarios). */
  roundsLeft: { compile: number; scenarios: number };
}

export interface PageHead {
  title: string;
  lede?: string;
  /** Contextual actions, pinned in the sticky header. */
  actions?: SafeHtml;
}

const TABS: { key: Tab; label: string; path: string; icon: IconName }[] = [
  { key: "overview", label: "Overview", path: "", icon: "overview" },
  { key: "setup", label: "Setup", path: "/setup", icon: "setup" },
  { key: "products", label: "Products", path: "/products", icon: "products" },
  { key: "rules", label: "Rules", path: "/rules", icon: "rules" },
  { key: "rehearse", label: "Rehearse", path: "/rehearse", icon: "rehearse" },
  { key: "storefront", label: "Storefront", path: "/storefront", icon: "storefront" },
];

/** Which steps are finished, for the tick beside each nav item. */
export function stepsDone(ctx: ViewCtx): Record<Tab, boolean> {
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
  const finished = stepsDone(ctx);
  return html`<nav class="rail__nav" aria-label="Workspace"><ul>${TABS.map((t) => {
    const here = t.key === active;
    return html`<li><a href="${ctx.base}${t.path}"${here ? html` aria-current="page"` : ""} class="navlink${here ? " is-active" : ""}">${icon(t.icon)}<span class="navlink__text">${t.label}</span>${finished[t.key] ? html`<span class="navlink__done">${icon("check")}</span><span class="sr-only"> (done)</span>` : ""}</a></li>`;
  })}</ul></nav>`;
}

/** Five segments, one per step, and a plain-words line: the same facts as the ticks, at a glance. */
function readyMeter(ctx: ViewCtx): SafeHtml {
  const flags = TABS.slice(1).map((t) => stepsDone(ctx)[t.key]);
  const n = flags.filter(Boolean).length;
  const label = ctx.ready.canPublish ? "Ready to launch" : n === 0 ? "Just getting started" : `${n} of ${flags.length} steps done`;
  return html`<div class="rail__ready${ctx.ready.canPublish ? " is-ready" : ""}"><p class="rail__ready-label">${label}</p><div class="segs" aria-hidden="true">${flags.map((on) => html`<span class="segs__s${on ? " is-on" : ""}"></span>`)}</div></div>`;
}

export function frame(ctx: ViewCtx, active: Tab, head: PageHead, content: SafeHtml): string {
  const biz = ctx.state.policy?.business;
  const label = TABS.find((t) => t.key === active)?.label ?? "";
  const body = html`<div class="app">
    <aside class="rail">
      <div class="rail__brand">${brand("/launch")}</div>
      <div class="rail__biz"><p class="rail__name">${biz?.name ?? "Your business"}</p><p class="rail__city">${biz?.city ?? "Setting up"}</p></div>
      ${nav(ctx, active)}
      ${readyMeter(ctx)}
      <p class="rail__foot"><a href="/launch/mine">${icon("overview")}My businesses</a><a href="/launch">${icon("plus")}New business</a></p>
    </aside>
    <div class="content">
      <header class="phead"><div class="phead__text"><h1 class="phead__title">${head.title}</h1>${head.lede ? html`<p class="phead__lede">${head.lede}</p>` : ""}</div>${head.actions ? html`<div class="phead__actions">${head.actions}</div>` : ""}</header>
      <main id="main" class="page" tabindex="-1">
        ${ctx.flash ? notice(ctx.flash.tone, ctx.flash.text) : ""}
        ${content}
      </main>
    </div>
  </div>`;
  return pageDocument({ title: `${label} · ${biz?.name ?? "AgentDoor"}`, body });
}
