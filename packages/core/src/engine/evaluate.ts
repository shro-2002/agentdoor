import type { BusinessPolicy } from "../schema/policy.js";
import {
  HOUR_MS,
  daysBetween,
  fulfilmentInstantMs,
  istDateOf,
  weekdayOf,
} from "./dates.js";
import { percentOf, sumPaise } from "./money.js";
import { QuoteRequestSchema, type QuoteRequest } from "./request.js";
import type { EngineResult, PricedLine, Reason, ReasonCode } from "./types.js";

type Item = BusinessPolicy["catalog"][number];
type Line = QuoteRequest["lines"][number];
type Fulfilment = QuoteRequest["fulfilment"];

interface Resolved {
  item: Item;
  qty: number;
}

/** A stage either refuses (first refusal wins) or lets the pipeline continue. */
type Refusal = Reason[] | null;

const reason = (
  code: ReasonCode,
  ruleRef: string,
  params: Reason["params"] = {},
): Reason => ({ code, ruleRef, params });

const refused = (reasons: Reason[]): EngineResult => ({
  outcome: "REFUSED",
  reasons,
});

const normalizeArea = (s: string): string => s.trim().toLowerCase();

function resolveLines(
  policy: BusinessPolicy,
  lines: Line[],
): { resolved: Resolved[] } | { refusal: Reason[] } {
  const resolved: Resolved[] = [];
  for (const line of lines) {
    const item = policy.catalog.find((c) => c.id === line.itemId);
    if (!item) {
      return {
        refusal: [reason("UNKNOWN_ITEM", "catalog", { itemId: line.itemId })],
      };
    }
    const unknown = line.optionIds.find(
      (id) => !item.options.some((o) => o.id === id),
    );
    if (unknown !== undefined) {
      return {
        refusal: [
          reason("UNKNOWN_ITEM", `catalog[${item.id}].options`, {
            itemId: item.id,
            optionId: unknown,
          }),
        ],
      };
    }
    resolved.push({ item, qty: line.qty });
  }
  return { resolved };
}

function checkQuantities(resolved: Resolved[]): Refusal {
  for (const { item, qty } of resolved) {
    if (qty < item.minQty) {
      return [
        reason("QTY_BELOW_MIN", `catalog[${item.id}].minQty`, {
          itemId: item.id,
          minQty: item.minQty,
        }),
      ];
    }
    if (qty > item.maxQtyPerOrder) {
      return [
        reason("QTY_ABOVE_MAX", `catalog[${item.id}].maxQtyPerOrder`, {
          itemId: item.id,
          maxQty: item.maxQtyPerOrder,
        }),
      ];
    }
  }
  return null;
}

function checkLineCount(policy: BusinessPolicy, count: number): Refusal {
  const { maxLinesPerOrder } = policy.orderRules;
  if (count <= maxLinesPerOrder) return null;
  return [
    reason("TOO_MANY_LINES", "orderRules.maxLinesPerOrder", {
      maxLines: maxLinesPerOrder,
    }),
  ];
}

function checkCalendar(
  policy: BusinessPolicy,
  date: string,
  nowMs: number,
): Refusal {
  const { closedWeekdays, closedDates, maxAdvanceDays } = policy.schedule;
  if (closedWeekdays.includes(weekdayOf(date))) {
    return [reason("CLOSED_DAY", "schedule.closedWeekdays", { date })];
  }
  if (closedDates.includes(date)) {
    return [reason("CLOSED_DAY", "schedule.closedDates", { date })];
  }
  if (daysBetween(istDateOf(nowMs), date) > maxAdvanceDays) {
    return [
      reason("TOO_FAR_AHEAD", "schedule.maxAdvanceDays", { maxAdvanceDays }),
    ];
  }
  return null;
}

const capacityUnitsOf = (resolved: Resolved[]): number =>
  sumPaise(resolved.map((l) => l.qty * l.item.capacityUnitsPerQty));

/**
 * Rush waives the lead/prep requirement: the owner chose a short-notice window
 * (STATUS decision 2026-11-19), so a request strictly inside it is a rush order.
 */
function checkTiming(
  policy: BusinessPolicy,
  resolved: Resolved[],
  date: string,
  nowMs: number,
): { refusal: Reason[] } | { isRush: boolean } {
  const untilMs = fulfilmentInstantMs(date) - nowMs;
  const { rush } = policy;
  if (rush && untilMs > 0 && untilMs < rush.withinHours * HOUR_MS) {
    const units = capacityUnitsOf(resolved);
    if (units > rush.maxRushUnitsPerDay) {
      return {
        refusal: [
          reason("RUSH_CAP_REACHED", "rush.maxRushUnitsPerDay", {
            maxRushUnitsPerDay: rush.maxRushUnitsPerDay,
            capacityUnits: units,
          }),
        ],
      };
    }
    return { isRush: true };
  }
  const slowest = resolved.reduce((a, b) =>
    b.item.prepHours > a.item.prepHours ? b : a,
  );
  const prepWins = slowest.item.prepHours > policy.schedule.minLeadHours;
  const requiredHours = prepWins
    ? slowest.item.prepHours
    : policy.schedule.minLeadHours;
  if (untilMs >= requiredHours * HOUR_MS) return { isRush: false };
  const ruleRef = prepWins
    ? `catalog[${slowest.item.id}].prepHours`
    : "schedule.minLeadHours";
  const reasons = [reason("LEAD_TIME_NOT_MET", ruleRef, { requiredHours })];
  if (!rush) reasons.push(reason("RUSH_NOT_OFFERED", "rush"));
  return { refusal: reasons };
}

