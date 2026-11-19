import type { BusinessPolicy, LaunchRecord } from "@agentdoor/core";
import { html, icon, statusChip, type SafeHtml } from "@agentdoor/ui";
import type { LaunchState } from "../db/launch-state.js";
import { approvalFigures, quoteEvidenceFigures, recordedRunFigures, type EvidenceQuotes, type RunFigures } from "../services/figures.js";
import { isoDay } from "./format.js";
import { gapTitle } from "./gap-words.js";
import { layout } from "./layout.js";
import { personaNote } from "./persona.js";
import { ruleGroups } from "./rules-view.js";

type GapRow = LaunchRecord["rehearsal"]["gapsFound"][number];

interface GapGroup {
  code: string;
  title: string;
  severity: "critical" | "warning";
  count: number;
  fixedIn: number | null;
  decisions: string[];
}

/** The owner's own decision for a gap, when it was recorded as a rule's provenance (`gap_fix`). */
function decisionsFor(policy: BusinessPolicy, ids: Set<string>): string[] {
  return Object.values(policy.provenance).flatMap((p) => (p.source.kind === "gap_fix" && ids.has(p.source.gapId) ? [p.source.note] : []));
}

export function groupGaps(rows: GapRow[], policy: BusinessPolicy): GapGroup[] {
  const byCode = new Map<string, GapRow[]>();
  for (const r of rows) byCode.set(r.code, [...(byCode.get(r.code) ?? []), r]);
  return [...byCode.entries()]
    .map(([code, list]) => {
      const fixed = list.map((r) => r.fixedInVersion);
      return {
        code,
        title: gapTitle(code),
        severity: list.some((r) => r.severity === "critical") ? ("critical" as const) : ("warning" as const),
        count: list.length,
        fixedIn: fixed.every((v) => v !== null) ? Math.max(...(fixed as number[])) : null,
        decisions: [...new Set(decisionsFor(policy, new Set(list.map((r) => r.id))))].slice(0, 3),
      };
    })
    .sort((a, b) => Number(b.severity === "critical") - Number(a.severity === "critical") || b.count - a.count);
}

function summary(rec: LaunchRecord, policy: BusinessPolicy): SafeHtml {
  const approvals = approvalFigures(policy);
  const final = recordedRunFigures(rec);
  const tiles = [
    { n: `${approvals.approvedRequired}/${approvals.required}`, l: "required rules approved" },
    { n: String(final.checks), l: "checks in the final run" },
    { n: String(final.gaps.found), l: "gaps found in all runs" },
    { n: String(final.gaps.fixed), l: "gaps fixed" },
    { n: isoDay(rec.signedAt), l: "launched" },
  ];
  return html`<dl class="tiles" aria-label="Summary">${tiles.map((t) => html`<div class="tile"><dt class="tile__l">${t.l}</dt><dd class="tile__n">${t.n}</dd></div>`)}</dl>`;
}

/** The first and the final rehearsal run side by side, each labelled, so different numbers are never passed off as one. */
export function runsTable(runs: RunFigures[]): SafeHtml {
  return html`<div class="table-wrap"><table class="runs">
    <caption class="visually-hidden">The first and the final rehearsal run</caption>
    <thead><tr><th scope="col">Run</th><th scope="col" class="num">Checks</th><th scope="col" class="num">Passed</th><th scope="col" class="num">Gaps open</th></tr></thead>
    <tbody>${runs.map((r) => html`<tr><th scope="row">${r.label}</th><td class="num">${r.checks}</td><td class="num">${r.passed}</td><td class="num">${r.gaps.open}</td></tr>`)}</tbody>
  </table></div>
  <ul class="muted runs-basis">${runs.map((r) => html`<li>${r.label}: ${r.basis}. Gaps open = gaps still unsettled when that run ended.</li>`)}</ul>
  ${categoryTable(runs)}`;
}

