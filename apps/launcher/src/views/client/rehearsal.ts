import { doorGate, gapCard, html, icon, receiptGroups, receiptSlip, type SafeHtml } from "@agentdoor/ui";
import type { GapCardData, GateData, RunData } from "./api-types.js";
import {
  ApiError,
  announce,
  api,
  cardLang,
  createView,
  errorPanel,
  getSessionId,
  isReplayMode,
  demoBanner,
  mountChrome,
  onAction,
  pageTitle,
  pokeCost,
  t,
} from "./common.js";
import type { Key } from "./strings.js";

const POLL_MS = 700;
const PHASE_PERCENT = { starting: 5, probes: 25, scenarios: 55, classifying: 85, done: 100 } as const;

interface State {
  sid: string | null;
  run: RunData | null;
  gate: GateData | null;
  error: unknown;
  starting: boolean;
  applied: Record<string, string>;
  demo: boolean;
}

const state: State = { sid: getSessionId(), run: null, gate: null, error: null, starting: false, applied: {}, demo: false };
const app = document.getElementById("app")!;
let pollToken = 0;

const typed = (key: string): Key => key as Key;

function openCards(): GapCardData[] {
  return (state.run?.cards ?? []).filter((c) => !c.dismissed);
}

function receiptView(run: NonNullable<RunData["result"]>, cards: GapCardData[]): SafeHtml {
  const groups = receiptGroups(run, cards, {
    groupTitles: {
      timing: t("g.group.timing"),
      capacity: t("g.group.capacity"),
      delivery: t("g.group.delivery"),
      prices: t("g.group.prices"),
      tricky: t("g.group.tricky"),
      rules: t("g.group.rules"),
    },
    morePass: (n) => t("g.more", { n }),
    scenarioOutcome: (o) => t(typed(`g.o.${o}`)),
  });
  const when = new Date(run.ranAt).toISOString().slice(0, 16).replace("T", " ");
  return receiptSlip({
    title: t("g.receiptTitle"),
    subtitle: `${run.policyHash.slice(0, 12)} · v${run.policyVersion} · ${when} UTC`,
    groups,
    totals: { pass: run.summary.passed, gap: run.gaps.filter((g) => !g.dismissed).length, failed: run.summary.probesFailed },
    labels: { pass: t("g.pass"), gap: t("g.gap"), failed: t("g.failed"), seeFix: t("g.seeFix"), total: t("g.total") },
  });
}

function banner(run: NonNullable<RunData["result"]>, gate: GateData | null, stale: boolean): SafeHtml {
  const open = openCards().length;
  if (run.summary.probesFailed > 0)
    return html`<p class="banner banner--failed">${icon("alert")}<span>${t("g.bannerFailed", { n: run.summary.probesFailed })}</span></p>`;
  if (stale) return html`<p class="banner banner--stale">${icon("clock")}<span>${t("g.bannerStale")}</span></p>`;
  if (gate?.canLaunch) return html`<p class="banner banner--clean">${icon("check")}<span>${t("g.bannerClean")}</span></p>`;
  if (open > 0)
    return html`<p class="banner banner--gaps">${icon("alert")}<span>${open === 1 ? t("g.bannerGaps1") : t("g.bannerGaps", { n: open })}</span></p>`;
  return html`<p class="banner banner--stale">${icon("alert")}<span>${t("g.bannerRules")} <a href="/rules">${t("g.fixRules")}</a></span></p>`;
}

function doorView(run: NonNullable<RunData["result"]>, gate: GateData | null, stale: boolean): SafeHtml {
  const open = Boolean(gate?.canLaunch) && !stale;
  const gaps = openCards().filter((c) => !state.applied[c.gapId]).length;
  // With no gap card left to blame, the open items are the failing gate checks (e.g. unapproved rules).
  const blockers = gaps > 0 ? gaps : (gate?.checks.filter((c) => !c.ok).length ?? run.summary.criticalOpen);
  const badge = stale ? t("g.door.stale") : open ? t("g.door.ready") : blockers === 1 ? t("g.door.gaps1") : t("g.door.gaps", { n: blockers });
  return doorGate({
    open,
    title: open ? t("g.door.open") : t("g.door.locked"),
    badge,
    checklist: (gate?.checks ?? []).map((c) => ({ ok: c.ok && !stale, label: t(typed(`g.check.${c.id}`)) })),
  });
}

function counters(run: NonNullable<RunData["result"]>): SafeHtml {
  const gaps = run.gaps.filter((g) => !g.dismissed).length;
  return html`<dl class="counters" aria-label="${t("g.counters")}">
    <div class="counter-tile counter-tile--pass"><dt>${t("g.pass")}</dt><dd>${run.summary.passed}</dd></div>
    <div class="counter-tile counter-tile--gap"><dt>${t("g.gap")}</dt><dd>${gaps}</dd></div>
    <div class="counter-tile counter-tile--failed"><dt>${t("g.failed")}</dt><dd>${run.summary.probesFailed}</dd></div>
  </dl>`;
}

function gapSection(): SafeHtml {
  const cards = openCards();
  if (cards.length === 0) return html``;
  return html`<section class="gaps" aria-labelledby="gaps-h">
    <h2 class="section-title" id="gaps-h">${t("g.gapsTitle")}</h2>
    <div class="gaps-list">
      ${cards.map((c) =>
        state.applied[c.gapId]
          ? html`<article class="gap gap--done" id="gap-done-${c.gapId.replace(/[^A-Za-z0-9]+/g, "-")}">${icon("check")}<p>${t("g.applied", { label: state.applied[c.gapId] ?? "" })}</p></article>`
          : gapCard({
              ...c,
              labels: {
                apply: t("g.apply"),
                example: t("g.example"),
                critical: t("g.critical"),
                warning: t("g.warning"),
                choose: t("g.choose"),
                number: t("g.number"),
              },
            }),
      )}
    </div>
  </section>`;
}

