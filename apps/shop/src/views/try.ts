import type { BusinessPolicy, EngineResult } from "@agentdoor/core";
import {
  PROVENANCE_ORDER,
  doorGate,
  gapCard,
  html,
  icon,
  provenanceBadge,
  raw,
  receiptGroups,
  receiptSlip,
  statusChip,
  stepTimeline,
  type SafeHtml,
} from "@agentdoor/ui";
import type { GateCheck, LiveRun } from "../services/try-live.js";
import { decisionFor } from "../services/try-live.js";
import type { TrySession } from "../services/try-session.js";
import { inr, isoDay, shortDate } from "./format.js";
import { gapWords } from "./gap-words.js";
import { layout } from "./layout.js";
import { OTHER_AREA, problemsFor } from "./order.js";
import { ruleGroups } from "./rules-view.js";

export type TryStep = "describe" | "rules" | "rehearse" | "launch";
const STEPS: { id: TryStep; label: string }[] = [
  { id: "describe", label: "Describe" },
  { id: "rules", label: "Rules" },
  { id: "rehearse", label: "Rehearsal" },
  { id: "launch", label: "Launch" },
];

const VIDEO_TITLE = "AgentDoor demo: from a baker's own words to a live, rehearsed shop";
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** `DEMO_VIDEO_ID` is optional config; anything that is not a plain 11-character id is treated as unset. */
export const videoIdFrom = (env: string | undefined): string | null => (env && YOUTUBE_ID_RE.test(env) ? env : null);

function tryNav(active: TryStep | "intro"): SafeHtml {
  const at = STEPS.findIndex((s) => s.id === active);
  return html`<nav class="trynav" aria-label="Replay navigation">
    <div class="wrap trynav__row">
      <a class="trynav__brand" href="/try">${icon("door")}<span>AgentDoor replay</span></a>
      <ul class="trynav__links">
        <li><a href="/">Storefront</a></li>
        <li><a href="/launch-report">Launch report</a></li>
        <li><a href="/try#demo">Watch demo</a></li>
      </ul>
      <ol class="trynav__steps" aria-label="Replay steps">
        ${STEPS.map((s, i) => html`<li class="${i < at ? "is-done" : ""}"><a href="/try/${s.id}" ${s.id === active ? raw('aria-current="step"') : ""}><span class="trynav__n" aria-hidden="true">${i + 1}</span>${s.label}</a></li>`)}
      </ol>
    </div>
  </nav>`;
}

function page(title: string, active: TryStep | "intro", body: SafeHtml, shopName?: string): string {
  return layout({
    title,
    body,
    chrome: "try",
    tryNav: tryNav(active),
    shop: shopName ? { name: shopName } : undefined,
    bodyClass: "try",
    description: "A public replay of AgentDoor: a real recorded Claude session plus rule checks that run live on this page. No key, no account, no cost.",
  });
}

const claudeNote = (s: TrySession): string =>
  `Recorded ${isoDay(s.recordedAt)} · ${s.compile.model} · ${(s.compile.latencyMs / 1000).toFixed(1)} s · $${s.compile.costUsd.toFixed(2)}`;

function nextPrev(prev: string | null, next: string | null, nextLabel: string): SafeHtml {
  return html`<p class="step-nav">
    ${prev ? html`<a class="btn btn--secondary" href="${prev}"><span aria-hidden="true">←</span> Back</a>` : html`<span></span>`}
    ${next ? html`<a class="btn btn--primary btn--lg" href="${next}">${nextLabel} <span aria-hidden="true">→</span></a>` : ""}
  </p>`;
}

/* ---------- intro ---------- */

function video(videoId: string | null): SafeHtml {
  return html`<section class="wrap section" id="demo" aria-labelledby="demo-h">
    <h2 class="section__title" id="demo-h">Watch the demo</h2>
    ${videoId
      ? html`<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${videoId}" title="${VIDEO_TITLE}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>
        <p class="video__fallback">Video not loading? <a href="https://www.youtube.com/watch?v=${videoId}" rel="noopener">Watch it on YouTube</a>.</p>`
      : html`<div class="video video--empty" role="note">
          ${icon("clock")}
          <p><strong>The demo video link is added at submission.</strong></p>
          <p>Until then, the replay below shows the same story step by step.</p>
        </div>`}
  </section>`;
}

