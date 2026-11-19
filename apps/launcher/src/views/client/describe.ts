import { html, icon, raw, type SafeHtml } from "@agentdoor/ui";
import type { QuestionData } from "./api-types.js";
import {
  announce,
  api,
  createView,
  demoBanner,
  errorPanel,
  getLang,
  getSessionId,
  isReplayMode,
  mountChrome,
  onAction,
  pageTitle,
  pokeCost,
  setSessionId,
  t,
} from "./common.js";
import type { Key } from "./strings.js";

const MAX_CHARS = 6000;
const NEAR_LIMIT = 0.9;
const OTHER = "__other";
const MS_PER_S = 1000;

interface Answer {
  choice: string | null;
  other: string;
}
interface State {
  text: string;
  fixtureKey: string | null;
  demoLanguage: "en" | null;
  phase: "idle" | "compiling" | "questions" | "sending";
  questions: QuestionData[];
  answers: Record<string, Answer>;
  error: unknown;
  demo: boolean;
  startedAt: number;
}
const state: State = { text: "", fixtureKey: null, demoLanguage: null, phase: "idle", questions: [], answers: {}, error: null, demo: false, startedAt: 0 };
const app = document.getElementById("app")!;
let timer: number | undefined;

const CHIPS: { label: Key; text: Key }[] = [
  { label: "d.chip1", text: "d.chip1.text" },
  { label: "d.chip2", text: "d.chip2.text" },
  { label: "d.chip3", text: "d.chip3.text" },
  { label: "d.chip4", text: "d.chip4.text" },
  { label: "d.chip5", text: "d.chip5.text" },
];

function form(): SafeHtml {
  const busy = state.phase !== "idle";
  return html`<form class="ledger" id="describe-form" novalidate>
    <label class="big" for="story">${t("d.label")}</label>
    <textarea class="textarea" id="story" name="story" rows="9" maxlength="${MAX_CHARS}" lang="${getLang() === "hi" ? "hi" : "en"}" ${busy ? raw("readonly") : ""} aria-describedby="count-visible">${state.text}</textarea>
    <p class="counter" id="count-visible" aria-hidden="true">${t("d.count", { n: state.text.length, max: MAX_CHARS })}</p>
    <p class="visually-hidden" id="count-live" aria-live="polite"></p>
    <p class="chips-label" id="chips-label">${t("d.chips")}</p>
    <div class="promptchips" role="group" aria-labelledby="chips-label">
      ${CHIPS.map((c) => html`<button type="button" class="promptchip" data-action="chip" data-text-key="${c.text}" ${busy ? raw("disabled") : ""}>${t(c.label)}</button>`)}
    </div>
    <div class="actions">
      <button type="submit" class="btn btn--primary" id="read" ${busy ? raw('aria-disabled="true"') : ""}>${icon("receipt")}${t("d.read")}</button>
      <button type="button" class="btn btn--secondary" id="demo" data-action="demo" ${busy ? raw('aria-disabled="true"') : ""}>${t("d.demo")}</button>
    </div>
    <p class="alert alert--error" id="form-error" role="alert" hidden></p>
  </form>`;
}

function working(label: Key): SafeHtml {
  const s = Math.floor((Date.now() - state.startedAt) / MS_PER_S);
  return html`<div role="status" class="stack" id="working">
    <p class="working">${icon("spinner")}<span>${t(label)}</span><span class="working__time" id="elapsed">${t("d.elapsed", { s })}</span></p>
    <div class="skeleton" aria-hidden="true"><div class="skeleton__bar"></div><div class="skeleton__bar"></div><div class="skeleton__bar"></div></div>
  </div>`;
}

function questionCard(q: QuestionData, i: number): SafeHtml {
  const a = state.answers[q.id] ?? { choice: null, other: "" };
  return html`<fieldset class="question">
    <legend><span class="qcount" aria-hidden="true">${i + 1} / ${state.questions.length}</span>${q.text}</legend>
    <div class="choices">
      ${q.choices.map(
        (c, k) => html`<div class="choice">
          <input type="radio" id="q-${q.id}-${k}" name="q-${q.id}" value="${c}" data-qid="${q.id}" ${a.choice === c ? raw("checked") : ""}>
          <label for="q-${q.id}-${k}">${c}</label>
        </div>`,
      )}
      <div class="choice">
        <input type="radio" id="q-${q.id}-other" name="q-${q.id}" value="${OTHER}" data-qid="${q.id}" ${a.choice === OTHER ? raw("checked") : ""}>
        <label for="q-${q.id}-other">${t("d.q.other")}</label>
        <input type="text" class="input choice__value" id="q-${q.id}-text" data-other-for="${q.id}" aria-label="${t("d.q.otherLabel")}" maxlength="400" value="${a.other}">
      </div>
    </div>
  </fieldset>`;
}

function questionsView(): SafeHtml {
  const sending = state.phase === "sending";
  return html`<section class="questions" aria-labelledby="q-h">
    <div><h2 class="section-title" id="q-h" tabindex="-1">${t("d.q.title")}</h2><p class="pagehead__sub">${t("d.q.sub")}</p></div>
    ${state.questions.map(questionCard)}
    ${sending ? working("d.q.sending") : html`<div class="actions">
      <button type="button" class="btn btn--primary" id="continue" data-action="continue">${t("d.q.continue")}</button>
      <button type="button" class="btn btn--secondary" id="skip" data-action="skip">${t("d.q.skip")}</button>
    </div>`}
  </section>`;
}

