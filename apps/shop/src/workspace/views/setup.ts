import { html, type SafeHtml } from "@agentdoor/ui";
import { LIMITS } from "../config.js";
import { answeredCount, nextQuestion } from "../questions.js";
import { frame, failedCard, jobCard, type ViewCtx } from "./frame.js";
import { summarize } from "./describe.js";
import { badge, postForm } from "./kit.js";

/** "Your business so far": five facts, always on the screen while setting up. */
export function summaryCard(ctx: ViewCtx): SafeHtml {
  const p = ctx.state.policy;
  if (!p) {
    return html`<aside class="card summary" aria-label="Your business so far"><p class="card__title">Your business so far</p><p class="muted">Nothing yet. Your details appear here as soon as Claude has read your description.</p></aside>`;
  }
  const s = summarize(p);
  const rows: [string, string][] = [
    ["Name", s.name],
    ["Location", s.location],
    ["Products", String(s.products)],
    ["Delivery areas", s.areas],
    ["Capacity", s.capacity],
  ];
  return html`<aside class="card summary" aria-label="Your business so far">
    <p class="card__title">Your business so far</p>
    <dl class="facts">${rows.map(([k, v]) => html`<div class="facts__row"><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
  </aside>`;
}

function questionCard(ctx: ViewCtx): SafeHtml {
  const { state } = ctx;
  const q = nextQuestion(state);
  if (!q) return html``;
  const total = state.questions.length;
  const n = answeredCount(state) + 1;
  const chips = q.choices.map(
    (c, i) => html`<label class="chip"><input type="radio" name="answer" value="${c}" id="c${i}"><span>${c}</span></label>`,
  );
  return html`<section class="card question" aria-labelledby="q-h">
    <p class="eyebrow">Question ${n} of ${total}</p>
    <h2 id="q-h" class="question__text">${q.text}</h2>
    ${postForm(
      `${ctx.base}/setup/answer`,
      html`<input type="hidden" name="questionId" value="${q.id}">
      ${q.choices.length > 0
        ? html`<fieldset class="chips"><legend class="sr-only">Choose an answer</legend>${chips}</fieldset>
          <div class="field"><label for="other">Or say it your way</label><input id="other" class="input" name="other" maxlength="${LIMITS.maxAnswerChars}" autocomplete="off"></div>`
        : html`<div class="field"><label class="sr-only" for="free">Your answer</label><input id="free" class="input" name="answer" maxlength="${LIMITS.maxAnswerChars}" required autocomplete="off" placeholder="Type your answer"></div>`}
      <div class="row"><button class="btn btn--primary" type="submit">Continue</button></div>`,
      "question__form",
    )}
    ${postForm(`${ctx.base}/setup/skip`, html`<button class="link link--quiet" type="submit">Skip the rest${answeredCount(state) > 0 ? " and use my answers" : ""}</button>`, "skiprest")}
  </section>`;
}

function applyCard(ctx: ViewCtx): SafeHtml {
  return html`<section class="card">
    <p class="card__title">All answered</p>
    <p class="muted">Apply your answers to update the business.</p>
    ${postForm(`${ctx.base}/setup/apply`, html`<button class="btn btn--primary" type="submit">Update my business</button>`)}
  </section>`;
}

function doneCard(ctx: ViewCtx): SafeHtml {
  return html`<section class="card card--ok">
    <p class="card__title">${badge("ok", "Setup complete")}</p>
    <p>Your business is set up. Check your products and rules, then rehearse.</p>
    <p class="row"><a class="btn btn--primary" href="${ctx.base}/products">Review products</a><a class="btn" href="${ctx.base}/rules">Review rules</a></p>
  </section>`;
}

function describeAgain(ctx: ViewCtx): SafeHtml {
  return html`${postForm(
    `${ctx.base}/retry`,
    html`<div class="field"><label for="desc">Your description</label><textarea id="desc" class="input input--area" name="description" rows="5" maxlength="${LIMITS.maxDescriptionChars}" required>${ctx.state.description}</textarea></div>
    <button class="btn btn--primary" type="submit">Try again</button>`,
  )}`;
}

function main(ctx: ViewCtx): SafeHtml {
  const { state, job } = ctx;
  const running = job && (job.status === "queued" || job.status === "running");
  if (running) return jobCard(ctx, job);
  if (!state.policy) {
    if (job?.status === "failed") return html`<section class="card card--bad" role="alert"><p class="card__title">That did not finish</p><p>${job.errorMessage}</p>${describeAgain(ctx)}</section>`;
    return html`<section class="card"><p class="card__title">Ready when you are</p>${describeAgain(ctx)}</section>`;
  }
  const failed = job?.status === "failed" && (job.kind === "clarify" || job.kind === "compile") ? failedCard(ctx, job) : html``;
  if (nextQuestion(state)) return html`${failed}${questionCard(ctx)}`;
  if (state.questions.length > 0 && !state.questionsClosed) return html`${failed}${applyCard(ctx)}`;
  return html`${failed}${doneCard(ctx)}`;
}

export function setupPage(ctx: ViewCtx): string {
  return frame(ctx, "setup", "Setup", html`<div class="split"><div class="split__main">${main(ctx)}</div>${summaryCard(ctx)}</div>`);
}
