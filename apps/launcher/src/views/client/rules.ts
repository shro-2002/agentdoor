import { html, icon, raw, ruleCard, type RuleState, type SafeHtml } from "@agentdoor/ui";
import type { OverviewData, RuleData } from "./api-types.js";
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
  rupees,
  t,
} from "./common.js";
import type { Key } from "./strings.js";

interface State {
  sid: string | null;
  data: OverviewData | null;
  error: unknown;
  editing: string | null;
  highlight: string | null;
  sourceOpen: boolean;
  demo: boolean;
}
const state: State = { sid: getSessionId(), data: null, error: null, editing: null, highlight: null, sourceOpen: false, demo: false };
const app = document.getElementById("app")!;

/* ---------- rule wording: EN / Hinglish (Hindi falls back to Hinglish) ---------- */
const pick = (en: string, hinglish: string): string => (getLang() === "en" ? en : hinglish);

const LEAF_TITLE: Record<string, [string, string]> = {
  unitPricePaise: ["Price", "Daam"],
  maxQtyPerOrder: ["Most per order", "Ek order mein zyada se zyada"],
  minQty: ["Least per order", "Ek order mein kam se kam"],
  prepHours: ["Time to make", "Banane ka time"],
  feePaise: ["Delivery fee", "Delivery fee"],
  dietary: ["Dietary label", "Dietary label"],
  "capacity.unitsPerDay": ["Daily capacity", "Roz ki capacity"],
  "schedule.minLeadHours": ["Notice needed", "Kitna pehle batana hai"],
  "schedule.closedWeekdays": ["Closed days", "Band rehne ke din"],
  "schedule.maxAdvanceDays": ["Book up to", "Kitne din aage tak booking"],
  rush: ["Rush orders", "Rush orders"],
  "fulfilment.delivery.enabled": ["Delivery", "Delivery"],
  "fulfilment.delivery.unlistedArea": ["Areas not on your list", "Jo area list mein nahi"],
  "orderRules.minOrderPaise": ["Minimum order", "Minimum order"],
  "orderRules.customRequests": ["Custom requests", "Custom requests"],
  "orderRules.quoteValidityMinutes": ["Quote stays valid for", "Quote kitni der valid"],
  "cancellation.freeCancelHours": ["Free cancellation until", "Free cancel kab tak"],
};
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function titleOf(r: RuleData): string {
  const [en, hing] = LEAF_TITLE[r.leaf] ?? LEAF_TITLE[r.path] ?? [r.path, r.path];
  const base = pick(en, hing);
  return r.subject ? `${base} · ${r.subject}` : base;
}

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));
const choice = (v: unknown): string => (v === "REFUSE" ? pick("Refuse", "Mana karo") : v === "ASK_OWNER" ? pick("Ask me first", "Pehle mujhse pucho") : String(v));

function valueOf(r: RuleData): string {
  const v = r.value;
  switch (r.leaf) {
    case "unitPricePaise":
      return `${rupees(num(v))}${r.unit ? ` / ${r.unit}` : ""}`;
    case "feePaise":
      return num(v) === 0 ? pick("Free", "Free") : rupees(num(v));
    case "minOrderPaise":
      return rupees(num(v));
    case "maxQtyPerOrder":
    case "minQty":
      return `${num(v)}${r.unit ? ` ${r.unit}` : ""}`;
    case "prepHours":
    case "minLeadHours":
    case "freeCancelHours":
      return pick(`${num(v)} hours`, `${num(v)} ghante`);
    case "unitsPerDay":
      return pick(`${num(v)} units / day`, `${num(v)} units / din`);
    case "quoteValidityMinutes":
      return pick(`${num(v)} minutes`, `${num(v)} minute`);
    case "maxAdvanceDays":
      return pick(`${num(v)} days`, `${num(v)} din`);
    case "closedWeekdays":
      return Array.isArray(v) && v.length > 0 ? v.map((d) => DAYS[num(d)] ?? String(d)).join(", ") : pick("Open every day", "Roz khula");
    case "enabled":
      return v ? pick("On", "Chalu") : pick("Off", "Band");
    case "unlistedArea":
    case "customRequests":
      return choice(v);
    case "dietary":
      return Array.isArray(v) && v.length > 0 ? v.join(", ").replace(/_/g, " ") : pick("None", "Koi nahi");
    case "rush":
      return rushValue(v);
    default:
      return typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v);
  }
}

