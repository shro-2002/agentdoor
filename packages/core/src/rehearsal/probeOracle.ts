import {
  HOUR_MS,
  addDays,
  fulfilmentInstantMs,
  istDateOf,
  weekdayOf,
} from "../engine/dates.js";
import { capacityOn } from "../engine/evaluate.js";
import { percentOf, sumPaise } from "../engine/money.js";
import type { QuoteRequest } from "../engine/request.js";
import type { EngineOutcome, ReasonCode } from "../engine/types.js";
import type { BusinessPolicy } from "../schema/policy.js";

export type CatalogItem = BusinessPolicy["catalog"][number];
export type Line = QuoteRequest["lines"][number];

/** What a probe expects, derived from the policy and not from the engine. */
export interface ProbeExpectation {
  outcome: EngineOutcome;
  code?: ReasonCode;
  totalPaise?: number;
  deliveryFeePaise?: number;
  rushSurchargePaise?: number;
  isRush?: boolean;
}

/** One valid single-line order for an item, sized to clear the min order and capacity. */
export interface Candidate {
  item: CatalogItem;
  qty: number;
  subtotalPaise: number;
  units: number;
}

/** A date and time at which a plain request is quoted without rush or refusals. */
export interface CleanContext {
  policy: BusinessPolicy;
  nowMs: number;
  date: string;
  capacityUnits: number;
  candidates: Candidate[];
  baseFulfilment: QuoteRequest["fulfilment"];
  baseFeePaise: number;
}

export const normalizeArea = (s: string): string => s.trim().toLowerCase();

export const areaFee = (
  policy: BusinessPolicy,
  input: string,
): number | null => {
  const wanted = normalizeArea(input);
  const area = policy.fulfilment.delivery.areas.find((a) =>
    [a.name, ...a.aliases].some((n) => normalizeArea(n) === wanted),
  );
  return area ? area.feePaise : null;
};

export const basketSubtotal = (
  lines: readonly Line[],
  policy: BusinessPolicy,
): number =>
  sumPaise(
    lines.map((line) => {
      const item = policy.catalog.find((c) => c.id === line.itemId)!;
      const options = item.options
        .filter((o) => line.optionIds.includes(o.id))
        .map((o) => o.surchargePaise);
      return line.qty * (item.unitPricePaise + sumPaise(options));
    }),
  );

export const basketUnits = (
  lines: readonly Line[],
  policy: BusinessPolicy,
): number =>
  sumPaise(
    lines.map(
      (l) =>
        l.qty *
        policy.catalog.find((c) => c.id === l.itemId)!.capacityUnitsPerQty,
    ),
  );

const isClosed = (policy: BusinessPolicy, date: string): boolean =>
  policy.schedule.closedWeekdays.includes(weekdayOf(date)) ||
  policy.schedule.closedDates.includes(date);

function candidateFor(
  policy: BusinessPolicy,
  item: CatalogItem,
  capacityUnits: number,
): Candidate[] {
  for (let qty = item.minQty; qty <= item.maxQtyPerOrder; qty++) {
    const subtotalPaise = qty * item.unitPricePaise;
    const units = qty * item.capacityUnitsPerQty;
    if (
      subtotalPaise >= policy.orderRules.minOrderPaise &&
      units <= capacityUnits
    ) {
      return [{ item, qty, subtotalPaise, units }];
    }
  }
  return [];
}

function baseFulfilment(policy: BusinessPolicy) {
  const { pickup, delivery } = policy.fulfilment;
  if (pickup.enabled) {
    return { fulfilment: { kind: "pickup" as const }, feePaise: 0 };
  }
  const first = delivery.areas[0];
  if (delivery.enabled && first) {
    return {
      fulfilment: { kind: "delivery" as const, area: first.name },
      feePaise: first.feePaise,
    };
  }
  return null;
}

/** Hours of notice that make every plain request lead-valid and non-rush. */
const cleanNoticeMs = (policy: BusinessPolicy): number => {
  const slowestPrep = Math.max(...policy.catalog.map((c) => c.prepHours));
  const hours = Math.max(
    policy.schedule.minLeadHours,
    slowestPrep,
    policy.rush?.withinHours ?? 0,
  );
  return hours * HOUR_MS;
};

/** Finds the first open date with enough notice, or null when the policy cannot take orders. */
export function buildContext(
  policy: BusinessPolicy,
  nowMs: number,
): CleanContext | null {
  const base = baseFulfilment(policy);
  if (!base) return null;
  const today = istDateOf(nowMs);
  for (let offset = 0; offset <= policy.schedule.maxAdvanceDays; offset++) {
    const date = addDays(today, offset);
    if (isClosed(policy, date)) continue;
    if (fulfilmentInstantMs(date) - nowMs < cleanNoticeMs(policy)) continue;
    const capacityUnits = capacityOn(policy, date);
    const candidates = policy.catalog.flatMap((i) =>
      candidateFor(policy, i, capacityUnits),
    );
    if (candidates.length === 0) continue;
    return {
      policy,
      nowMs,
      date,
      capacityUnits,
      candidates,
      baseFulfilment: base.fulfilment,
      baseFeePaise: base.feePaise,
    };
  }
  return null;
}

export const requestFor = (
  ctx: CleanContext,
  lines: Line[],
  overrides: Partial<QuoteRequest> = {},
): QuoteRequest => ({
  lines,
  fulfilment: ctx.baseFulfilment,
  date: ctx.date,
  ...overrides,
});

export const lineOf = (c: Candidate, qty = c.qty): Line => ({
  itemId: c.item.id,
  qty,
  optionIds: [],
});

export const quoted = (
  totalPaise: number,
  extra: Partial<ProbeExpectation> = {},
): ProbeExpectation => ({ outcome: "QUOTED", totalPaise, ...extra });

export const rushSurchargeOf = (
  policy: BusinessPolicy,
  subtotalPaise: number,
): number => {
  const s = policy.rush?.surcharge;
  if (!s) return 0;
  return s.kind === "flat" ? s.paise : percentOf(subtotalPaise, s.bp);
};

/** Expected result when the order arrives `untilMs` before fulfilment (rush waives lead). */
export function expectAtNotice(
  ctx: CleanContext,
  cand: Candidate,
  untilMs: number,
): ProbeExpectation {
  const { policy } = ctx;
  const { rush } = policy;
  if (rush && untilMs > 0 && untilMs < rush.withinHours * HOUR_MS) {
    if (cand.units > rush.maxRushUnitsPerDay) {
      return { outcome: "REFUSED", code: "RUSH_CAP_REACHED" };
    }
    const surcharge = rushSurchargeOf(policy, cand.subtotalPaise);
    return quoted(cand.subtotalPaise + ctx.baseFeePaise + surcharge, {
      isRush: true,
      rushSurchargePaise: surcharge,
    });
  }
  const requiredHours = Math.max(
    policy.schedule.minLeadHours,
    cand.item.prepHours,
  );
  if (untilMs >= requiredHours * HOUR_MS) {
    return quoted(cand.subtotalPaise + ctx.baseFeePaise, { isRush: false });
  }
  return { outcome: "REFUSED", code: "LEAD_TIME_NOT_MET" };
}