function finished(run: NonNullable<RunData["result"]>): SafeHtml {
  const stale = Boolean(state.gate?.rehearsal.stale);
  const canLaunch = Boolean(state.gate?.canLaunch) && !stale;
  return html`${banner(run, state.gate, stale)}
    <div class="rehearsal-grid">
      <div>${receiptView(run, state.run?.cards ?? [])}</div>
      <div class="rehearsal-side">${counters(run)}${doorView(run, state.gate, stale)}</div>
    </div>
    <div class="rehearsal-actions">
      <button type="button" class="btn ${stale ? "btn--primary" : "btn--secondary"}" data-action="run" id="run-again">${t("g.runAgain")}</button>
      ${canLaunch ? html`<a class="btn btn--primary" href="/launch" id="go-launch">${t("g.goLaunch")}</a>` : ""}
    </div>
    ${gapSection()}`;
}

function running(): SafeHtml {
  const phase = state.run?.progress.phase ?? "starting";
  const pct = PHASE_PERCENT[phase];
  return html`<div class="runbox">
    <p class="working">${icon("spinner")}<span>${t("g.running")}</span></p>
    <label class="visually-hidden" for="run-progress">${t("g.progress")}</label>
    <progress id="run-progress" max="100" value="${pct}" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-valuetext="${t(typed(`g.phase.${phase}`))}"></progress>
    <p class="working__time">${t(typed(`g.phase.${phase}`))}</p>
  </div>
  <div class="skeleton" aria-hidden="true"><div class="skeleton__bar"></div><div class="skeleton__bar"></div><div class="skeleton__bar"></div></div>`;
}

function render(): SafeHtml {
  let body: SafeHtml;
  if (!state.sid) body = html`<p class="alert alert--note">${icon("alert")}<span>${t("common.noSession")} <a href="/">${t("common.startOver")}</a></span></p>`;
  else if (state.error) body = errorPanel(state.error, "run");
  else if (state.run?.status === "done" && state.run.result) body = finished(state.run.result);
  else body = running();
  return html`${pageTitle(t("g.title"), t("g.sub"))}${state.demo ? demoBanner() : ""}${body}`;
}

const view = createView(app, render);

async function poll(runId: string, token: number): Promise<void> {
  while (token === pollToken) {
    const run = await api<RunData>("GET", `/api/runs/${runId}?lang=${cardLang()}`);
    state.run = run;
    if (run.status === "failed") throw new ApiError(run.error?.code ?? "FAILED", run.error?.message ?? t("g.failedRun"), "", 500);
    if (run.status === "done") return;
    view.update();
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function start(): Promise<void> {
  if (!state.sid || state.starting) return;
  const token = ++pollToken;
  state.starting = true;
  state.error = null;
  state.run = null;
  state.applied = {};
  view.update();
  try {
    const { runId } = await api<{ runId: string }>("POST", `/api/session/${state.sid}/rehearse`);
    await poll(runId, token);
    if (token !== pollToken) return;
    state.gate = await api<GateData>("GET", `/api/session/${state.sid}/gate`);
    const r = (state as State).run?.result;
    if (r) announce(t("g.done", { p: r.summary.passed, g: r.gaps.filter((g) => !g.dismissed).length }));
    pokeCost();
  } catch (e) {
    state.error = e;
  } finally {
    state.starting = false;
    view.update();
  }
}

async function refreshRun(): Promise<void> {
  if (state.run?.status !== "done" || !state.sid) return;
  try {
    state.run = await api<RunData>("GET", `/api/runs/${state.run.runId}?lang=${cardLang()}`);
  } catch (e) {
    state.error = e;
  }
  view.update();
}

async function applyFix(form: HTMLFormElement): Promise<void> {
  const gapId = form.dataset.gapId ?? "";
  const errorEl = form.querySelector<HTMLElement>(".gap__error")!;
  const picked = form.querySelector<HTMLInputElement>('input[type="radio"]:checked');
  const fail = (msg: string): void => {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  };
  if (!picked) return fail(t("g.pick"));
  let value: number | undefined;
  if (picked.dataset.needsValue === "1") {
    const input = form.querySelector<HTMLInputElement>(`[data-value-for="${CSS.escape(picked.value)}"]`);
    value = input && input.value !== "" ? Number(input.value) : undefined;
    if (value === undefined || !Number.isInteger(value) || value < 1) return fail(t("g.needNumber"));
  }
  const label = form.querySelector<HTMLLabelElement>(`label[for="${picked.id}"]`)?.textContent ?? picked.value;
  try {
    await api("POST", `/api/session/${state.sid}/gaps/${encodeURIComponent(gapId)}/fix`, { choice: picked.value, ...(value === undefined ? {} : { value }) });
    state.applied[gapId] = label;
    state.gate = await api<GateData>("GET", `/api/session/${state.sid}/gate`);
    announce(t("g.appliedAnnounce"));
    view.update();
    document.getElementById("run-again")?.focus();
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
}

onAction(app, (action) => {
  if (action === "run") void start();
});
app.addEventListener("submit", (ev) => {
  const form = (ev.target as HTMLElement).closest<HTMLFormElement>("form.gap__form");
  if (!form) return;
  ev.preventDefault();
  void applyFix(form);
});

mountChrome("rehearsal", () => {
  document.title = `${t("g.title")} · AgentDoor`;
  void refreshRun();
  view.update();
});
document.title = `${t("g.title")} · AgentDoor`;
void isReplayMode().then((replay) => {
  state.demo = replay;
  view.update();
});
void start();