function rushValue(v: unknown): string {
  if (v === null || v === undefined) return pick("No rush orders", "Rush orders nahi");
  const rush = v as { withinHours: number; surcharge: { kind: string; paise?: number; percent?: number }; maxRushUnitsPerDay: number };
  const fee = rush.surcharge.kind === "flat" ? rupees(rush.surcharge.paise ?? 0) : `${rush.surcharge.percent ?? 0}%`;
  return pick(`Within ${rush.withinHours} h · +${fee} · max ${rush.maxRushUnitsPerDay} / day`, `${rush.withinHours} ghante ke andar · +${fee} · max ${rush.maxRushUnitsPerDay} / din`);
}

function stateOf(r: RuleData): RuleState {
  if (r.status === "approved") return r.source.note?.startsWith("Edited") ? "edited" : "approved";
  if (r.confidence === "low") return "check";
  if (r.source.kind === "owner_edit") return "suggested";
  return "proposed";
}

function card(r: RuleData): SafeHtml {
  const money = r.leaf.endsWith("Paise");
  const e = r.editable;
  const quote = r.source.quote;
  return ruleCard({
    path: r.path,
    title: titleOf(r),
    value: valueOf(r),
    quote,
    sourceNote: quote ? undefined : t("r.suggested"),
    readback: r.readback.text,
    readbackLang: r.readback.lang === "hi" ? "hi" : "en",
    state: stateOf(r),
    edit: e
      ? {
          label: t("r.editLabel"),
          unit: money ? "₹" : null,
          value: String(money ? num(r.value) / 100 : num(r.value)),
          min: money ? Math.ceil(e.min / 100) : e.min,
          max: money ? Math.floor(e.max / 100) : e.max,
        }
      : null,
    labels: {
      youSaid: pick("You said:", "Aapne kaha:"),
      approve: pick("Approve", "Approve karein"),
      edit: pick("Edit", "Badlein"),
      save: pick("Save", "Save karein"),
      cancel: pick("Cancel", "Raddh karein"),
      approved: pick("APPROVED", "APPROVE HUA"),
      pleaseCheck: pick("PLEASE CHECK", "DEKH LIJIYE"),
      suggested: pick("SUGGESTED", "SUGGESTED"),
      edited: pick("EDITED BY YOU", "AAPNE BADLA"),
      showSource: pick("Show source", "Source dikhayein"),
      proposed: pick("NEEDS YOU", "AAPKI ZAROORAT"),
    },
  });
}

/* ---------- source panel with the quote highlighted ---------- */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function highlighted(text: string, quote: string | null): SafeHtml {
  if (!quote) return html`${text}`;
  const words = quote.trim().split(/\s+/).map(escapeRe);
  const m = words.length > 0 ? new RegExp(words.join("\\s+"), "i").exec(text) : null;
  if (!m) return html`${text}`;
  return html`${text.slice(0, m.index)}<mark>${m[0]}</mark>${text.slice(m.index + m[0].length)}`;
}

function sourcePanel(d: OverviewData): SafeHtml {
  return html`<details class="source-panel" id="source-panel" ${state.sourceOpen ? raw("open") : ""}>
    <summary>${t("r.sourceTitle")}</summary>
    <div class="source-panel__body">
      ${d.turns.map((turn, i) => html`<div><p class="source-panel__turn">${t("r.sourceTurn", { n: i + 1 })}</p><p>${highlighted(turn, state.highlight)}</p></div>`)}
    </div>
  </details>`;
}

const GROUPS: { id: RuleData["group"]; key: Key }[] = [
  { id: "menu", key: "r.g.menu" },
  { id: "notice", key: "r.g.notice" },
  { id: "rush", key: "r.g.rush" },
  { id: "delivery", key: "r.g.delivery" },
  { id: "rules", key: "r.g.rules" },
];

function groupsView(d: OverviewData): SafeHtml {
  return html`${GROUPS.map((g) => {
    const rules = d.rules.filter((r) => r.group === g.id);
    return rules.length === 0
      ? ""
      : html`<section class="rules-group" aria-labelledby="g-${g.id}">
          <h2 id="g-${g.id}">${t(g.key)}</h2>
          <div class="rules-list">${rules.map(card)}</div>
        </section>`;
  })}`;
}

function stickyBar(d: OverviewData): SafeHtml {
  const { approved, required } = d.approvals;
  return html`<section class="sticky-bar" aria-label="${t("r.progress", { a: approved, b: required })}">
    <div class="sticky-bar__progress">
      <p id="approved-count">${t("r.progress", { a: approved, b: required })}</p>
      <progress max="${required}" value="${approved}" aria-labelledby="approved-count"></progress>
    </div>
    <div class="actions">
      <button type="button" class="btn btn--secondary" data-action="approve-high" id="approve-high">${icon("check")}${t("r.approveHigh")}</button>
      <a class="btn btn--primary" href="/rehearsal" id="go-rehearsal">${icon("receipt")}${t("r.rehearse")}</a>
    </div>
    <p class="hint">${t("r.rehearseHint")}</p>
  </section>`;
}

