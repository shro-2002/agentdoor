import { html, type SafeHtml } from "@agentdoor/ui";
import { answeredCount, nextQuestion } from "../questions.js";
import { frame, failedCard, jobCard, type ViewCtx } from "./frame.js";
import { badge } from "./kit.js";
import { summaryCard } from "./setup.js";

interface Step {
  label: string;
  href: string;
  detail: string;
  state: "done" | "todo" | "wait";
}

function steps(ctx: ViewCtx): Step[] {
  const { state, ready, base } = ctx;
  const left = state.questions.length - answeredCount(state);
  const setupDone = state.policy !== null && nextQuestion(state) === null;
  const approved = ready.approvals.approved === ready.approvals.required && ready.approvals.required > 0;
  return [
    {
      label: "Setup",
      href: `${base}/setup`,
      detail: !state.policy ? "Claude is reading your description" : left > 0 && !state.questionsClosed ? `${left} ${left === 1 ? "question" : "questions"} to answer` : "Done",
      state: setupDone ? "done" : "todo",
    },
    { label: "Products", href: `${base}/products`, detail: state.policy ? `${state.policy.catalog.length} listed` : "After setup", state: state.policy ? "done" : "wait" },
    { label: "Rules", href: `${base}/rules`, detail: state.policy ? `${ready.approvals.approved} of ${ready.approvals.required} approved` : "After setup", state: approved ? "done" : state.policy ? "todo" : "wait" },
    {
      label: "Rehearse",
      href: `${base}/rehearse`,
      detail: !state.policy ? "After setup" : !ready.hasRun ? "Not run yet" : ready.canPublish ? "All clear" : ready.blockers[0] ?? "Open items",
      state: ready.canPublish ? "done" : state.policy ? "todo" : "wait",
    },
    { label: "Storefront", href: `${base}/storefront`, detail: ctx.previewPath ? "Preview ready" : "Preview and publish", state: ctx.previewPath ? "done" : "wait" },
  ];
}

function stepList(ctx: ViewCtx): SafeHtml {
  return html`<section class="card" aria-labelledby="steps-h"><h2 id="steps-h" class="card__title">Next steps</h2>
    <ol class="steps">${steps(ctx).map((s) => html`<li class="step step--${s.state}"><a href="${s.href}"><span class="step__label">${s.label}</span><span class="step__detail">${s.detail}</span>${s.state === "done" ? badge("ok", "Done") : ""}</a></li>`)}</ol>
  </section>`;
}

export function overviewPage(ctx: ViewCtx): string {
  const { job } = ctx;
  const running = job && (job.status === "queued" || job.status === "running");
  const failed = job && job.status === "failed" ? failedCard(ctx, job) : html``;
  return frame(ctx, "overview", "Overview", html`<div class="split"><div class="split__main">${running ? jobCard(ctx, job) : failed}${stepList(ctx)}</div>${summaryCard(ctx)}</div>`);
}
