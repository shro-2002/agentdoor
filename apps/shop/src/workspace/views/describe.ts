import type { BusinessPolicy, RuleProvenance } from "@agentdoor/core";
import { DEFAULT_NOTE, UNFOUND_QUOTE_NOTE } from "../../../../launcher/src/flows/template.js";
import { EDITED_NOTE } from "../edit.js";
import { WEEKDAYS, inr, spanOfHours } from "../../views/format.js";

const SUGGESTED = "Suggested by AgentDoor";

export type SourceKind = "stated" | "suggested" | "edited" | "decided";

export interface SourceView {
  kind: SourceKind;
  /** "You said: ..." or "Suggested by AgentDoor" and so on. */
  label: string;
  quote: string | null;
}

/** Where a rule came from, in the owner's terms: their own quoted words, a suggestion, or their edit. */
export function sourceOf(prov: RuleProvenance | undefined): SourceView {
  if (!prov) return { kind: "suggested", label: SUGGESTED, quote: null };
  const s = prov.source;
  if (s.kind === "transcript") return { kind: "stated", label: "You said", quote: s.quote };
  if (s.kind === "gap_fix") return { kind: "decided", label: "Your choice", quote: null };
  if (s.note === EDITED_NOTE) return { kind: "edited", label: "Set by you", quote: null };
  if (s.note === DEFAULT_NOTE || s.note === UNFOUND_QUOTE_NOTE) return { kind: "suggested", label: SUGGESTED, quote: null };
  return { kind: "decided", label: "Confirmed by you", quote: null };
}

export const rupeesInput = (paise: number): string => (paise / 100).toFixed(2).replace(/\.00$/, "");

const unitsWord = (n: number): string => `${n} ${n === 1 ? "unit" : "units"} a day`;

export interface RuleDef {
  path: string;
  label: string;
  value: (p: BusinessPolicy) => string;
  /** Shown only when this holds (e.g. the rush cap needs rush on). */
  when?: (p: BusinessPolicy) => boolean;
}

const closedDays = (p: BusinessPolicy): string => (p.schedule.closedWeekdays.length === 0 ? "Open every day" : p.schedule.closedWeekdays.map((d) => WEEKDAYS[d]).join(", "));

const rushText = (p: BusinessPolicy): string => {
  const r = p.rush;
  if (!r) return "Not offered";
  const fee = r.surcharge.kind === "flat" ? inr(r.surcharge.paise) : `${r.surcharge.bp / 100}%`;
  return `Within ${spanOfHours(r.withinHours)}, extra ${fee}`;
};

export const RULES: Record<"delivery" | "timing" | "capacity" | "rush" | "orders", RuleDef[]> = {
  delivery: [
    { path: "fulfilment.delivery.enabled", label: "Delivery", value: (p) => (p.fulfilment.delivery.enabled ? "Offered" : "Not offered") },
    {
      path: "fulfilment.delivery.unlistedArea",
      label: "Other areas",
      value: (p) => (p.fulfilment.delivery.unlistedArea === "REFUSE" ? "Refused" : "Ask me first"),
      when: (p) => p.fulfilment.delivery.enabled,
    },
  ],
  timing: [
    { path: "schedule.minLeadHours", label: "Notice needed", value: (p) => spanOfHours(p.schedule.minLeadHours) },
    { path: "schedule.closedWeekdays", label: "Closed days", value: closedDays },
  ],
  capacity: [{ path: "capacity.unitsPerDay", label: "Daily capacity", value: (p) => unitsWord(p.capacity.unitsPerDay) }],
  rush: [
    { path: "rush", label: "Rush orders", value: rushText },
    { path: "rush.maxRushUnitsPerDay", label: "Daily rush limit", value: (p) => unitsWord(p.rush?.maxRushUnitsPerDay ?? 0), when: (p) => p.rush !== null },
  ],
  orders: [
    { path: "orderRules.minOrderPaise", label: "Minimum order", value: (p) => (p.orderRules.minOrderPaise === 0 ? "None" : inr(p.orderRules.minOrderPaise)) },
    { path: "orderRules.customRequests", label: "Custom requests", value: (p) => (p.orderRules.customRequests === "REFUSE" ? "Refused" : "Ask me first") },
    { path: "orderRules.quoteValidityMinutes", label: "Quote holds for", value: (p) => `${p.orderRules.quoteValidityMinutes} minutes` },
  ],
};

export interface Summary {
  name: string;
  location: string;
  products: number;
  areas: string;
  capacity: string;
}

/** "Your business so far": the five facts an owner checks first. */
export function summarize(p: BusinessPolicy): Summary {
  const d = p.fulfilment.delivery;
  const areas = d.enabled && d.areas.length > 0 ? d.areas.map((a) => a.name).join(", ") : p.fulfilment.pickup.enabled ? "Pickup only" : "None yet";
  return { name: p.business.name, location: p.business.city, products: p.catalog.length, areas, capacity: unitsWord(p.capacity.unitsPerDay) };
}

const ITEM_FIELD_LABEL: Record<string, string> = {
  unitPricePaise: "price",
  maxQtyPerOrder: "most per order",
  prepHours: "notice needed",
  minQty: "least per order",
  dietary: "labels",
};

/** A short human name for a rule path, used where only the path is known. */
export function labelOfPath(p: BusinessPolicy, path: string): string {
  const item = /^catalog\[([^\]]+)\]\.(\w+)$/.exec(path);
  if (item) return `${p.catalog.find((c) => c.id === item[1])?.name.en ?? item[1]}: ${ITEM_FIELD_LABEL[item[2]!] ?? item[2]}`;
  const area = /^fulfilment\.delivery\.areas\[([^\]]+)\]\.feePaise$/.exec(path);
  if (area) return `${p.fulfilment.delivery.areas.find((a) => a.id === area[1])?.name ?? area[1]}: delivery fee`;
  if (path === "fulfilment.pickup") return "Pickup";
  return Object.values(RULES).flat().find((d) => d.path === path)?.label ?? path;
}

/** A human reading of a rule's current value, for lists that only know the path. */
export function valueOfPath(p: BusinessPolicy, path: string): string {
  const item = /^catalog\[([^\]]+)\]\.(\w+)$/.exec(path);
  const c = item ? p.catalog.find((x) => x.id === item[1]) : undefined;
  if (c && item) {
    const v: Record<string, string> = {
      unitPricePaise: `${inr(c.unitPricePaise)} per ${c.unit}`,
      maxQtyPerOrder: `At most ${c.maxQtyPerOrder} per order`,
      prepHours: spanOfHours(c.prepHours),
      minQty: `At least ${c.minQty} per order`,
      dietary: c.dietary.join(", ") || "No labels",
    };
    return v[item[2]!] ?? "";
  }
  const area = /^fulfilment\.delivery\.areas\[([^\]]+)\]\.feePaise$/.exec(path);
  const a = area ? p.fulfilment.delivery.areas.find((x) => x.id === area[1]) : undefined;
  if (a) return a.feePaise === 0 ? "Free delivery" : `${inr(a.feePaise)} delivery`;
  if (path === "fulfilment.pickup") return p.fulfilment.pickup.enabled ? `Offered${p.fulfilment.pickup.areaLabel ? `: ${p.fulfilment.pickup.areaLabel}` : ""}` : "Not offered";
  return Object.values(RULES).flat().find((d) => d.path === path)?.value(p) ?? "";
}
