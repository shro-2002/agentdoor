import { BusinessPolicySchema, type BusinessPolicy, type Lang, type RuleProvenance } from "@agentdoor/core";
import { deepEqual, getAt, setAt } from "../../../launcher/src/flows/paths.js";
import { approve, pruneOrphans } from "../../../launcher/src/flows/policyEdit.js";

/** A change the owner asked for that the rules cannot accept; the message is shown as is. */
export class EditError extends Error {}

export type Form = Record<string, string | string[] | undefined>;

export const EDITED_NOTE = "Edited by you";
const PAISE_PER_RUPEE = 100;
const BP_PER_PERCENT = 100;
const MAX_NAME = 80;
const MAX_OPTIONS = 20;
const MAX_ALIASES = 10;
const MONEY_RE = /^\d{1,7}(\.\d{1,2})?$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DIETARY_TAGS = ["eggless", "vegan", "contains_nuts", "gluten_free"] as const;
const LANG: Lang = "en";

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();
const many = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((x) => x.trim()).filter(Boolean);

export function whole(raw: string, label: string, min: number, max: number): number {
  const n = Number(raw);
  if (raw === "" || !Number.isInteger(n) || n < min || n > max) throw new EditError(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
}

export function paise(raw: string, label: string): number {
  if (!MONEY_RE.test(raw)) throw new EditError(`${label} must be an amount in rupees, like 450 or 450.50.`);
  return Math.round(Number(raw) * PAISE_PER_RUPEE);
}

const text = (raw: string, label: string, max = MAX_NAME): string => {
  if (raw === "" || raw.length > max) throw new EditError(`${label} must be 1 to ${max} characters.`);
  return raw;
};

export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "item";

function uniqueId(base: string, taken: string[]): string {
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}-${n}`;
  return id;
}

const ownerProvenance = (readback: string, nowIso: string): RuleProvenance => ({
  source: { kind: "owner_edit", note: EDITED_NOTE },
  readback: { lang: LANG, text: readback.slice(0, 400) },
  confidence: "high",
  status: "approved",
  approvedAt: nowIso,
});

/** Writes a rule value and, when it really changed, records that the owner set it and approved it. */
function setRule(next: BusinessPolicy, path: string, value: unknown, readback: string, nowIso: string): void {
  const before = getAt(next, path);
  if (before.found && deepEqual(before.value, value)) return;
  if (!setAt(next, path, value)) throw new EditError("That rule could not be changed.");
  next.provenance[path] = ownerProvenance(readback, nowIso);
}

/** Validates the whole policy against the strict core schema before anything is stored. */
export function finishEdit(next: BusinessPolicy): BusinessPolicy {
  pruneOrphans(next);
  const sorted = Object.fromEntries(Object.entries(next.provenance).sort(([a], [b]) => a.localeCompare(b)));
  const parsed = BusinessPolicySchema.safeParse({ ...next, provenance: sorted });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new EditError(`That change is not allowed (${issue?.path.join(" > ") ?? "policy"}: ${issue?.message ?? "invalid"}).`);
  }
  return parsed.data;
}

const edit = (policy: BusinessPolicy, body: (next: BusinessPolicy) => void): BusinessPolicy => {
  const next = structuredClone(policy);
  body(next);
  return finishEdit(next);
};

const inr = (p: number): string => `₹${(p / PAISE_PER_RUPEE).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function parseOptions(raw: string): { id: string; label: { en: string }; surchargePaise: number }[] {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > MAX_OPTIONS) throw new EditError(`At most ${MAX_OPTIONS} extras per product.`);
  const taken: string[] = [];
  return lines.map((line) => {
    const cut = Math.max(line.lastIndexOf(","), line.lastIndexOf("|"));
    const label = text(cut < 0 ? line : line.slice(0, cut).trim(), "An extra's name", 60);
    const price = cut < 0 ? 0 : paise(line.slice(cut + 1).replace(/[₹+\s]/g, ""), `The price of "${label}"`);
    const id = uniqueId(slugify(label), taken);
    taken.push(id);
    return { id, label: { en: label }, surchargePaise: price };
  });
}

export const optionsText = (p: BusinessPolicy["catalog"][number]): string =>
  p.options.map((o) => `${o.label.en}, ${o.surchargePaise / PAISE_PER_RUPEE}`).join("\n");

export function editProduct(policy: BusinessPolicy, id: string, f: Form, nowIso: string): BusinessPolicy {
  return edit(policy, (next) => {
    const item = next.catalog.find((c) => c.id === id);
    if (!item) throw new EditError("That product no longer exists.");
    const name = text(first(f.name), "The name");
    const price = paise(first(f.price), "The price");
    const unit = first(f.unit);
    if (!["piece", "kg", "box", "dozen"].includes(unit)) throw new EditError("Choose a unit.");
    const maxQty = whole(first(f.maxQty), "The most per order", 1, 1000);
    const prep = whole(first(f.prepHours), "The notice needed", 0, 720);
    item.name = { ...item.name, en: name };
    item.unit = unit as typeof item.unit;
    item.minQty = whole(first(f.minQty), "The least per order", 1, 1000);
    item.dietary = many(f.dietary).filter((t): t is (typeof DIETARY_TAGS)[number] => (DIETARY_TAGS as readonly string[]).includes(t));
    item.options = parseOptions(first(f.options));
    setRule(next, `catalog[${id}].unitPricePaise`, price, `${name}: ${inr(price)} per ${unit}`, nowIso);
    setRule(next, `catalog[${id}].maxQtyPerOrder`, maxQty, `${name}: at most ${maxQty} per order`, nowIso);
    setRule(next, `catalog[${id}].prepHours`, prep, `${name}: ${prep} hours of notice`, nowIso);
    if (`catalog[${id}].dietary` in next.provenance)
      next.provenance[`catalog[${id}].dietary`] = ownerProvenance(`${name}: ${item.dietary.join(", ") || "no dietary labels"}`, nowIso);
  });
}

export function addProduct(policy: BusinessPolicy, f: Form, nowIso: string): BusinessPolicy {
  return edit(policy, (next) => {
    const name = text(first(f.name), "The name");
    const price = paise(first(f.price), "The price");
    const unit = first(f.unit) || "piece";
    if (!["piece", "kg", "box", "dozen"].includes(unit)) throw new EditError("Choose a unit.");
    const id = uniqueId(slugify(name), next.catalog.map((c) => c.id));
    next.catalog.push({
      id,
      name: { en: name },
      unit: unit as "piece",
      unitPricePaise: price,
      minQty: 1,
      maxQtyPerOrder: 10,
      prepHours: next.schedule.minLeadHours,
      capacityUnitsPerQty: 1,
      options: [],
      dietary: [],
    });
    next.provenance[`catalog[${id}].unitPricePaise`] = ownerProvenance(`${name}: ${inr(price)} per ${unit}`, nowIso);
    next.provenance[`catalog[${id}].maxQtyPerOrder`] = ownerProvenance(`${name}: at most 10 per order`, nowIso);
    next.provenance[`catalog[${id}].prepHours`] = ownerProvenance(`${name}: ${next.schedule.minLeadHours} hours of notice`, nowIso);
  });
}

export function removeProduct(policy: BusinessPolicy, id: string): BusinessPolicy {
  return edit(policy, (next) => {
    if (next.catalog.length <= 1) throw new EditError("Keep at least one product.");
    next.catalog = next.catalog.filter((c) => c.id !== id);
  });
}

function aliasList(raw: string): string[] {
  const list = raw.split(",").map((a) => a.trim()).filter(Boolean);
  if (list.length > MAX_ALIASES) throw new EditError(`At most ${MAX_ALIASES} other names per area.`);
  return list.map((a) => text(a, "An area's other name"));
}

export function editArea(policy: BusinessPolicy, id: string, f: Form, nowIso: string): BusinessPolicy {
  return edit(policy, (next) => {
    const area = next.fulfilment.delivery.areas.find((a) => a.id === id);
    if (!area) throw new EditError("That area no longer exists.");
    area.name = text(first(f.name), "The area name");
    area.aliases = aliasList(first(f.aliases));
    const fee = paise(first(f.fee), "The delivery fee");
    setRule(next, `fulfilment.delivery.areas[${id}].feePaise`, fee, `${area.name}: delivery ${fee === 0 ? "free" : inr(fee)}`, nowIso);
  });
}

export function addArea(policy: BusinessPolicy, f: Form, nowIso: string): BusinessPolicy {
  return edit(policy, (next) => {
    const name = text(first(f.name), "The area name");
    const fee = paise(first(f.fee) || "0", "The delivery fee");
    const id = uniqueId(slugify(name), next.fulfilment.delivery.areas.map((a) => a.id));
    next.fulfilment.delivery.areas.push({ id, name, aliases: aliasList(first(f.aliases)), feePaise: fee });
    next.fulfilment.delivery.enabled = true;
    next.provenance[`fulfilment.delivery.areas[${id}].feePaise`] = ownerProvenance(`${name}: delivery ${fee === 0 ? "free" : inr(fee)}`, nowIso);
  });
}

export function removeArea(policy: BusinessPolicy, id: string): BusinessPolicy {
  return edit(policy, (next) => {
    next.fulfilment.delivery.areas = next.fulfilment.delivery.areas.filter((a) => a.id !== id);
  });
}

export const RULE_SECTIONS = ["delivery", "timing", "capacity", "rush", "orders", "cancellation"] as const;
export type RuleSection = (typeof RULE_SECTIONS)[number];

function editDelivery(next: BusinessPolicy, f: Form, nowIso: string): void {
  const enabled = first(f.deliveryEnabled) === "on";
  const unlisted = first(f.unlistedArea);
  if (unlisted !== "REFUSE" && unlisted !== "ASK_OWNER") throw new EditError("Choose what happens for other areas.");
  setRule(next, "fulfilment.delivery.enabled", enabled, enabled ? "Delivery is offered" : "Delivery is not offered", nowIso);
  setRule(next, "fulfilment.delivery.unlistedArea", unlisted, unlisted === "REFUSE" ? "Other areas are refused" : "Other areas: ask the owner first", nowIso);
  const label = first(f.pickupLabel);
  const pickup = first(f.pickupEnabled) === "on";
  if (!pickup && !enabled) throw new EditError("Offer pickup, delivery, or both.");
  next.fulfilment.pickup = { enabled: pickup, areaLabel: label === "" ? null : text(label, "The pickup place") };
}

function editTiming(next: BusinessPolicy, f: Form, nowIso: string): void {
  const lead = whole(first(f.minLeadHours), "The notice", 0, 336);
  setRule(next, "schedule.minLeadHours", lead, `Orders need ${lead} hours of notice`, nowIso);
  const closed = many(f.closedWeekdays).map((d) => whole(d, "A closed day", 0, 6));
  setRule(next, "schedule.closedWeekdays", [...new Set(closed)].sort(), `Closed days: ${closed.join(", ") || "none"}`, nowIso);
  next.schedule.maxAdvanceDays = whole(first(f.maxAdvanceDays), "How far ahead", 1, 90);
  const cutoff = first(f.dailyCutoff);
  if (cutoff !== "" && !HHMM_RE.test(cutoff)) throw new EditError("The daily cut-off must look like 17:00.");
  next.schedule.dailyCutoff = cutoff === "" ? null : cutoff;
}

function editRush(next: BusinessPolicy, f: Form, nowIso: string): void {
  if (first(f.rushEnabled) !== "on") {
    setRule(next, "rush", null, "No rush orders", nowIso);
    return;
  }
  const within = whole(first(f.withinHours), "The rush window", 0, 336);
  const value = first(f.surchargeValue) || "0";
  const surcharge =
    first(f.surchargeKind) === "percent"
      ? { kind: "percent" as const, bp: Math.round(whole(value, "The rush surcharge", 0, 1000) * BP_PER_PERCENT) }
      : { kind: "flat" as const, paise: paise(value, "The rush surcharge") };
  const cap = whole(first(f.maxRushUnitsPerDay), "The daily rush limit", 0, 500);
  setRule(next, "rush", { withinHours: within, surcharge, maxRushUnitsPerDay: cap }, `Rush orders within ${within} hours, at most ${cap} units a day`, nowIso);
  setRule(next, "rush.maxRushUnitsPerDay", cap, `At most ${cap} rush units a day`, nowIso);
}

function editOrders(next: BusinessPolicy, f: Form, nowIso: string): void {
  const min = paise(first(f.minOrder) || "0", "The minimum order");
  setRule(next, "orderRules.minOrderPaise", min, min === 0 ? "No minimum order" : `Minimum order ${inr(min)}`, nowIso);
  const custom = first(f.customRequests);
  if (custom !== "REFUSE" && custom !== "ASK_OWNER") throw new EditError("Choose what happens with custom requests.");
  setRule(next, "orderRules.customRequests", custom, custom === "REFUSE" ? "Custom requests are refused" : "Custom requests: ask the owner first", nowIso);
  const valid = whole(first(f.quoteValidityMinutes), "Quote validity", 5, 1440);
  setRule(next, "orderRules.quoteValidityMinutes", valid, `Quotes hold for ${valid} minutes`, nowIso);
  next.orderRules.maxLinesPerOrder = whole(first(f.maxLinesPerOrder), "Items per order", 1, 20);
}

/** Saves one group of rules (see RULE_SECTIONS). Only rules whose value changed become "set by you". */
export function editRules(policy: BusinessPolicy, section: RuleSection, f: Form, nowIso: string): BusinessPolicy {
  return edit(policy, (next) => {
    if (section === "delivery") editDelivery(next, f, nowIso);
    else if (section === "timing") editTiming(next, f, nowIso);
    else if (section === "capacity") {
      const units = whole(first(f.unitsPerDay), "Daily capacity", 1, 500);
      setRule(next, "capacity.unitsPerDay", units, `Up to ${units} units a day`, nowIso);
    } else if (section === "rush") editRush(next, f, nowIso);
    else if (section === "orders") editOrders(next, f, nowIso);
    else {
      const hours = whole(first(f.freeCancelHours), "Free cancellation", 0, 720);
      next.cancellation = { freeCancelHours: hours, note: { en: text(first(f.cancelNote) || "Cancel any time before the notice window.", "The cancellation note", 200) } };
      if ("cancellation.freeCancelHours" in next.provenance) next.provenance["cancellation.freeCancelHours"] = ownerProvenance(`Free cancellation up to ${hours} hours before`, nowIso);
    }
  });
}

export function approveRule(policy: BusinessPolicy, path: string, nowIso: string): BusinessPolicy {
  const prov = policy.provenance[path];
  if (!prov) throw new EditError("That rule does not exist.");
  return edit(policy, (next) => {
    next.provenance[path] = { ...approve(prov), approvedAt: nowIso };
  });
}

/** "Approve all I stated": only rules that quote the owner's own words; AgentDoor's suggestions stay for the owner to review. */
export function approveStated(policy: BusinessPolicy, nowIso: string): { policy: BusinessPolicy; count: number } {
  let count = 0;
  const next = edit(policy, (draft) => {
    for (const [path, prov] of Object.entries(draft.provenance)) {
      if (prov.status === "approved" || prov.source.kind !== "transcript") continue;
      draft.provenance[path] = { ...prov, status: "approved", approvedAt: nowIso };
      count += 1;
    }
  });
  return { policy: next, count };
}
