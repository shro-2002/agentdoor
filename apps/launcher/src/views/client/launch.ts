import { doorGate, html, icon, stepTimeline, type SafeHtml } from "@agentdoor/ui";
import type { DeployData, GateData } from "./api-types.js";
import {
  announce,
  api,
  copyText,
  createView,
  errorPanel,
  getSessionId,
  mountChrome,
  onAction,
  pageTitle,
  pokeCost,
  t,
} from "./common.js";
import type { Key } from "./strings.js";

const POLL_MS = 700;
const MS_PER_S = 1000;
const RULES_CHECKS = new Set(["rules_approved", "coverage", "policy_valid"]);

interface State {
  sid: string | null;
  gate: GateData | null;
  job: DeployData | null;
  error: unknown;
  busy: boolean;
}
const state: State = { sid: getSessionId(), gate: null, job: null, error: null, busy: false };
const app = document.getElementById("app")!;
const typed = (key: string): Key => key as Key;
const seconds = (ms: number | null): string | undefined => (ms === null ? undefined : `${(ms / MS_PER_S).toFixed(1)} s`);

function checklist(g: GateData): { ok: boolean; label: string; detail?: string }[] {
  const ok = (id: string): boolean => g.checks.find((c) => c.id === id)?.ok ?? false;
  return [
    { ok: ok("rules_approved"), label: t("l.rules", { a: g.approvals.approved, b: g.approvals.required }) },
    { ok: ok("rehearsal_current") && ok("no_critical_open") && ok("no_failures"), label: t("l.rehearsal") },
    { ok: ok("coverage") && ok("policy_valid"), label: t("g.check.coverage"), detail: t("l.fp.detail", { h: g.policyHash.slice(0, 12), v: g.policyVersion }) },
    { ok: true, label: t("l.domain") },
    { ok: true, label: t("l.mailbox") },
    { ok: true, label: t("l.noHaggle") },
  ];
}

function blockers(g: GateData): SafeHtml {
  const failing = g.checks.filter((c) => !c.ok);
  if (failing.length === 0) return html``;
  return html`<div>
    <p><strong>${t("l.blocked")}</strong></p>
    <ul class="blocked-list">
      ${failing.map((c) => html`<li><a href="${RULES_CHECKS.has(c.id) ? "/rules" : "/rehearsal"}">${t(typed(`g.check.${c.id}`))}</a></li>`)}
    </ul>
  </div>`;
}

function fingerprint(g: GateData): SafeHtml {
  return html`<div class="fingerprint">
    <span>${t("l.fp")}:</span>
    <code id="fingerprint">${g.policyHash}</code>
    <button type="button" class="btn btn--secondary" data-action="copy" data-text="${g.policyHash}">${icon("copy")}${t("common.copy")}</button>
  </div>`;
}

function launchBox(g: GateData): SafeHtml {
  const launching = state.busy || state.job?.status === "running";
  return html`<div class="launchbox">
    <p class="alert alert--note">${icon("alert")}<span>${t("l.stub")}</span></p>
    ${fingerprint(g)}
    <p>${t("l.consent")}</p>
    <button type="button" class="btn btn--primary" id="launch" data-action="launch" aria-disabled="${String(!g.canLaunch || launching)}" aria-describedby="launch-why">${icon("door")}${launching ? t("l.launching") : state.job ? t("l.again") : t("l.launch")}</button>
    <div id="launch-why">${g.canLaunch ? "" : blockers(g)}</div>
  </div>`;
}

function timeline(j: DeployData): SafeHtml {
  const failed = j.status === "failed";
  return html`<section aria-labelledby="steps-h">
    <h2 class="section-title" id="steps-h">${t("l.stepsTitle")}</h2>
    <label class="visually-hidden" for="launch-progress">${t("l.progress")}</label>
    <progress id="launch-progress" max="${j.steps.length}" value="${j.steps.filter((s) => s.state === "done").length}"></progress>
    <p></p>
    ${stepTimeline({
      steps: j.steps.map((s) => ({ id: s.id, label: t(typed(`l.step.${s.id}`)), state: s.state, ...(seconds(s.ms) ? { elapsed: seconds(s.ms)! } : {}) })),
      labels: { waiting: t("l.state.waiting"), running: t("l.state.running"), done: t("l.state.done"), failed: t("l.state.failed"), retry: t("l.retry") },
    })}
    <p class="hint"><strong>${t("l.log")}</strong></p>
    <pre class="log" tabindex="0" aria-label="${t("l.log")}">${j.log.join("\n")}</pre>
    ${failed ? html`<p class="alert alert--error" role="alert">${icon("alert")}<span>${t("l.failed")}</span></p>` : ""}
  </section>`;
}

