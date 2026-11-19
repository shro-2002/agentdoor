import { policyHash } from "../hash.js";
import { capacityOn, evaluate } from "../engine/evaluate.js";
import { capsFor, emptyLedgerRow, reservationOf, reserve, type LedgerRow } from "../engine/reservation.js";
import type { EngineResult, ReasonCode } from "../engine/types.js";
import { UNBOUNDED_CAPACITY } from "../rehearsal/lint.js";
import type { BusinessPolicy } from "../schema/policy.js";
import { calendarFor, generateOrders, type Calendar, type SimOrder } from "./busyDayOrders.js";

export { BUSY_DAY_ORDERS, type AskKind, type Calendar, type SimOrder } from "./busyDayOrders.js";

/** The plain groups a refusal falls into, in the order they are listed. */
export const REFUSAL_GROUPS = ["DAILY_LIMIT", "RUSH_FULL", "TOO_SOON", "CLOSED", "AREA", "OVER_LIMIT", "BELOW_MINIMUM", "NEEDS_OWNER", "OTHER"] as const;
export type RefusalGroup = (typeof REFUSAL_GROUPS)[number];

const GROUP_OF: Partial<Record<ReasonCode, RefusalGroup>> = {
  CAPACITY_FULL: "DAILY_LIMIT",
  RUSH_CAP_REACHED: "RUSH_FULL",
  LEAD_TIME_NOT_MET: "TOO_SOON",
  CLOSED_DAY: "CLOSED",
  AREA_NOT_SERVED: "AREA",
  QTY_ABOVE_MAX: "OVER_LIMIT",
  BELOW_MIN_ORDER: "BELOW_MINIMUM",
  AREA_NEEDS_OWNER: "NEEDS_OWNER",
  CUSTOM_REQUEST_NEEDS_OWNER: "NEEDS_OWNER",
};

export type SimOutcome =
  | { kind: "accepted"; totalPaise: number; units: number; isRush: boolean }
  | { kind: "refused"; group: RefusalGroup };

export interface SimResult {
  order: SimOrder;
  outcome: SimOutcome;
}

export interface BusyDayResult {
  calendar: Calendar;
  results: SimResult[];
  accepted: number;
  revenuePaise: number;
  /** Refusals per group, only the groups that occurred, in REFUSAL_GROUPS order. */
  refusals: { group: RefusalGroup; count: number }[];
  /** Units booked on the rush day against that day's limit. */
  booked: { units: number; limit: number };
  /** True when the draft sets no real daily limit (the schema maximum). */
  noDailyLimit: boolean;
  /** Units and rush units booked beyond a limit, summed over all dates. The booking rule makes this 0. */
  oversold: number;
}

const refusedGroup = (result: Exclude<EngineResult, { outcome: "QUOTED" }>): RefusalGroup => {
  const code = result.reasons[0]?.code;
  return (code && GROUP_OF[code]) || "OTHER";
};

type Ledger = Map<string, LedgerRow>;

/** Prices one order with the live shop's engine, then books it with the live shop's rule. */
function settle(policy: BusinessPolicy, order: SimOrder, ledger: Ledger): SimOutcome {
  const quote = evaluate(policy, order.request, order.atMs);
  if (quote.outcome !== "QUOTED") return { kind: "refused", group: refusedGroup(quote) };
  const date = order.request.date;
  const booking = reserve(ledger.get(date) ?? emptyLedgerRow(), reservationOf(quote.capacityUnits, quote.isRush), capsFor(policy, date));
  if (!booking.ok) return { kind: "refused", group: GROUP_OF[booking.code] ?? "OTHER" };
  ledger.set(date, booking.row);
  return { kind: "accepted", totalPaise: quote.totalPaise, units: quote.capacityUnits, isRush: quote.isRush };
}

function oversoldOf(policy: BusinessPolicy, ledger: Ledger): number {
  let over = 0;
  for (const [date, row] of ledger) {
    const caps = capsFor(policy, date);
    over += Math.max(0, row.reservedUnits - caps.unitsCap) + Math.max(0, row.rushUnits - caps.rushCap);
  }
  return over;
}

function summarize(policy: BusinessPolicy, calendar: Calendar, results: SimResult[], ledger: Ledger): BusyDayResult {
  const accepted = results.flatMap((r) => (r.outcome.kind === "accepted" ? [r.outcome] : []));
  const refused = results.flatMap((r) => (r.outcome.kind === "refused" ? [r.outcome.group] : []));
  return {
    calendar,
    results,
    accepted: accepted.length,
    revenuePaise: accepted.reduce((sum, o) => sum + o.totalPaise, 0),
    refusals: REFUSAL_GROUPS.map((group) => ({ group, count: refused.filter((g) => g === group).length })).filter((r) => r.count > 0),
    booked: { units: ledger.get(calendar.rushDay)?.reservedUnits ?? 0, limit: capacityOn(policy, calendar.rushDay) },
    noDailyLimit: policy.capacity.unitsPerDay >= UNBOUNDED_CAPACITY,
    oversold: oversoldOf(policy, ledger),
  };
}

/**
 * A festival rush on paper: 50 orders over one hour, priced by the engine and booked one at a time
 * in arrival order against an in-memory ledger that follows the shop's booking rule. No clock, no
 * I/O, no randomness beyond the seed (draft id + policy hash). Null when no day is open to book.
 */
export function simulateBusyDay(policy: BusinessPolicy, draftId: string, nowMs: number): BusyDayResult | null {
  const calendar = calendarFor(policy, nowMs);
  if (!calendar) return null;
  const orders = generateOrders(policy, calendar, `${draftId}:${policyHash(policy)}`, nowMs);
  const ledger: Ledger = new Map();
  const results = orders.map((order) => ({ order, outcome: settle(policy, order, ledger) }));
  return summarize(policy, calendar, results, ledger);
}