/** The four kinds of finding, one row each and one column per run. Different things, so never summed. */
export function categoryTable(runs: RunFigures[]): SafeHtml {
  const rows: [string, (r: RunFigures) => number][] = [
    ["Business-policy gaps", (r) => r.categories.policy],
    ["Pending approvals", (r) => r.categories.approval],
    ["Scenario mismatches", (r) => r.categories.scenario],
    ["Engine failures", (r) => r.categories.engine],
  ];
  return html`<div class="table-wrap"><table class="runs runs--kinds">
    <caption class="visually-hidden">Open findings by kind, for each rehearsal run</caption>
    <thead><tr><th scope="col">Open at the end of the run</th>${runs.map((r) => html`<th scope="col" class="num">${r.label}</th>`)}</tr></thead>
    <tbody>${rows.map(([label, pick]) => html`<tr><th scope="row">${label}</th>${runs.map((r) => html`<td class="num">${pick(r)}</td>`)}</tr>`)}</tbody>
  </table></div>`;
}

function caught(groups: GapGroup[], currentVersion: number): SafeHtml {
  if (groups.length === 0) return html`<p class="section__lead">The rehearsal found no gaps in these rules.</p>`;
  return html`<ol class="timeline-gaps">${groups.map((g) => html`<li class="tg">
    <div class="tg__head">
      ${statusChip(g.fixedIn !== null ? "approved" : g.severity === "critical" ? "gap" : "warn", g.fixedIn !== null ? "FIXED" : "OPEN")}
      <h3 class="tg__title">${g.title}${g.count > 1 ? html` <span class="tg__count">×${g.count}</span>` : ""}</h3>
    </div>
    <ol class="tg__flow" aria-label="What happened">
      <li><span class="tg__step">Found</span> by the rehearsal${g.severity === "critical" ? " (blocked the launch)" : ""}</li>
      <li><span class="tg__step">Owner's decision</span> ${g.decisions.length > 0 ? g.decisions.join("; ") : "read it and approved or changed the rule"}</li>
      <li><span class="tg__step">Result</span> ${g.fixedIn !== null ? `fixed in version ${g.fixedIn}` : "still open"}${g.fixedIn === currentVersion ? " (the launched version)" : ""}</li>
    </ol>
  </li>`)}</ol>`;
}

function verify(launch: LaunchState & { launched: true }): SafeHtml {
  const { record, policyHash } = launch;
  return html`<section class="wrap section" aria-labelledby="verify-h">
    <h2 id="verify-h" class="section__title">Verify it yourself</h2>
    <div class="twin">
      <dl class="facts">
        <dt>Policy fingerprint (SHA-256)</dt><dd class="mono wrap-anywhere">${policyHash}</dd>
        <dt>Policy version</dt><dd>${record.policyVersion}</dd>
        <dt>Public key (Ed25519)</dt><dd class="mono wrap-anywhere">${record.publicKey}</dd>
        <dt>Signed</dt><dd>${isoDay(record.signedAt)}</dd>
        <dt>Machine-readable</dt><dd><a href="/.well-known/agentdoor.json">/.well-known/agentdoor.json</a> · <a href="/healthz">/healthz</a></dd>
      </dl>
      <div class="panel">
        <h3>${icon("lock")}What the fingerprint means</h3>
        <p>The fingerprint is a short code computed from every rule on this page. The launch record, with the results of the rehearsal, is signed with a private key that only the launcher holds. This shop refuses to open if its rules or that record are changed, and every quote it gives is signed too, so a price cannot be altered after the fact.</p>
        <p>The same fingerprint is served live at <a href="/healthz">/healthz</a>. If it ever differs from the one here, the shop is not running these rules.</p>
      </div>
    </div>
  </section>`;
}