function results(j: DeployData): SafeHtml {
  const r = j.result;
  if (!r) return html``;
  return html`<div class="result-cards">
    <p class="banner banner--clean">${icon("check")}<span>${t("l.done")}</span></p>
    <section class="result-card" aria-labelledby="url-h">
      <h3 id="url-h">${icon("globe")} ${t("l.url.title")}</h3>
      <div class="urlbox"><code>${r.url}</code>
        <button type="button" class="btn btn--secondary" data-action="copy" data-text="${r.url}">${icon("copy")}${t("common.copy")}</button>
        <a class="btn btn--primary" href="${r.url}" rel="noopener noreferrer" target="_blank">${t("l.url.open")}</a></div>
      <p class="hint">${t("l.url.note")}</p>
    </section>
    <section class="result-card" aria-labelledby="ai-h">
      <h3 id="ai-h">${t("l.ai.title")}</h3>
      <div class="urlbox"><span>${t("l.ai.url")}:</span><code>${r.mcpUrl}</code>
        <button type="button" class="btn btn--secondary" data-action="copy" data-text="${r.mcpUrl}">${icon("copy")}${t("common.copy")}</button></div>
      <ol><li>${t("l.ai.s1")}</li><li>${t("l.ai.s2")}</li><li>${t("l.ai.s3")}</li></ol>
    </section>
    <section class="result-card" aria-labelledby="owner-h">
      <h3 id="owner-h">${t("l.owner.title")}</h3>
      <p><a class="btn btn--secondary" href="${r.ownerUrl}" rel="noopener noreferrer" target="_blank">${t("l.owner.link")}</a></p>
      <p class="hint">${t("l.owner.note")}</p>
    </section>
  </div>`;
}

function render(): SafeHtml {
  const g = state.gate;
  const head = pageTitle(t("l.title"), t("l.sub"));
  if (!state.sid) return html`${head}<p class="alert alert--note">${icon("alert")}<span>${t("common.noSession")} <a href="/">${t("common.startOver")}</a></span></p>`;
  if (state.error) return html`${head}${errorPanel(state.error, "reload")}`;
  if (!g) return html`${head}<p class="working">${icon("spinner")}<span>${t("common.loading")}</span></p>`;
  const blocked = g.checks.filter((c) => !c.ok).length;
  return html`${head}
    <div class="launch-grid">
      <div>${doorGate({
        open: g.canLaunch,
        title: g.canLaunch ? t("l.door.open") : t("l.door.locked"),
        badge: g.canLaunch ? t("l.door.ready") : blocked === 1 ? t("l.door.blocked1") : t("l.door.blocked", { n: blocked }),
        checklist: checklist(g),
      })}</div>
      <div>${launchBox(g)}</div>
    </div>
    ${state.job ? html`<div class="stack">${timeline(state.job)}${results(state.job)}</div>` : ""}`;
}

const view = createView(app, render);

async function load(): Promise<void> {
  if (!state.sid) return view.update();
  try {
    state.error = null;
    state.gate = await api<GateData>("GET", `/api/session/${state.sid}/gate`);
  } catch (e) {
    state.error = e;
  }
  view.update();
}

async function launch(): Promise<void> {
  if (!state.gate?.canLaunch || state.busy || state.job?.status === "running") return;
  state.busy = true;
  state.job = null;
  view.update();
  try {
    const { jobId } = await api<{ jobId: string }>("POST", `/api/session/${state.sid}/deploy`, { consent: true });
    for (;;) {
      state.job = await api<DeployData>("GET", `/api/deploy/${jobId}`);
      view.update();
      if (state.job.status !== "running") break;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    announce(state.job.status === "done" ? t("l.done") : t("l.failed"));
    pokeCost();
  } catch (e) {
    state.error = e;
  } finally {
    state.busy = false;
    view.update();
  }
}

onAction(app, (action, el, ev) => {
  if (action === "launch") {
    ev.preventDefault();
    void launch();
  } else if (action === "retry-step") void launch();
  else if (action === "reload") void load();
  else if (action === "copy") copyText(el.dataset.text ?? "");
});

mountChrome("launch", () => {
  document.title = `${t("l.title")} · AgentDoor`;
  view.update();
});
document.title = `${t("l.title")} · AgentDoor`;
void load();