function render(): SafeHtml {
  const head = pageTitle(t("r.title"), t("r.sub"));
  const demo = state.demo ? demoBanner() : "";
  if (!state.sid) return html`${head}<p class="alert alert--note">${icon("alert")}<span>${t("common.noSession")} <a href="/">${t("common.startOver")}</a></span></p>`;
  if (state.error) return html`${head}${errorPanel(state.error, "reload")}`;
  const d = state.data;
  if (!d) return html`${head}<p class="working">${icon("spinner")}<span>${t("common.loading")}</span></p>`;
  if (d.rules.length === 0) return html`${head}<p>${t("r.none")}</p>`;
  return html`${head}${demo}${sourcePanel(d)}${groupsView(d)}${stickyBar(d)}`;
}

const view = createView(app, render, () => {
  if (!state.editing || !state.data) return;
  const form = app.querySelector<HTMLFormElement>(`[data-edit-form="${CSS.escape(state.editing)}"]`);
  if (!form) return;
  form.hidden = false;
  form.querySelector<HTMLInputElement>("input")?.focus();
});

async function load(): Promise<void> {
  if (!state.sid) return view.update();
  try {
    state.error = null;
    state.data = await api<OverviewData>("GET", `/api/session/${state.sid}/overview`);
  } catch (e) {
    state.error = e;
  }
  view.update();
}

const ruleByPath = (path: string): RuleData | undefined => state.data?.rules.find((r) => r.path === path);

async function approveOne(path: string): Promise<void> {
  const r = ruleByPath(path);
  try {
    await api("POST", `/api/session/${state.sid}/rules/${encodeURIComponent(path)}/approve`);
    await load();
    if (r) announce(t("r.approved1", { title: titleOf(r) }));
  } catch (e) {
    state.error = e;
    view.update();
  }
}

async function approveHigh(): Promise<void> {
  try {
    const res = await api<{ approved: string[]; skipped: string[] }>("POST", `/api/session/${state.sid}/rules/approve-high`);
    await load();
    announce(res.approved.length > 0 ? t("r.approvedMany", { n: res.approved.length, m: res.skipped.length }) : t("r.approvedNone"));
  } catch (e) {
    state.error = e;
    view.update();
  }
}

async function saveEdit(form: HTMLFormElement): Promise<void> {
  const path = form.dataset.editForm ?? "";
  const r = ruleByPath(path);
  const input = form.querySelector<HTMLInputElement>("input")!;
  if (!r || !input.reportValidity()) return;
  const shown = Number(input.value);
  const value = r.leaf.endsWith("Paise") ? Math.round(shown * 100) : shown;
  try {
    await api("POST", `/api/session/${state.sid}/rules/${encodeURIComponent(path)}/edit`, { value, readback: `${titleOf(r)}: ${r.leaf.endsWith("Paise") ? `₹${shown}` : shown}`.slice(0, 200) });
    state.editing = null;
    await load();
    announce(t("r.edited", { title: titleOf(r) }));
  } catch (e) {
    state.error = e;
    view.update();
  }
}

onAction(app, (action, el) => {
  const path = el.dataset.path ?? "";
  if (action === "approve") void approveOne(path);
  else if (action === "approve-high") void approveHigh();
  else if (action === "show-source") {
    state.highlight = ruleByPath(path)?.source.quote ?? null;
    state.sourceOpen = true;
    view.update();
    document.querySelector("#source-panel mark")?.scrollIntoView({ block: "center" });
  }
  else if (action === "edit") {
    state.editing = path;
    view.update();
  } else if (action === "cancel-edit") {
    state.editing = null;
    view.update();
  } else if (action === "reload") void load();
});
app.addEventListener("submit", (ev) => {
  const form = (ev.target as HTMLElement).closest<HTMLFormElement>("form[data-edit-form]");
  if (!form) return;
  ev.preventDefault();
  void saveEdit(form);
});
app.addEventListener("toggle", (ev) => {
  if ((ev.target as HTMLElement).id === "source-panel") state.sourceOpen = (ev.target as HTMLDetailsElement).open;
}, true);

mountChrome("rules", () => {
  document.title = `${t("r.title")} · AgentDoor`;
  view.update();
});
document.title = `${t("r.title")} · AgentDoor`;
void isReplayMode().then((replay) => {
  state.demo = replay;
  view.update();
});
void load();
