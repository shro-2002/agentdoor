import { addDays, evaluate, istDateOf, weekdayOf, type BusinessPolicy } from "@agentdoor/core";

const PAISE_PER_RUPEE = 100;
const HOURS_PER_DAY = 24;
const BP_PER_PERCENT = 100;

/** Whole rupees show as "600", others as "600.50". */
export const inr = (paise: number): string =>
  `₹${Number.isInteger(paise / PAISE_PER_RUPEE) ? paise / PAISE_PER_RUPEE : (paise / PAISE_PER_RUPEE).toFixed(2)}`;

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Fri 21 Nov": a LocalDate (YYYY-MM-DD) in the shop's own calendar. */
export function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${WEEKDAYS[weekdayOf(date)]!.slice(0, 3)} ${d} ${MONTHS[(m ?? 1) - 1]}`;
}

/** "Friday 21 November 2026". */
export function longDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const month = new Date(Date.UTC(2000, (m ?? 1) - 1, 1)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  return `${WEEKDAYS[weekdayOf(date)]} ${d} ${month} ${y}`;
}

/** "19 Nov 2026" from an ISO instant, in IST. */
export function isoDay(iso: string): string {
  const date = istDateOf(Date.parse(iso));
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** "10:42 am" in IST, for "valid until". */
export function istClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
}

/** 48 -> "2 days", 36 -> "36 hours", 24 -> "1 day". */
export function spanOfHours(hours: number): string {
  if (hours >= HOURS_PER_DAY && hours % HOURS_PER_DAY === 0) {
    const days = hours / HOURS_PER_DAY;
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

export const UNIT_WORD: Record<string, { one: string; many: string; per: string }> = {
  piece: { one: "piece", many: "pieces", per: "each" },
  kg: { one: "kg", many: "kg", per: "per kg" },
  box: { one: "box", many: "boxes", per: "per box" },
  dozen: { one: "dozen", many: "dozen", per: "per dozen" },
};

export const DIETARY: Record<string, { label: string; caution: boolean }> = {
  eggless: { label: "Eggless", caution: false },
  vegan: { label: "Vegan", caution: false },
  gluten_free: { label: "Gluten free", caution: false },
  contains_nuts: { label: "Contains nuts", caution: true },
};

/**
 * The first date the shop could accept a one-unit pickup order, found with the same engine that
 * prices real orders (no second set of date rules to drift). Null when nothing opens in range.
 */
export function earliestDate(policy: BusinessPolicy, nowMs: number): string | null {
  const first = policy.catalog[0];
  if (!first) return null;
  const today = istDateOf(nowMs);
  for (let ahead = 0; ahead <= policy.schedule.maxAdvanceDays; ahead++) {
    const date = addDays(today, ahead);
    const request = { lines: [{ itemId: first.id, qty: first.minQty, optionIds: [] }], fulfilment: { kind: "pickup" as const }, date };
    if (evaluate(policy, request, nowMs).outcome === "QUOTED") return date;
  }
  return null;
}

export interface PlainRule {
  title: string;
  text: string;
  icon: "clock" | "door" | "truck" | "rupee" | "check" | "receipt";
}

const listWords = (items: string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** The owner's rules in plain words, straight from the policy: nothing here is hand-written per shop. */
export function plainRules(policy: BusinessPolicy): PlainRule[] {
  const { schedule, rush, orderRules, cancellation, capacity, fulfilment } = policy;
  const rules: PlainRule[] = [
    { icon: "clock", title: "Notice", text: `Order at least ${spanOfHours(schedule.minLeadHours)} ahead, and up to ${schedule.maxAdvanceDays} days in advance.` },
  ];
  const slow = policy.catalog.filter((i) => i.prepHours > schedule.minLeadHours);
  if (slow.length > 0) {
    rules.push({ icon: "clock", title: "Made to order", text: `${listWords(slow.map((i) => i.name.en))} need ${spanOfHours(Math.max(...slow.map((i) => i.prepHours)))} to make.` });
  }
  const closedDays = schedule.closedWeekdays.map((d) => `${WEEKDAYS[d]}s`);
  rules.push({
    icon: "door",
    title: "Closed days",
    text: closedDays.length > 0 ? `Closed on ${listWords(closedDays)}. Orders cannot be collected or delivered then.` : "Open every day of the week.",
  });
  rules.push({ icon: "receipt", title: "Daily limit", text: `About ${capacity.unitsPerDay} units of baking a day. When a day is full the shop says so, it never overbooks.` });
  if (rush) {
    const fee = rush.surcharge.kind === "flat" ? inr(rush.surcharge.paise) : `${rush.surcharge.bp / BP_PER_PERCENT}%`;
    rules.push({ icon: "clock", title: "Rush orders", text: `Need it within ${spanOfHours(rush.withinHours)}? Rush adds ${fee}, for up to ${rush.maxRushUnitsPerDay} units a day.` });
  }
  rules.push({ icon: "rupee", title: "Minimum order", text: orderRules.minOrderPaise > 0 ? `${inr(orderRules.minOrderPaise)} before delivery and extras.` : "No minimum order." });
  if (fulfilment.delivery.enabled && fulfilment.delivery.areas.length > 0) {
    const areas = fulfilment.delivery.areas.map((a) => `${a.name} ${a.feePaise === 0 ? "(free)" : inr(a.feePaise)}`);
    const other = fulfilment.delivery.unlistedArea === "REFUSE" ? "Other areas are not served." : "Other areas: the owner decides first.";
    rules.push({ icon: "truck", title: "Delivery", text: `${listWords(areas)}. ${other}` });
  }
  rules.push({ icon: "check", title: "Custom requests", text: orderRules.customRequests === "REFUSE" ? "Only what is on the menu. Custom designs are not taken." : "Custom requests are welcome, but the owner decides first." });
  rules.push({ icon: "check", title: "Cancelling", text: `Free cancellation up to ${spanOfHours(cancellation.freeCancelHours)} before.` });
  rules.push({ icon: "check", title: "Prices", text: `Fixed. No haggling and no discounts. A quote stays valid for ${orderRules.quoteValidityMinutes} minutes.` });
  return rules;
}

/** One short sentence for the footer. */
export function hoursLine(policy: BusinessPolicy): string {
  const closed = policy.schedule.closedWeekdays.map((d) => `${WEEKDAYS[d]}s`);
  return closed.length > 0 ? `Closed on ${listWords(closed)}.` : "Open every day.";
}
