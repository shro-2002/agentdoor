import { domId, html, raw, type SafeHtml } from "./html.js";
import { icon, type IconName } from "./icons.js";

/** Components are pure functions: data in, escaped HTML out. Every owner-facing word comes in via `labels`. */

export type ChipStatus = "pass" | "gap" | "failed" | "needs" | "warn" | "approved" | "info";

const CHIP_DEFAULTS: Record<ChipStatus, { icon: IconName; text: string }> = {
  pass: { icon: "check", text: "PASS" },
  gap: { icon: "alert", text: "GAP" },
  failed: { icon: "x", text: "FAILED" },
  needs: { icon: "alert", text: "NEEDS YOU" },
  warn: { icon: "alert", text: "PLEASE CHECK" },
  approved: { icon: "check", text: "APPROVED" },
  info: { icon: "dot", text: "SUGGESTED" },
};

/** Icon + word, never colour alone. */
export function statusChip(status: ChipStatus, label?: string): SafeHtml {
  const d = CHIP_DEFAULTS[status];
  return html`<span class="chip chip--${status}">${icon(d.icon)}<span>${label ?? d.text}</span></span>`;
}

/* ---------- RuleCard ---------- */

export type RuleState = "approved" | "proposed" | "check" | "suggested" | "edited";

export interface RuleLabels {
  youSaid: string;
  approve: string;
  edit: string;
  save: string;
  cancel: string;
  approved: string;
  pleaseCheck: string;
  suggested: string;
  edited: string;
  showSource: string;
  proposed: string;
}

export const RULE_LABELS_EN: RuleLabels = {
  youSaid: "You said:",
  approve: "Approve",
  edit: "Edit",
  save: "Save",
  cancel: "Cancel",
  approved: "APPROVED",
  pleaseCheck: "PLEASE CHECK",
  suggested: "SUGGESTED",
  edited: "EDITED BY YOU",
  showSource: "Show source",
  proposed: "NEEDS YOU",
};

export interface RuleCardProps {
  path: string;
  title: string;
  /** The rule's value in big type, already formatted ("₹600 / kg"). */
  value: string;
  /** The owner's own words, or null when AgentDoor suggested the rule. */
  quote: string | null;
  /** Shown instead of a quote, e.g. "AgentDoor suggested this: you did not say it." */
  sourceNote?: string;
  readback: string;
  readbackLang?: string;
  state: RuleState;
  edit?: { label: string; unit: string | null; value: string; min: number; max: number } | null;
  labels?: Partial<RuleLabels>;
}

function ruleChip(state: RuleState, l: RuleLabels): SafeHtml {
  if (state === "approved") return statusChip("approved", l.approved);
  if (state === "edited") return statusChip("approved", l.edited);
  if (state === "check") return statusChip("warn", l.pleaseCheck);
  if (state === "suggested") return statusChip("info", l.suggested);
  return statusChip("needs", l.proposed);
}

function ruleEditForm(p: RuleCardProps, id: string, l: RuleLabels): SafeHtml {
  const e = p.edit;
  if (!e) return raw("");
  return html`<form class="rule__edit" data-edit-form="${p.path}" hidden>
    <label for="${id}-input">${e.label}</label>
    <span class="rule__edit-row">
      ${e.unit ? html`<span class="rule__unit">${e.unit}</span>` : ""}
      <input id="${id}-input" class="input" type="number" inputmode="numeric" min="${e.min}" max="${e.max}" step="1" value="${e.value}" required />
      <button type="submit" class="btn btn--primary">${l.save}</button>
      <button type="button" class="btn btn--secondary" data-action="cancel-edit" data-path="${p.path}">${l.cancel}</button>
    </span>
  </form>`;
}

export function ruleCard(p: RuleCardProps): SafeHtml {
  const l = { ...RULE_LABELS_EN, ...p.labels };
  const id = `rule-${domId(p.path)}`;
  const approved = p.state === "approved" || p.state === "edited";
  const source = p.quote
    ? html`<blockquote class="rule__quote"><p><span class="rule__said">${l.youSaid}</span> <q>${p.quote}</q></p></blockquote>`
    : html`<p class="rule__note">${p.sourceNote ?? ""}</p>`;
  return html`<article class="rule rule--${p.state}" id="${id}" aria-labelledby="${id}-h" data-path="${p.path}">
    <div class="rule__main">
      <h3 class="rule__title" id="${id}-h">${p.title}</h3>
      <p class="rule__value">${p.value}</p>
      ${source}
      <p class="rule__readback" lang="${p.readbackLang ?? "en"}">${p.readback}</p>
    </div>
    <div class="rule__side">
      ${ruleChip(p.state, l)}
      <div class="rule__actions">
        ${approved ? "" : html`<button type="button" class="btn btn--primary" data-action="approve" data-path="${p.path}" aria-label="${l.approve}: ${p.title}">${l.approve}</button>`}
        ${p.quote ? html`<button type="button" class="btn btn--ghost" data-action="show-source" data-path="${p.path}" aria-label="${l.showSource}: ${p.title}">${l.showSource}</button>` : ""}
        ${p.edit ? html`<button type="button" class="btn btn--secondary" data-action="edit" data-path="${p.path}" aria-label="${l.edit}: ${p.title}">${icon("pencil")}${l.edit}</button>` : ""}
      </div>
    </div>
    ${ruleEditForm(p, id, l)}
  </article>`;
}