/** Trim + lowercase exact match against area name or aliases. */
function findArea(policy: BusinessPolicy, input: string) {
  const wanted = normalizeArea(input);
  return policy.fulfilment.delivery.areas.find((area) =>
    [area.name, ...area.aliases].some((n) => normalizeArea(n) === wanted),
  );
}

type FulfilmentOutcome =
  { feePaise: number; needsOwner: Reason[] } | { refusal: Reason[] };

function checkFulfilment(
  policy: BusinessPolicy,
  fulfilment: Fulfilment,
): FulfilmentOutcome {
  const { pickup, delivery } = policy.fulfilment;
  if (fulfilment.kind === "pickup") {
    if (pickup.enabled) return { feePaise: 0, needsOwner: [] };
    // 04 §2 has no pickup-specific code, so this reuses VALIDATION_FAILED.
    return {
      refusal: [
        reason("VALIDATION_FAILED", "fulfilment.pickup.enabled", {
          field: "fulfilment.kind",
        }),
      ],
    };
  }
  if (!delivery.enabled) {
    return {
      refusal: [reason("DELIVERY_NOT_OFFERED", "fulfilment.delivery.enabled")],
    };
  }
  const area = findArea(policy, fulfilment.area);
  if (area) return { feePaise: area.feePaise, needsOwner: [] };
  const ruleRef = "fulfilment.delivery.unlistedArea";
  if (delivery.unlistedArea === "ASK_OWNER") {
    return { feePaise: 0, needsOwner: [reason("AREA_NEEDS_OWNER", ruleRef)] };
  }
  return { refusal: [reason("AREA_NOT_SERVED", ruleRef)] };
}

const priceLine = (
  { item, qty }: Resolved,
  optionIds: string[],
): PricedLine => {
  const perUnitOptions = sumPaise(
    item.options
      .filter((o) => optionIds.includes(o.id))
      .map((o) => o.surchargePaise),
  );
  const optionsPaise = perUnitOptions * qty;
  const unitPricePaise = item.unitPricePaise;
  return {
    itemId: item.id,
    qty,
    unitPricePaise,
    optionsPaise,
    lineTotalPaise: unitPricePaise * qty + optionsPaise,
  };
};

function rushSurcharge(policy: BusinessPolicy, subtotalPaise: number): number {
  const surcharge = policy.rush?.surcharge;
  if (!surcharge) return 0;
  return surcharge.kind === "flat"
    ? surcharge.paise
    : percentOf(subtotalPaise, surcharge.bp);
}

export function capacityOn(policy: BusinessPolicy, date: string): number {
  const override = policy.capacity.overrides.find((o) => o.date === date);
  return override ? override.units : policy.capacity.unitsPerDay;
}

const validationFailed = (issuePath: string): EngineResult =>
  refused([reason("VALIDATION_FAILED", "request", { field: issuePath })]);

/** Checks that need the priced basket: minimum order, then single-order capacity. */
function checkBasket(
  policy: BusinessPolicy,
  date: string,
  subtotalPaise: number,
  units: number,
): Refusal {
  if (subtotalPaise < policy.orderRules.minOrderPaise) {
    return [
      reason("BELOW_MIN_ORDER", "orderRules.minOrderPaise", {
        minOrderPaise: policy.orderRules.minOrderPaise,
        subtotalPaise,
      }),
    ];
  }
  const available = capacityOn(policy, date);
  if (units > available) {
    return [
      reason("CAPACITY_FULL", "capacity.unitsPerDay", {
        capacityUnits: units,
        availableUnits: available,
      }),
    ];
  }
  return null;
}

/**
 * Pure quote evaluation (04 §2). First refusal wins; an unlisted area under
 * ASK_OWNER only yields NEEDS_OWNER if nothing later refuses. `notes` is
 * validated for size but never read, so it cannot influence the result.
 */
export function evaluate(
  policy: BusinessPolicy,
  request: unknown,
  nowMs: number,
): EngineResult {
  const parsed = QuoteRequestSchema.safeParse(request);
  if (!parsed.success) {
    return validationFailed(parsed.error.issues[0]?.path.join(".") ?? "");
  }
  const req = parsed.data;
  const lookup = resolveLines(policy, req.lines);
  if ("refusal" in lookup) return refused(lookup.refusal);
  const { resolved } = lookup;

  const early =
    checkQuantities(resolved) ??
    checkLineCount(policy, req.lines.length) ??
    checkCalendar(policy, req.date, nowMs);
  if (early) return refused(early);

  const timing = checkTiming(policy, resolved, req.date, nowMs);
  if ("refusal" in timing) return refused(timing.refusal);
  const fulfilment = checkFulfilment(policy, req.fulfilment);
  if ("refusal" in fulfilment) return refused(fulfilment.refusal);

  const lines = resolved.map((r, i) => priceLine(r, req.lines[i]!.optionIds));
  const subtotal = sumPaise(lines.map((l) => l.lineTotalPaise));
  const units = capacityUnitsOf(resolved);
  const late = checkBasket(policy, req.date, subtotal, units);
  if (late) return refused(late);
  if (fulfilment.needsOwner.length > 0) {
    return { outcome: "NEEDS_OWNER", reasons: fulfilment.needsOwner };
  }

  const rushSurchargePaise = timing.isRush
    ? rushSurcharge(policy, subtotal)
    : 0;
  return {
    outcome: "QUOTED",
    lines,
    deliveryFeePaise: fulfilment.feePaise,
    rushSurchargePaise,
    totalPaise: subtotal + fulfilment.feePaise + rushSurchargePaise,
    capacityUnits: units,
    isRush: timing.isRush,
    reasons: timing.isRush
      ? [reason("RUSH_APPLIED", "rush", { rushSurchargePaise })]
      : [],
  };
}