function forAgents(publicBaseUrl: string): SafeHtml {
  const mcp = `${publicBaseUrl.replace(/\/$/, "")}/mcp`;
  return html`<section class="wrap section" aria-labelledby="agents-h">
    <h2 id="agents-h" class="section__title">For AI agents</h2>
    <p class="section__lead">Agents order here the same way people do, under the same rules. Connect any MCP client to:</p>
    <p class="codeline"><code>${mcp}</code></p>
    <ul class="tools">
      <li><code>get_business_info</code><span>The menu, fixed prices, areas, notice and closed days.</span></li>
      <li><code>get_quote</code><span>A signed price for a basket and a date, or the reason it is refused.</span></li>
      <li><code>place_order</code><span>Turns a valid quote into a request the owner then confirms.</span></li>
    </ul>
  </section>`;
}

export interface ReportExtras {
  /** The recorded compile evidence, used to show the owner's original words where an edit replaced them. */
  evidence?: EvidenceQuotes;
  /** The first rehearsal run, recomputed from the recorded session, when the session is available. */
  firstRun?: RunFigures;
}

export function launchReportPage(launch: LaunchState, publicBaseUrl: string, extras: ReportExtras = {}): string {
  if (!launch.launched) {
    const body = html`<section class="wrap section narrow"><h1 class="page-title">Launch report</h1>
      <p class="alert alert--error" role="alert">${icon("alert")}<span>This shop has not been launched, so there is no report to show. Reason: ${launch.reason}.</span></p></section>`;
    return layout({ title: "Launch report", body, chrome: "agentdoor", styles: ["agentdoor-try.css"], active: "report" });
  }
  const { policy, record } = launch;
  const rows = record.rehearsal.gapsFound;
  const approvals = approvalFigures(policy);
  const quoted = quoteEvidenceFigures(policy, extras.evidence);
  const runs = [...(extras.firstRun ? [extras.firstRun] : []), recordedRunFigures(record)];
  const owner = policy.business.ownerFirstName;
  const body = html`<section class="report-hero">
      <div class="wrap">
        <p class="eyebrow">Launch report</p>
        ${personaNote()}
        <h1 class="hero__title">How ${policy.business.name} was prepared for launch</h1>
        <p class="hero__lead">${owner} described the business in their own words. AgentDoor wrote the rules down, ${owner} approved each one, and a rehearsal tried to break them before any customer could.</p>
        ${summary(record, policy)}
      </div>
    </section>
    <section class="wrap section" aria-labelledby="rules-h">
      <h2 id="rules-h" class="section__title">The rules, in ${owner}’s words</h2>
      <p class="section__lead">Every rule shows what ${owner} said and how AgentDoor read it back. ${approvals.listed} rules are listed: the ${approvals.required} required ones are approved ${approvals.approvedRequired} of ${approvals.required}, and ${quoted.withQuote} of the ${quoted.total} point back to a sentence ${owner} said.</p>
      ${ruleGroups(policy, extras.evidence)}
    </section>
    <section class="wrap section" aria-labelledby="caught-h">
      <h2 id="caught-h" class="section__title">What the rehearsal caught</h2>
      <p class="section__lead">${record.rehearsal.probes} generated checks and ${record.rehearsal.scenarios} customer cases were run against the final rules. ${record.rehearsal.passed} passed, and the gaps below were settled before launch.</p>
      ${runs.length > 1 ? html`<p class="section__lead">The first run was on the rules as first written, before the owner had approved or fixed anything, so its numbers differ from the final run.</p>` : ""}
      ${runsTable(runs)}
      ${caught(groupGaps(rows, policy), record.policyVersion)}
    </section>
    ${verify(launch)}
    ${forAgents(publicBaseUrl)}`;
  return layout({
    title: "Launch report",
    body,
    chrome: "agentdoor",
    styles: ["agentdoor-try.css"],
    active: "report",
    description: `How ${policy.business.name} was rehearsed and signed before launch: the owner's rules, the gaps found and fixed, and the policy fingerprint.`,
  });
}