/* ---------- ReceiptSlip ---------- */

export type LineStatus = "pass" | "gap" | "failed";

export interface ReceiptLine {
  status: LineStatus;
  text: string;
  /** The gap card this line points to; renders a "See fix" link. */
  gapId?: string;
}
export interface ReceiptGroup {
  id: string;
  title: string;
  lines: ReceiptLine[];
}
export interface ReceiptSlipProps {
  title: string;
  /** Monospace sub-line, e.g. the policy fingerprint and date. */
  subtitle?: string;
  groups: ReceiptGroup[];
  /** True totals when long PASS runs are folded into one line; defaults to counting the printed lines. */
  totals?: { pass: number; gap: number; failed: number };
  labels?: { pass?: string; gap?: string; failed?: string; seeFix?: string; total?: string };
}

export const gapAnchor = (gapId: string): string => `gap-${domId(gapId)}`;

function receiptLine(line: ReceiptLine, tags: Record<LineStatus, string>, seeFix: string): SafeHtml {
  const ico: IconName = line.status === "pass" ? "check" : line.status === "gap" ? "alert" : "x";
  return html`<li class="line line--${line.status}">
    <span class="line__tag">${icon(ico)}<span>${tags[line.status]}</span></span>
    <span class="line__text">${line.text}</span>
    ${line.gapId ? html`<a class="line__fix" href="#${gapAnchor(line.gapId)}">${seeFix}</a>` : ""}
  </li>`;
}

export function receiptSlip(p: ReceiptSlipProps): SafeHtml {
  const l = p.labels ?? {};
  const tags: Record<LineStatus, string> = { pass: l.pass ?? "PASS", gap: l.gap ?? "GAP", failed: l.failed ?? "FAILED" };
  const all = p.groups.flatMap((g) => g.lines);
  const n = (s: LineStatus): number => p.totals?.[s] ?? all.filter((x) => x.status === s).length;
  return html`<section class="receipt" id="receipt" aria-labelledby="receipt-title">
    <header class="receipt__head">
      <p class="receipt__brand">${icon("receipt")}<span>AgentDoor</span></p>
      <h2 class="receipt__title" id="receipt-title">${p.title}</h2>
      ${p.subtitle ? html`<p class="receipt__sub">${p.subtitle}</p>` : ""}
    </header>
    <div class="receipt__body">
      ${p.groups.map(
        (g) => html`<section class="receipt__group" aria-labelledby="rg-${domId(g.id)}">
          <h3 id="rg-${domId(g.id)}">${g.title}</h3>
          <ul class="receipt__lines">${g.lines.map((x) => receiptLine(x, tags, l.seeFix ?? "See fix"))}</ul>
        </section>`,
      )}
    </div>
    <footer class="receipt__foot">
      <span class="receipt__total">${l.total ?? "TOTAL"}</span>
      <span>${tags.pass} ${n("pass")}</span><span>${tags.gap} ${n("gap")}</span><span>${tags.failed} ${n("failed")}</span>
    </footer>
  </section>`;
}

/* ---------- GapCard ---------- */

export interface GapCardProps {
  gapId: string;
  severity: "critical" | "warning";
  title: string;
  body: string;
  /** The triggering probe or customer message. */
  example: string | null;
  fixes: { choice: string; label: string; needsValue: boolean }[];
  labels?: { apply?: string; example?: string; critical?: string; warning?: string; choose?: string; number?: string; pick?: string };
}

