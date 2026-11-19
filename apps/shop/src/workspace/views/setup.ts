import { html, type SafeHtml } from "@agentdoor/ui";
import { LIMITS } from "../config.js";
import { answeredCount, nextQuestion } from "../questions.js";
import { failedCard, jobCard } from "./progress.js";
import { frame, type ViewCtx } from "./frame.js";
import { summarize } from "./describe.js";
import { icon } from "./icons.js";
import { postForm } from "./kit.js";

/** "Your business so far": the five facts an owner checks first, always in view while setting up. */
export function summaryCard(ctx: ViewCtx): SafeHtml {
  const p = ctx.state.policy;
  if (!p) {
    return html`<aside class="card summary" aria-label="Your business so far"><h2 class="card__title">Your business so far</h2><p class="muted">Nothing yet. Your details appear here as soon as your description has been read.</p></aside>`;
  }
  const s = summarize(p);
  const rows: [string, string][] = [
    ["Name", s.name],
    ["City", s.location],
    ["Products", String(s.products)],
    ["Delivery", s.areas],
    ["Capacity", s.capacity],
  ];
  return html`<aside class="card summary" aria-label="Your business so far"><h2 class="card__title">Your business so far</h2>
    <dl class="facts">${rows.map(([k, v]) => html`<div class="facts__row"><dt>${k}</dt><dd>${v}</dd></div>`)}</dl></aside>`;
}

const assistant = (inner: SafeHtml): SafeHtml => html`<div class="msg msg--ai"><span class="msg__avatar">${icon("sparkle")}</span><div class="msg__bubble">${inner}</div></div>`;
const owner = (text: string): SafeHtml => html`<div class="msg msg--me"><div class="msg__bubble">${text}</div></div>`;

function progress(n: number, total: number): SafeHtml {
  const segs = Array.from({ length: total }, (_, i) => html`<span class="segs__s${i < n - 1 ? " is-on" : i === n - 1 ? " is-now" : ""}"></span>`);
  return html`<div class="chat__progress"><p class="eyebrow">Question ${n} of ${total}</p><div class="segs" aria-hidden="true">${segs}</div></div>`;
}

function history(ctx: ViewCtx): SafeHtml {
  const { state } = ctx;
  const past = state.questions.filter((q) => state.answers[q.id] !== undefined);
  return html`${past.map((q) => html`${assistant(html`${q.text}`)}${owner(state.answers[q.id] ?? "")}`)}`;
}

function answerForm(ctx: ViewCtx, q: NonNullable<ReturnType<typeof nextQuestion>>): SafeHtml {
  const chips = q.choices.map((c, i) => html`<label class="chip"><input type="radio" name="answer" value="${c}" id="c${i}"><span>${c}</span></label>`);
  const typed = q.choices.length > 0
    ? html`<fieldset class="chips"><legend class="sr-only">Choose an answer</legend>${chips}</fieldset>
      <div class="field field--inline"><label for="other">Or say it your way</label><input id="other" class="input" name="other" maxlength="${LIMITS.maxAnswerChars}" autocomplete="off"></div>`
    : html`<div class="field"><label class="sr-only" for="free">Your answer</label><input id="free" class="input" name="answer" maxlength="${LIMITS.maxAnswerChars}" required autocomplete="off" placeholder="Type your answer"></div>`;
  return postForm(`${ctx.base}/setup/answer`, html`<input type="hidden" name="questionId" value="${q.id}">${typed}<div class="row"><button class="btn btn--primary" type="submit">Continue${icon("arrow")}</button></div>`, "answer");
}

function questionCard(ctx: ViewCtx): SafeHtml {
  const { state } = ctx;
  const q = nextQuestion(state);
  if (!q) return html``;
  const skip = postForm(`${ctx.base}/setup/skip`, html`<button class="link link--quiet" type="submit">Skip the rest${answeredCount(state) > 0 ? " and use my answers" : ""}</button>`, "skiprest");
  return html`<section class="chat" aria-labelledby="q-h">
    ${progress(answeredCount(state) + 1, state.questions.length)}
    <div class="chat__thread">${history(ctx)}${assistant(html`<h2 id="q-h" class="question__text">${q.text}</h2>`)}</div>
    <div class="chat__reply">${answerForm(ctx, q)}${skip}</div>
  </section>`;
}

const applyCard = (ctx: ViewCtx): SafeHtml =>
  html`<section class="card"><h2 class="card__title">All answered</h2><p class="muted">Apply your answers to update the business.</p>
    ${postForm(`${ctx.base}/setup/apply`, html`<button class="btn btn--primary" type="submit">Update my business</button>`)}</section>`;

const doneCard = (ctx: ViewCtx): SafeHtml =>
  html`<section class="done"><span class="done__icon">${icon("check")}</span><div><h2 class="done__title">Setup complete</h2><p>Your business is set up. Check your products and rules, then rehearse it against tough customers.</p>
    <p class="row"><a class="btn btn--primary" href="${ctx.base}/products">Review products${icon("arrow")}</a><a class="btn" href="${ctx.base}/rules">Review rules</a></p></div></section>`;

const describeAgain = (ctx: ViewCtx): SafeHtml =>
  postForm(
    `${ctx.base}/retry`,
    html`<div class="field"><label for="desc">Your description</label><textarea id="desc" class="input input--area" name="description" rows="5" maxlength="${LIMITS.maxDescriptionChars}" required>${ctx.state.description}</textarea></div>
    <button class="btn btn--primary" type="submit">${icon("retry")}Retry</button>`,
  );

function main(ctx: ViewCtx): SafeHtml {
  const { state, job } = ctx;
  if (job && (job.status === "queued" || job.status === "running")) return jobCard(ctx, job);
  if (!state.policy) {
    if (job?.status === "failed") return failedCard(ctx, job, describeAgain(ctx));
    return html`<section class="card"><h2 class="card__title">Ready when you are</h2>${describeAgain(ctx)}</section>`;
  }
  const failed = job?.status === "failed" && (job.kind === "clarify" || job.kind === "compile") ? failedCard(ctx, job) : html``;
  if (nextQuestion(state)) return html`${failed}${questionCard(ctx)}`;
  if (state.questions.length > 0 && !state.questionsClosed) return html`${failed}${applyCard(ctx)}`;
  return html`${failed}${doneCard(ctx)}`;
}

export function setupPage(ctx: ViewCtx): string {
  const head = { title: "Setup", lede: "A few quick questions so your shop gets the details right." };
  return frame(ctx, "setup", head, html`<div class="split"><div class="split__main">${main(ctx)}</div>${summaryCard(ctx)}</div>`);
}
