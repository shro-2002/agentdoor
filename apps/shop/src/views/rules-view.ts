import type { BusinessPolicy, RuleProvenance } from "@agentdoor/core";
import { html, ruleCard, type RuleState, type SafeHtml } from "@agentdoor/ui";
import { ownerQuoteFor, type EvidenceQuotes } from "../services/figures.js";
import { getAt } from "../services/policy-paths.js";
import { WEEKDAYS, inr } from "./format.js";

/** Read-only rule cards for the launch report (S5) and the /try rules step: the owner's words next to each rule. */

type GroupId = "menu" | "notice" | "rush" | "delivery" | "rules";
const GROUPS: { id: GroupId; title: string }[] = [
  { id: "menu", title: "The menu" },
  { id: "notice", title: "Notice and capacity" },
  { id: "rush", title: "Rush orders" },
  { id: "delivery", title: "Delivery" },
  { id: "rules", title: "Ordering rules" },
];

const LEAF_TITLE: Record<string, string> = {
  unitPricePaise: "Price",
  maxQtyPerOrder: "Most per order",
  minQty: "Least per order",
  prepHours: "Time to make",
  feePaise: "Delivery fee",
  dietary: "Dietary label",
  "capacity.unitsPerDay": "Daily capacity",
  "schedule.minLeadHours": "Notice needed",
  "schedule.closedWeekdays": "Closed days",
  "schedule.maxAdvanceDays": "Book up to",
  rush: "Rush orders",
  "fulfilment.delivery.enabled": "Delivery",
  "fulfilment.delivery.unlistedArea": "Areas not on the list",
  "orderRules.minOrderPaise": "Minimum order",
  "orderRules.customRequests": "Custom requests",
  "orderRules.quoteValidityMinutes": "Quote stays valid for",
  "cancellation.freeCancelHours": "Free cancellation until",
};

interface Described {
  group: GroupId;
  leaf: string;
  subject: string | null;
  unit: string | null;
  order: number;
}

function describePath(policy: BusinessPolicy, p: string): Described {
  const item = /^catalog\[([^\]]+)\]\.(\w+)$/.exec(p);
  if (item) {
    const idx = policy.catalog.findIndex((c) => c.id === item[1]);
    const c = policy.catalog[idx];
    return { group: "menu", leaf: item[2]!, subject: c?.name.en ?? item[1]!, unit: c?.unit ?? null, order: idx };
  }
  const area = /^fulfilment\.delivery\.areas\[([^\]]+)\]\.(\w+)$/.exec(p);
  if (area) {
    const idx = policy.fulfilment.delivery.areas.findIndex((a) => a.id === area[1]);
    return { group: "delivery", leaf: area[2]!, subject: policy.fulfilment.delivery.areas[idx]?.name ?? area[1]!, unit: null, order: 10 + idx };
  }
  const group: GroupId = p.startsWith("capacity") || p.startsWith("schedule") ? "notice" : p.startsWith("rush") ? "rush" : p.startsWith("fulfilment") ? "delivery" : "rules";
  const leaf = p === "rush" ? "rush" : p.includes(".") ? p.slice(p.lastIndexOf(".") + 1) : p;
  return { group, leaf, subject: null, unit: null, order: 0 };
}

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));
const CHOICE: Record<string, string> = { REFUSE: "Refuse", ASK_OWNER: "Ask the owner first" };

function rushValue(v: unknown): string {
  if (v === null || v === undefined) return "No rush orders";
  const r = v as { withinHours: number; surcharge: { kind: string; paise?: number; bp?: number }; maxRushUnitsPerDay: number };
  const fee = r.surcharge.kind === "flat" ? inr(r.surcharge.paise ?? 0) : `${(r.surcharge.bp ?? 0) / 100}%`;
  return `Within ${r.withinHours} h · +${fee} · max ${r.maxRushUnitsPerDay} / day`;
}

