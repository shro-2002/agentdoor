import type { BusinessPolicy } from "../schema/policy.js";
import { HOUR_MS, addDays, fulfilmentInstantMs, istDateOf, weekdayOf } from "../engine/dates.js";
import type { QuoteRequest } from "../engine/request.js";
import { seededRng, type Rng } from "./prng.js";

type Item = BusinessPolicy["catalog"][number];
type Fulfilment = QuoteRequest["fulfilment"];

export const BUSY_DAY_ORDERS = 50;
/** All the customers arrive inside this window. */
export const ARRIVAL_WINDOW_MS = HOUR_MS;
const MS_PER_SECOND = 1000;

/** How many of the 50 are deliberately awkward; every other order is an ordinary one for the rush day. */
const AWKWARD_MIX = { overLimit: 4, unlistedArea: 3, nextDay: 4, closedDay: 3, tooSoon: 3 } as const;
const SECOND_LINE_PERCENT = 25;
const DELIVERY_PERCENT = 60;
const PERCENT = 100;
const OVER_LIMIT_EXTRA_MAX = 3;
/** Invented, so they can never be one of the owner's listed areas. */
const UNLISTED_AREAS = ["Faraway Heights", "Lakeview Colony", "Orchard Park Layout"] as const;

export type AskKind = "regular" | "overLimit" | "unlistedArea" | "nextDay" | "closedDay" | "tooSoon";

export interface SimOrder {
  /** 1-based arrival number. */
  n: number;
  atMs: number;
  kind: AskKind;
  request: QuoteRequest;
}

export interface Calendar {
  today: string;
  /** The next open day that satisfies the notice rules for everything on the menu. */
  rushDay: string;
  tomorrow: string;
  /** The next day the shop is closed, or null when it is never closed. */
  closedDay: string | null;
}

const isOpen = (policy: BusinessPolicy, date: string): boolean =>
  !policy.schedule.closedWeekdays.includes(weekdayOf(date)) && !policy.schedule.closedDates.includes(date);

/** The longest notice any item needs: the day must suit the whole menu, so ordinary orders are not "too soon". */
const noticeHours = (policy: BusinessPolicy): number => Math.max(policy.schedule.minLeadHours, ...policy.catalog.map((c) => c.prepHours));

const daysFrom = (start: string, span: number): string[] => Array.from({ length: span + 1 }, (_, i) => addDays(start, i));

/** Null when the shop has no open day it can take orders for within its booking window. */
export function calendarFor(policy: BusinessPolicy, nowMs: number): Calendar | null {
  const today = istDateOf(nowMs);
  const lastArrival = nowMs + ARRIVAL_WINDOW_MS;
  const window = policy.schedule.maxAdvanceDays;
  const rushDay = daysFrom(today, window).find((d) => isOpen(policy, d) && fulfilmentInstantMs(d) - lastArrival >= noticeHours(policy) * HOUR_MS);
  if (!rushDay) return null;
  const tomorrow = addDays(today, 1);
  const closedDay = daysFrom(tomorrow, window - 1).find((d) => !isOpen(policy, d)) ?? null;
  return { today, rushDay, tomorrow, closedDay };
}

/** Small orders are far likelier than big ones: squaring the draw pulls quantities towards the minimum. */
function ordinaryQty(item: Item, rng: Rng): number {
  const spread = item.maxQtyPerOrder - item.minQty + 1;
  return Math.min(item.maxQtyPerOrder, item.minQty + Math.floor(rng.next() ** 2 * spread));
}

function linesFor(policy: BusinessPolicy, kind: AskKind, rng: Rng): QuoteRequest["lines"] {
  const first = rng.pick(policy.catalog);
  if (kind === "overLimit") return [{ itemId: first.id, qty: first.maxQtyPerOrder + rng.int(1, OVER_LIMIT_EXTRA_MAX), optionIds: [] }];
  const lines: QuoteRequest["lines"] = [{ itemId: first.id, qty: ordinaryQty(first, rng), optionIds: [] }];
  const others = policy.catalog.filter((c) => c.id !== first.id);
  if (others.length > 0 && rng.int(1, PERCENT) <= SECOND_LINE_PERCENT) {
    const second = rng.pick(others);
    lines.push({ itemId: second.id, qty: ordinaryQty(second, rng), optionIds: [] });
  }
  return lines;
}

function fulfilmentFor(policy: BusinessPolicy, kind: AskKind, rng: Rng): Fulfilment {
  const { pickup, delivery } = policy.fulfilment;
  if (kind === "unlistedArea") return { kind: "delivery", area: rng.pick(UNLISTED_AREAS) };
  const canDeliver = delivery.enabled && delivery.areas.length > 0;
  if (canDeliver && (!pickup.enabled || rng.int(1, PERCENT) <= DELIVERY_PERCENT)) return { kind: "delivery", area: rng.pick(delivery.areas).name };
  return { kind: "pickup" };
}

function dateFor(kind: AskKind, cal: Calendar): string {
  if (kind === "nextDay") return cal.tomorrow;
  if (kind === "tooSoon") return cal.today;
  if (kind === "closedDay") return cal.closedDay ?? cal.rushDay;
  return cal.rushDay;
}

/** The arrival order of the kinds: the awkward ones are scattered among the ordinary ones. */
function kindsFor(policy: BusinessPolicy, cal: Calendar, rng: Rng): AskKind[] {
  const wanted: [AskKind, number][] = [
    ["overLimit", AWKWARD_MIX.overLimit],
    ["unlistedArea", policy.fulfilment.delivery.enabled ? AWKWARD_MIX.unlistedArea : 0],
    ["nextDay", AWKWARD_MIX.nextDay],
    ["closedDay", cal.closedDay ? AWKWARD_MIX.closedDay : 0],
    ["tooSoon", AWKWARD_MIX.tooSoon],
  ];
  const awkward = wanted.flatMap(([kind, count]) => Array<AskKind>(count).fill(kind));
  return rng.shuffle([...awkward, ...Array<AskKind>(BUSY_DAY_ORDERS - awkward.length).fill("regular")]);
}

/**
 * 50 customers over one hour, drawn only from the policy's own menu and areas. The same seed text
 * (draft id + policy hash) always gives the same orders for the same calendar.
 */
export function generateOrders(policy: BusinessPolicy, cal: Calendar, seedText: string, nowMs: number): SimOrder[] {
  const rng = seededRng(seedText);
  const kinds = kindsFor(policy, cal, rng);
  const offsets = kinds.map(() => rng.int(0, ARRIVAL_WINDOW_MS / MS_PER_SECOND - 1) * MS_PER_SECOND).sort((a, b) => a - b);
  return kinds.map((kind, i) => ({
    n: i + 1,
    atMs: nowMs + offsets[i]!,
    kind,
    request: { lines: linesFor(policy, kind, rng), fulfilment: fulfilmentFor(policy, kind, rng), date: dateFor(kind, cal) },
  }));
}
