import type { BusinessPolicy } from "../schema/policy.js";

const FIXED_REQUIRED_PATHS = [
  "capacity.unitsPerDay",
  "schedule.minLeadHours",
  "schedule.closedWeekdays",
  "rush",
  "fulfilment.delivery.enabled",
  "fulfilment.delivery.unlistedArea",
  "orderRules.minOrderPaise",
  "orderRules.customRequests",
  "orderRules.quoteValidityMinutes",
] as const;

/** Paths that need an approved provenance entry before launch (04 §1). */
export function requiredPaths(policy: BusinessPolicy): string[] {
  const perItem = policy.catalog.flatMap((c) => [
    `catalog[${c.id}].unitPricePaise`,
    `catalog[${c.id}].maxQtyPerOrder`,
    `catalog[${c.id}].prepHours`,
  ]);
  const perArea = policy.fulfilment.delivery.areas.map(
    (a) => `fulfilment.delivery.areas[${a.id}].feePaise`,
  );
  return [...perItem, ...FIXED_REQUIRED_PATHS, ...perArea];
}