function render(): SafeHtml {
  return html`${pageTitle(t("d.title"), t("d.sub"))}
    ${state.demo ? demoBanner() : ""}
    ${form()}
    ${state.phase === "compiling" ? html`<div class="questions">${working("d.reading")}</div>` : ""}
    ${state.error ? html`<div class="questions">${errorPanel(state.error, "read")}</div>` : ""}
    ${state.phase === "questions" || state.phase === "sending" ? questionsView() : ""}`;
}

const view = createView(app, render);

function tick(): void {
  const el = document.getElementById("elapsed");
  if (el) el.textContent = t("d.elapsed", { s: Math.floor((Date.now() - state.startedAt) / MS_PER_S) });
}

function formError(message: string): void {
  const el = document.getElementById("form-error");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

async function read(): Promise<void> {
  if (state.phase !== "idle") return;
  const text = state.text.trim();
  if (text === "") return formError(t("d.empty"));
  state.phase = "compiling";
  state.error = null;
  state.startedAt = Date.now();
  window.clearInterval(timer);
  timer = window.setInterval(tick, MS_PER_S);
  view.update();
  try {
    const language = state.demoLanguage ?? (getLang() === "en" ? "en" : getLang());
    const { sessionId } = await api<{ sessionId: string }>("POST", "/api/session", {
      language,
      transcript: text,
      ...(state.fixtureKey ? { fixtureKey: state.fixtureKey } : {}),
    });
    setSessionId(sessionId);
    const res = await api<{ compileResult: { questions: QuestionData[]; policy: { provenance: Record<string, unknown> } } }>("POST", `/api/session/${sessionId}/compile`);
    pokeCost();
    state.questions = res.compileResult.questions;
    if (state.questions.length === 0) return void location.assign("/rules");
    state.phase = "questions";
    announce(t("d.found", { n: Object.keys(res.compileResult.policy.provenance).length }));
  } catch (e) {
    state.error = e;
    state.phase = "idle";
  } finally {
    window.clearInterval(timer);
    view.update();
    if (state.phase === "questions") document.getElementById("q-h")?.focus();
  }
}

async function sendAnswers(): Promise<void> {
  const answers = state.questions.flatMap((q) => {
    const a = state.answers[q.id];
    const text = a?.choice === OTHER ? a.other.trim() : (a?.choice ?? "");
    return text ? [{ questionId: q.id, text }] : [];
  });
  if (answers.length === 0) return void location.assign("/rules");
  state.phase = "sending";
  state.startedAt = Date.now();
  window.clearInterval(timer);
  timer = window.setInterval(tick, MS_PER_S);
  view.update();
  try {
    await api("POST", `/api/session/${getSessionId() ?? ""}/answers`, { answers });
    pokeCost();
    location.assign("/rules");
  } catch (e) {
    state.error = e;
    state.phase = "questions";
    view.update();
  } finally {
    window.clearInterval(timer);
  }
}

function updateCounter(): void {
  const n = state.text.length;
  const visible = document.getElementById("count-visible");
  if (visible) visible.textContent = t("d.count", { n, max: MAX_CHARS });
  const live = document.getElementById("count-live");
  if (!live) return;
  // Announce only at 90% and 100% so a screen reader is not read every keystroke.
  if (n >= MAX_CHARS) live.textContent = t("d.count100", { max: MAX_CHARS });
  else if (n >= MAX_CHARS * NEAR_LIMIT) live.textContent = t("d.count90");
  else live.textContent = "";
}

onAction(app, (action, el) => {
  if (action === "chip") {
    const add = t(el.dataset.textKey as Key);
    state.text = `${state.text}${state.text && !state.text.endsWith("\n") && !state.text.endsWith(" ") ? "\n" : ""}${add}`.slice(0, MAX_CHARS);
    state.fixtureKey = null;
    state.demoLanguage = null;
    view.update();
    const box = document.getElementById("story") as HTMLTextAreaElement | null;
    box?.focus();
    box?.setSelectionRange(box.value.length, box.value.length);
  } else if (action === "demo") {
    if (state.phase !== "idle") return;
    void api<{ language: "en"; fixtureKey: string; transcript: string }>("GET", "/api/demo").then((d) => {
      state.text = d.transcript;
      state.fixtureKey = d.fixtureKey;
      state.demoLanguage = d.language;
      view.update();
      announce(t("d.demoLoaded"));
      document.getElementById("read")?.focus();
    });
  } else if (action === "continue") void sendAnswers();
  else if (action === "skip") location.assign("/rules");
  else if (action === "read") void read();
});

app.addEventListener("input", (ev) => {
  const el = ev.target as HTMLInputElement | HTMLTextAreaElement;
  if (el.id === "story") {
    state.text = el.value;
    state.fixtureKey = state.fixtureKey && el.value.trim() === "" ? null : state.fixtureKey;
    updateCounter();
  } else if (el.dataset.otherFor) {
    state.answers[el.dataset.otherFor] = { choice: OTHER, other: el.value };
  }
});
app.addEventListener("change", (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.type === "radio" && el.dataset.qid) {
    const prev = state.answers[el.dataset.qid];
    state.answers[el.dataset.qid] = { choice: el.value, other: prev?.other ?? "" };
  }
});
app.addEventListener("submit", (ev) => {
  ev.preventDefault();
  void read();
});
// "Read my rules" and "Use the demo" are aria-disabled while busy: swallow the click then.
app.addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLElement>('[aria-disabled="true"]');
  if (btn) ev.preventDefault();
});

mountChrome("describe", () => {
  view.update();
});
document.title = "AgentDoor";
void isReplayMode().then((replay) => {
  state.demo = replay;
  view.update();
});
view.update();