export function gapCard(p: GapCardProps): SafeHtml {
  const l = p.labels ?? {};
  const id = gapAnchor(p.gapId);
  const critical = p.severity === "critical";
  return html`<article class="gap gap--${p.severity}" id="${id}" aria-labelledby="${id}-h">
    <header class="gap__head">
      ${statusChip(critical ? "gap" : "warn", critical ? l.critical : l.warning)}
      <h3 id="${id}-h">${p.title}</h3>
    </header>
    <p class="gap__body">${p.body}</p>
    ${p.example ? html`<blockquote class="gap__example"><span class="gap__example-label">${l.example ?? "Example"}</span> <q>${p.example}</q></blockquote>` : ""}
    <form class="gap__form" data-gap-id="${p.gapId}">
      <fieldset>
        <legend>${l.choose ?? "Choose a fix"}</legend>
        <div class="choices">
          ${p.fixes.map(
            (f, i) => html`<div class="choice">
              <input type="radio" id="${id}-c${i}" name="${id}-fix" value="${f.choice}" data-needs-value="${f.needsValue ? "1" : "0"}" />
              <label for="${id}-c${i}">${f.label}</label>
              ${f.needsValue ? html`<input class="input choice__value" type="number" min="1" step="1" inputmode="numeric" aria-label="${l.number ?? "Number"}" data-value-for="${f.choice}" />` : ""}
            </div>`,
          )}
        </div>
      </fieldset>
      <p class="gap__error" role="alert" hidden></p>
      <button type="submit" class="btn btn--primary">${icon("check")}${l.apply ?? "Apply fix"}</button>
    </form>
  </article>`;
}

/* ---------- DoorGate ---------- */

export interface DoorGateProps {
  open: boolean;
  title: string;
  /** "3 gaps open" or "Ready to open". */
  badge: string;
  checklist: { ok: boolean; label: string; detail?: string }[];
}

const DOOR_SVG = `<svg class="door__svg" viewBox="0 0 120 140" width="120" height="140" aria-hidden="true" focusable="false">
  <rect class="door__frame" x="14" y="8" width="92" height="124" rx="6"/>
  <rect class="door__light" x="22" y="16" width="76" height="116" rx="2"/>
  <g class="door__panel">
    <rect class="door__leaf" x="22" y="16" width="76" height="116" rx="2"/>
    <rect class="door__inset" x="32" y="28" width="56" height="38" rx="3"/>
    <rect class="door__inset" x="32" y="76" width="56" height="44" rx="3"/>
    <circle class="door__knob" cx="86" cy="76" r="4"/>
  </g>
  <g class="door__lock">
    <path class="door__shackle" d="M48 100V92a12 12 0 0 1 24 0v8"/>
    <rect class="door__body" x="40" y="98" width="40" height="28" rx="4"/>
    <circle class="door__keyhole" cx="60" cy="110" r="3.5"/>
  </g>
</svg>`;

export function doorGate(p: DoorGateProps): SafeHtml {
  return html`<section class="door ${p.open ? "is-open" : "is-locked"}" aria-labelledby="door-title">
    <div class="door__art">${raw(DOOR_SVG)}</div>
    <div class="door__text">
      <h2 class="door__title" id="door-title">${p.title}</h2>
      <p class="door__badge">${icon(p.open ? "unlock" : "lock")}<span>${p.badge}</span></p>
    </div>
    <ul class="checklist">
      ${p.checklist.map(
        (c) => html`<li class="check ${c.ok ? "check--ok" : "check--open"}">
          ${icon(c.ok ? "check" : "alert")}
          <span><span class="check__label">${c.label}</span>${c.detail ? html`<small class="check__detail">${c.detail}</small>` : ""}</span>
        </li>`,
      )}
    </ul>
  </section>`;
}

/* ---------- StepTimeline ---------- */

export type StepState = "waiting" | "running" | "done" | "failed";
export interface TimelineStep {
  id: string;
  label: string;
  state: StepState;
  /** Already formatted, e.g. "12.4 s". */
  elapsed?: string;
  error?: string;
}
export interface StepTimelineProps {
  steps: TimelineStep[];
  labels?: Partial<Record<StepState, string>> & { retry?: string };
}

const STEP_ICON: Record<StepState, IconName> = { waiting: "dot", running: "spinner", done: "check", failed: "x" };
const STEP_WORD: Record<StepState, string> = { waiting: "Waiting", running: "Running", done: "Done", failed: "Failed" };

export function stepTimeline(p: StepTimelineProps): SafeHtml {
  const l = p.labels ?? {};
  return html`<ol class="timeline">
    ${p.steps.map(
      (s) => html`<li class="step step--${s.state}" data-step="${s.id}">
        <span class="step__icon">${icon(STEP_ICON[s.state])}</span>
        <div class="step__body">
          <p class="step__label"><span>${s.label}</span><span class="step__state">${l[s.state] ?? STEP_WORD[s.state]}</span></p>
          ${s.elapsed ? html`<p class="step__time">${s.elapsed}</p>` : ""}
          ${s.state === "failed"
            ? html`<p class="step__error" role="alert">${s.error ?? ""}</p><button type="button" class="btn btn--secondary" data-action="retry-step" data-step="${s.id}">${l.retry ?? "Retry from here"}</button>`
            : ""}
        </div>
      </li>`,
    )}
  </ol>`;
}