function legend(): SafeHtml {
  return html`<section class="wrap section" aria-labelledby="legend-h">
    <h2 class="section__title" id="legend-h">How to read this replay</h2>
    <p class="section__lead">Every block on the next pages wears one of three badges, so you can tell what was recorded from what runs now.</p>
    <ul class="legend">${PROVENANCE_ORDER.map((k) => html`<li>${provenanceBadge({ kind: k })}</li>`)}</ul>
  </section>`;
}

export function introPage(session: TrySession | null, videoId: string | null): string {
  const lead = html`<section class="try-hero">
    <div class="wrap">
      <p class="eyebrow">Public replay · no key, no account, no cost</p>
      <h1 class="hero__title">From a baker's words to a shop that can't be talked into a bad deal</h1>
      <p class="hero__lead">A home baker wants customers and AI agents to order without a phone call, but doesn't want a stranger, or a clever agent, to haggle a cake down to nothing.</p>
      <p class="hero__lead">AgentDoor writes the baker's rules down, has the baker approve each one, tries to break them, and only then opens the shop. This page replays a real run.</p>
      ${session
        ? html`<p class="hero__cta"><a class="btn btn--primary btn--lg" href="/try/describe">Start the replay <span aria-hidden="true">→</span></a><a class="btn btn--secondary btn--lg" href="#demo">Watch the demo</a></p>`
        : ""}
    </div>
  </section>`;
  if (!session) {
    return page(
      "Replay unavailable",
      "intro",
      html`<section class="try-hero"><div class="wrap">
        <p class="eyebrow">Public replay</p>
        <h1 class="hero__title">Replay unavailable</h1>
        <p class="hero__lead">The recorded session is not available on this server right now. You can still watch the demo and see the finished shop.</p>
        <p class="hero__cta"><a class="btn btn--primary btn--lg" href="/">Visit the storefront</a><a class="btn btn--secondary btn--lg" href="/launch-report">Read the launch report</a></p>
      </div></section>${video(videoId)}`,
    );
  }
  return page("Try AgentDoor", "intro", html`${lead}${video(videoId)}${legend()}`);
}

/* ---------- step 1: describe ---------- */