function valueOf(leaf: string, v: unknown, unit: string | null): string {
  switch (leaf) {
    case "unitPricePaise":
      return `${inr(num(v))}${unit ? ` / ${unit}` : ""}`;
    case "feePaise":
      return num(v) === 0 ? "Free" : inr(num(v));
    case "minOrderPaise":
      return inr(num(v));
    case "maxQtyPerOrder":
    case "minQty":
      return `${num(v)}${unit ? ` ${unit}` : ""}`;
    case "prepHours":
    case "minLeadHours":
    case "freeCancelHours":
      return `${num(v)} hours`;
    case "unitsPerDay":
      return `${num(v)} units / day`;
    case "quoteValidityMinutes":
      return `${num(v)} minutes`;
    case "maxAdvanceDays":
      return `${num(v)} days`;
    case "closedWeekdays":
      return Array.isArray(v) && v.length > 0 ? v.map((d) => WEEKDAYS[num(d)] ?? String(d)).join(", ") : "Open every day";
    case "enabled":
      return v ? "On" : "Off";
    case "unlistedArea":
    case "customRequests":
      return CHOICE[String(v)] ?? String(v);
    case "dietary":
      return Array.isArray(v) && v.length > 0 ? v.join(", ").replace(/_/g, " ") : "None";
    case "rush":
      return rushValue(v);
    default:
      return typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v);
  }
}

export interface RuleEntry {
  path: string;
  group: GroupId;
  order: number;
  title: string;
  value: string;
  quote: string | null;
  note: string | null;
  readback: string;
  readbackLang: "en" | "hi";
  state: RuleState;
}

/** What the card says about where a rule came from. "AgentDoor suggested this" is only for a rule with no owner words behind it. */
export const SUGGESTED_NOTE = "AgentDoor suggested this: the owner did not say it.";

function sourceNote(src: RuleProvenance["source"], quote: string | null): string | null {
  if (src.kind === "transcript") return null;
  if (src.kind === "gap_fix") return "The owner decided this during the rehearsal: " + src.note;
  if (src.note.startsWith("Owner reviewed")) return src.note;
  const edited = src.note.startsWith("Edited");
  if (quote) return edited ? "The owner said this, and later edited the rule in the launcher." : "The owner said this.";
  if (edited) return "The owner set this in the launcher. No spoken quote is on record.";
  if (src.note.startsWith("AgentDoor default")) return SUGGESTED_NOTE;
  return "This rule could not be matched to the owner's own words.";
}

export function ruleEntries(policy: BusinessPolicy, evidence: EvidenceQuotes = []): RuleEntry[] {
  return Object.entries(policy.provenance)
    .map(([path, prov]) => {
      const d = describePath(policy, path);
      const base = LEAF_TITLE[d.leaf] ?? LEAF_TITLE[path] ?? path;
      const src = prov.source;
      const edited = src.kind !== "transcript" && src.note.startsWith("Edited");
      const quote = ownerQuoteFor(path, prov, evidence);
      const state: RuleState =
        prov.status === "approved" ? (edited ? "edited" : "approved") : prov.confidence === "low" ? "check" : src.kind === "owner_edit" && !quote ? "suggested" : "proposed";
      const note = sourceNote(src, quote);
      return {
        path,
        group: d.group,
        order: d.order,
        title: d.subject ? `${base} · ${d.subject}` : base,
        value: valueOf(d.leaf, getAt(policy, path).value ?? null, d.unit),
        quote,
        note,
        readback: prov.readback.text,
        readbackLang: prov.readback.lang === "hi" ? "hi" : "en",
        state,
      } satisfies RuleEntry;
    })
    .sort((a, b) => GROUPS.findIndex((g) => g.id === a.group) - GROUPS.findIndex((g) => g.id === b.group) || a.order - b.order);
}

/** Group labels are paragraphs, not headings: each card already carries an h3. */
export function ruleGroups(policy: BusinessPolicy, evidence: EvidenceQuotes = []): SafeHtml {
  const entries = ruleEntries(policy, evidence);
  return html`${GROUPS.map((g) => {
    const rules = entries.filter((r) => r.group === g.id);
    if (rules.length === 0) return "";
    return html`<section class="rules-group" aria-labelledby="g-${g.id}">
      <p class="rules-group__title" id="g-${g.id}">${g.title}</p>
      <div class="rules-list">${rules.map((r) =>
        ruleCard({
          path: r.path,
          title: r.title,
          value: r.value,
          quote: r.quote,
          ...(r.note ? { sourceNote: r.note } : {}),
          readback: r.readback,
          readbackLang: r.readbackLang,
          state: r.state,
          readOnly: true,
        }),
      )}</div>
    </section>`;
  })}`;
}