export function describePage(s: TrySession): string {
  const r = s.compile.result;
  const answers = new Map(s.answers.map((a) => [a.questionId, a.text]));
  const body = html`<section class="wrap section">
    <p class="eyebrow">Step 1 of 4 · Describe</p>
    <h1 class="page-title">The baker describes the business</h1>
    <p class="section__lead">No forms to fill in. The owner just talks, in English, Hindi or Hinglish. This is the real description used for this shop.</p>
  </section>
  <section class="wrap section block" aria-labelledby="said-h">
    <h2 class="block__title" id="said-h">What the owner said</h2>
    ${provenanceBadge({ kind: "claude", note: `The owner's words, ${s.language === "en" ? "in English" : s.language === "hi" ? "in Hindi" : "in Hinglish"}. ${claudeNote(s)}` })}
    <blockquote class="transcript"><p lang="${s.language === "hi" ? "hi" : "en"}">${s.transcript}</p></blockquote>
  </section>
  <section class="wrap section block" aria-labelledby="read-h">
    <h2 class="block__title" id="read-h">What Claude made of it</h2>
    ${provenanceBadge({ kind: "claude", note: claudeNote(s) })}
    <ul class="facts-row">
      <li><strong>${r.evidence.length}</strong> rules found, each with the words behind it</li>
      <li><strong>${r.assumptions.length}</strong> assumptions it had to make</li>
      <li><strong>${r.questions.length}</strong> question${r.questions.length === 1 ? "" : "s"} for the owner</li>
    </ul>
    ${r.questions.length === 0
      ? html`<p>Claude had no questions: everything it needed was in the description.</p>`
      : html`<ol class="qa">${r.questions.map((q) => html`<li class="qa__item">
          <p class="qa__q"><span class="qa__tag">Claude asks</span> ${q.text}</p>
          ${q.choices.length > 0 ? html`<ul class="qa__choices" aria-label="Choices offered">${q.choices.map((c) => html`<li>${c}</li>`)}</ul>` : ""}
          <p class="qa__a"><span class="qa__tag qa__tag--owner">Owner answers</span> ${answers.get(q.id) ?? "(skipped)"}</p>
        </li>`)}</ol>`}
    ${r.assumptions.length > 0
      ? html`<details class="more"><summary>Assumptions Claude flagged (${r.assumptions.length})</summary><ul>${r.assumptions.map((a) => html`<li><code>${a.path}</code> = ${a.value}. <span class="muted">${a.why}</span></li>`)}</ul></details>`
      : ""}
  </section>
  <section class="wrap section">${nextPrev("/try", "/try/rules", "Next: the rules")}</section>`;
  return page("Describe · Try AgentDoor", "describe", body);
}

/* ---------- step 2: rules ---------- */

export function rulesPage(s: TrySession): string {
  const first = s.policyVersions[0]!;
  const rules = Object.values(first.provenance);
  const low = rules.filter((r) => r.confidence === "low").length;
  const quoted = rules.filter((r) => r.source.kind === "transcript").length;
  const body = html`<section class="wrap section">
    <p class="eyebrow">Step 2 of 4 · Rules</p>
    <h1 class="page-title">Every rule, next to the owner's own words</h1>
    <p class="section__lead">Claude wrote these ${rules.length} rules from the description. ${quoted} point back to a sentence the owner said. ${low > 0 ? `${low} are marked “please check”, because Claude was not sure.` : "None were marked uncertain."} In the launcher the owner approves each one before anything goes live.</p>
  </section>
  <section class="wrap section block" aria-labelledby="rules-h">
    <h2 class="block__title" id="rules-h">The rules as Claude first wrote them</h2>
    ${provenanceBadge({ kind: "claude", note: `Rules and the evidence quotes behind them. ${claudeNote(s)}` })}
    ${ruleGroups(first)}
  </section>
  <section class="wrap section">${nextPrev("/try/describe", "/try/rehearse", "Next: the rehearsal")}</section>`;
  return page("Rules · Try AgentDoor", "rules", body);
}

/* ---------- step 3: rehearsal ---------- */

const OUTCOME_WORD: Record<string, string> = { QUOTED: "quoted it", REFUSED: "refused it", NEEDS_OWNER: "asked the owner" };
const WANT_WORD: Record<string, string> = { QUOTE: "accept", REFUSE: "refuse", ASK_OWNER: "ask first" };

function receiptView(run: LiveRun, policy: BusinessPolicy): SafeHtml {
  const cards = run.gaps.map((g) => ({ gapId: g.id, code: g.code, title: gapWords(g, policy).title }));
  const groups = receiptGroups(
    { probes: run.probes, scenarios: run.scenarios.map((x) => ({ ...x, outcome: x.outcome })), gaps: run.gaps },
    cards,
    {
      groupTitles: { timing: "Dates and notice", capacity: "Capacity", delivery: "Delivery areas", prices: "Prices", tricky: "Tricky customers", rules: "Rules waiting for you" },
      morePass: (n) => `and ${n} more checks passed`,
      scenarioOutcome: (o) => OUTCOME_WORD[o] ?? o.toLowerCase(),
    },
  );
  const when = new Date(run.ranAtMs).toISOString().slice(0, 16).replace("T", " ");
  return receiptSlip({
    title: "Rehearsal receipt",
    subtitle: `${run.policyHash.slice(0, 12)} · v${run.version} · ${when} UTC`,
    groups,
    totals: { pass: run.summary.passed, gap: run.gaps.filter((g) => !g.dismissed).length, failed: run.summary.probesFailed },
  });
}

function gapSection(s: TrySession, run: LiveRun, latest: LiveRun, policy: BusinessPolicy): SafeHtml {
  const open = run.gaps.filter((g) => !g.dismissed);
  if (open.length === 0) return html`<p class="alert alert--ok" role="status">${icon("check")}<span>No open gaps in this version.</span></p>`;
  const stillOpen = new Set(latest.gaps.filter((g) => !g.dismissed).map((g) => g.id));
  const byTitle = new Map<string, typeof open>();
  for (const g of open) {
    const t = gapWords(g, policy).title;
    byTitle.set(t, [...(byTitle.get(t) ?? []), g]);
  }
  return html`<div class="gaps-list">${[...byTitle.values()].map((group) => {
    const g = group[0]!;
    const w = gapWords(g, policy);
    const n = group.length;
    const decided = decisionFor(s, g.id);
    const decision = decided
      ? `The owner chose “${decided.choice.replace(/[_-]/g, " ")}”, written into version ${decided.toVersion}.`
      : n > 1 && g.code === "UNAPPROVED_RULE"
        ? "The owner approves these on the rules page, one by one or all at once."
        : !stillOpen.has(g.id)
          ? "Settled by the owner in a later version."
          : "Still open in this version.";
    return gapCard({
      gapId: g.id,
      severity: g.severity,
      title: n > 1 ? `${w.title} ×${n}` : w.title,
      body: n > 1 ? `${w.body} ${n - 1} more rule${n === 2 ? "" : "s"} like it.` : w.body,
      example: g.example,
      fixes: [],
      readOnly: { decision },
    });
  })}</div>`;
}

function scenariosBlock(s: TrySession, run: LiveRun): SafeHtml {
  if (run.scenarios.length === 0) return html``;
  const want = new Map(s.scenarios.map((x) => [x.id, x.ownerWouldWant]));
  return html`<section class="block" aria-labelledby="cases-h">
    <h2 class="block__title" id="cases-h">Customer cases</h2>
    ${provenanceBadge({ kind: "claude", note: `Claude imagined awkward customers, with what the owner would want. ${claudeNote(s)}` })}
    ${provenanceBadge({ kind: "live" })}
    <div class="table-wrap"><table class="cases">
      <caption class="visually-hidden">Customer cases and what the rule engine does with them now</caption>
      <thead><tr><th scope="col">Customer says</th><th scope="col">Owner would want</th><th scope="col">The shop now</th></tr></thead>
      <tbody>${run.scenarios.map((c) => html`<tr>
        <th scope="row">“${c.customerMessage}”</th>
        <td>${WANT_WORD[want.get(c.id) ?? ""] ?? "—"}</td>
        <td>${c.matched ? statusChip("pass", "AGREES") : statusChip("gap", "GAP")} <span class="muted">${OUTCOME_WORD[c.outcome] ?? c.outcome}</span></td>
      </tr>`)}</tbody>
    </table></div>
  </section>`;
}

export interface QuoteTry {
  result: EngineResult;
  request: { item: string; qty: number; date: string; where: string };
  problems: ReturnType<typeof problemsFor>;
}

function quoteResult(t: QuoteTry, policy: BusinessPolicy): SafeHtml {
  const r = t.result;
  const name = (id: string): string => policy.catalog.find((c) => c.id === id)?.name.en ?? id;
  return html`<div class="try-result ${r.outcome === "QUOTED" ? "is-ok" : "is-no"}" id="quote-result" tabindex="-1" role="status">
    <p class="try-result__head">${r.outcome === "QUOTED" ? statusChip("pass", "QUOTED") : statusChip("gap", r.outcome === "REFUSED" ? "REFUSED" : "NEEDS OWNER")}
      <span>${t.request.qty} × ${t.request.item} · ${shortDate(t.request.date)} · ${t.request.where}</span></p>
    ${r.outcome === "QUOTED"
      ? html`<table class="quote-table"><caption class="visually-hidden">Live quote</caption><tbody>
          ${r.lines.map((l) => html`<tr><th scope="row">${name(l.itemId)}<small>${l.qty} × ${inr(l.unitPricePaise + l.optionsPaise)}</small></th><td class="num">${inr(l.lineTotalPaise)}</td></tr>`)}
          ${r.deliveryFeePaise > 0 ? html`<tr><th scope="row">Delivery</th><td class="num">${inr(r.deliveryFeePaise)}</td></tr>` : ""}
          ${r.rushSurchargePaise > 0 ? html`<tr><th scope="row">Rush</th><td class="num">${inr(r.rushSurchargePaise)}</td></tr>` : ""}
        </tbody><tfoot><tr><th scope="row">Total</th><td class="num">${inr(r.totalPaise)}</td></tr></tfoot></table>`
      : html`<ul class="reasons">${t.problems.map((p) => html`<li>${icon("alert")}<span>${p.text}</span></li>`)}</ul>`}
    <p class="hint">${icon("check")} Nothing was saved and no order was created. This page never writes to the database.</p>
  </div>`;
}

function miniForm(policy: BusinessPolicy, earliest: string | null, last?: QuoteTry): SafeHtml {
  const areas = policy.fulfilment.delivery;
  return html`<section class="block" aria-labelledby="try-h" id="try-a-quote">
    <h2 class="block__title" id="try-h">Try a quote</h2>
    ${provenanceBadge({ kind: "live", note: "Asks the same rule engine the shop uses, right now. No order is created." })}
    <form method="post" action="/try/quote#quote-result" class="mini">
      <div class="mini__row">
        <div><label class="label" for="t-item">Item</label>
          <select class="input" id="t-item" name="item">${policy.catalog.map((c) => html`<option value="${c.id}" ${last?.request.item === c.name.en ? raw("selected") : ""}>${c.name.en} · ${inr(c.unitPricePaise)}</option>`)}</select></div>
        <div><label class="label" for="t-qty">Quantity</label>
          <input class="input" id="t-qty" name="qty" type="number" min="1" max="1000" step="1" inputmode="numeric" value="${last?.request.qty ?? 1}" required></div>
        <div><label class="label" for="t-date">Date</label>
          <input class="input" id="t-date" name="date" type="date" required value="${last?.request.date ?? earliest ?? ""}"></div>
      </div>
      <div class="mini__row">
        <div><label class="label" for="t-where">Pickup or delivery</label>
          <select class="input" id="t-where" name="where">
            <option value="pickup">Pickup</option>
            ${areas.enabled ? areas.areas.map((a) => html`<option value="${a.name}">Deliver to ${a.name}</option>`) : ""}
            ${areas.enabled ? html`<option value="${OTHER_AREA}">Deliver to somewhere not listed</option>` : ""}
          </select></div>
        <div class="mini__go"><button class="btn btn--primary" type="submit">Ask the rule engine</button></div>
      </div>
      <p class="hint">Try a Monday, tomorrow morning, or 30 cakes: the engine answers with the owner's own rules.</p>
    </form>
    ${last ? quoteResult(last, policy) : ""}
  </section>`;
}

export interface RehearsePage {
  session: TrySession;
  run: LiveRun;
  latest: LiveRun;
  /** Per version: critical gaps open now, for the version tabs. */
  tabs: { version: number; criticalOpen: number }[];
  earliest: string | null;
  quote?: QuoteTry;
  /** The policy the mini-form quotes against (the shop's own when launched). */
  quotePolicy: BusinessPolicy;
}

export function rehearsePage(p: RehearsePage): string {
  const { session: s, run, latest } = p;
  const policy = s.policyVersions[run.version - 1]!;
  const body = html`<section class="wrap section">
    <p class="eyebrow">Step 3 of 4 · Rehearsal</p>
    <h1 class="page-title">AgentDoor tries to break the rules</h1>
    <p class="section__lead">It generates ${run.summary.probes} boundary checks (the minute before a deadline, a full day, a closed Monday...) and runs ${run.summary.scenarios} customer cases through the rule engine. Everything below is recomputed when you load the page.</p>
    <nav class="vtabs" aria-label="Policy version"><ul>${p.tabs.map((t) => html`<li><a href="/try/rehearse?v=${t.version}" ${t.version === run.version ? raw('aria-current="page"') : ""}>Version ${t.version} <span class="count ${t.criticalOpen > 0 ? "count--bad" : "count--ok"}">${t.criticalOpen > 0 ? `${t.criticalOpen} critical` : "clear"}</span></a></li>`)}</ul></nav>
  </section>
  <section class="wrap section block" aria-labelledby="receipt-block-h">
    <h2 class="block__title" id="receipt-block-h">The receipt</h2>
    ${provenanceBadge({ kind: "live", note: `Computed now for policy version ${run.version}. No AI involved.` })}
    <dl class="tiles tiles--3" aria-label="Totals">
      <div class="tile"><dt class="tile__l">checks passed</dt><dd class="tile__n">${run.summary.passed}</dd></div>
      <div class="tile"><dt class="tile__l">gaps open</dt><dd class="tile__n">${run.gaps.filter((g) => !g.dismissed).length}</dd></div>
      <div class="tile"><dt class="tile__l">engine failures</dt><dd class="tile__n">${run.summary.probesFailed}</dd></div>
    </dl>
    ${receiptView(run, policy)}
  </section>
  <section class="wrap section block" aria-labelledby="gaps-h">
    <h2 class="block__title" id="gaps-h">What it caught</h2>
    ${provenanceBadge({ kind: "live", note: "Gap detection: AgentDoor's linter and probe classifier, run now. The owner's decision comes from the recording." })}
    ${gapSection(s, run, latest, policy)}
  </section>
  <section class="wrap section">${scenariosBlock(s, run)}</section>
  <section class="wrap section">${miniForm(p.quotePolicy, p.earliest, p.quote)}</section>
  <section class="wrap section">${nextPrev("/try/rules", "/try/launch", "Next: launch")}</section>`;
  return page("Rehearsal · Try AgentDoor", "rehearse", body);
}

/* ---------- step 4: launch ---------- */

const prettyStep = (id: string): string => {
  const words = id.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export interface LaunchPage {
  session: TrySession;
  checks: GateCheck[];
  recordedHash: string;
  /** This running shop's own hash (what /healthz serves), or null when it is not launched. */
  liveHash: string | null;
  mcpUrl: string;
}

export function launchPage(p: LaunchPage): string {
  const { session: s } = p;
  const open = p.checks.filter((c) => !c.ok).length;
  const ok = open === 0;
  const same = p.liveHash !== null && p.liveHash === p.recordedHash;
  const body = html`<section class="wrap section">
    <p class="eyebrow">Step 4 of 4 · Launch</p>
    <h1 class="page-title">The door only opens when the gate is clear</h1>
    <p class="section__lead">Before anything goes public, AgentDoor checks that every rule is approved, the rehearsal ran on exactly this policy, and nothing critical is open.</p>
  </section>
  <section class="wrap section block" aria-labelledby="gate-h">
    <h2 class="block__title" id="gate-h">The launch gate</h2>
    ${provenanceBadge({ kind: "live", note: `The checklist is computed now on policy version ${s.policyVersions.length}.` })}
    ${doorGate({
      open: ok,
      title: ok ? "The door is open" : "The door is locked",
      badge: ok ? "Ready to open" : `${open} check${open === 1 ? "" : "s"} open`,
      checklist: p.checks.map((c) => ({ ok: c.ok, label: c.label, ...(c.ok ? {} : { detail: c.detail }) })),
    })}
  </section>
  <section class="wrap section block" aria-labelledby="deploy-h">
    <h2 class="block__title" id="deploy-h">The real deployment</h2>
    ${provenanceBadge({ kind: "deploy", note: `Real GoDaddy deployment log from ${isoDay(s.recordedAt)}. Secrets are never recorded.` })}
    ${s.deployLog.length > 0
      ? stepTimeline({ steps: s.deployLog.map((d) => ({ id: d.step, label: prettyStep(d.step), state: d.ok ? "done" : "failed", elapsed: `${(d.ms / 1000).toFixed(1)} s`, ...(d.ok ? {} : { error: "This step failed." }) })) })
      : html`<p class="alert alert--note">${icon("clock")}<span>No deployment log was exported with this recording.</span></p>`}
    <dl class="facts hash-compare">
      <dt>Policy fingerprint, recorded at launch</dt><dd class="mono wrap-anywhere">${p.recordedHash}</dd>
      <dt>Policy fingerprint, live from this shop (<a href="/healthz">/healthz</a>)</dt><dd class="mono wrap-anywhere">${p.liveHash ?? "this shop is not launched"}</dd>
    </dl>
    <p class="${same ? "alert alert--ok" : "alert alert--note"}" role="status">${icon(same ? "check" : "alert")}<span>${same ? "They match: this running shop uses exactly the rules that were rehearsed." : "They differ: the recording is from another run than the one this shop serves."}</span></p>
    <p class="hint">${p.liveHash !== null ? "The live value is read from this server when you load the page." : ""}</p>
  </section>
  <section class="wrap section block" aria-labelledby="shop-h">
    <h2 class="block__title" id="shop-h">The shop that came out of it</h2>
    <ul class="tools">
      <li><a href="/">The storefront</a><span>What a customer sees, built from the approved rules.</span></li>
      <li><a href="/order">Order as a customer</a><span>Quote, request, status page: no JavaScript needed.</span></li>
      <li><a href="/launch-report">The launch report</a><span>The owner's words, the gaps found and fixed, the fingerprint.</span></li>
      <li><code>${p.mcpUrl}</code><span>Where AI agents connect (MCP): same rules, same prices.</span></li>
    </ul>
  </section>
  <section class="wrap section">${nextPrev("/try/rehearse", null, "")}</section>`;
  return page("Launch · Try AgentDoor", "launch", body);
}

