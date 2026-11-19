import type { BusinessPolicy } from "@agentdoor/core";

const PAISE_PER_RUPEE = 100;
const rupees = (paise: number): number => paise / PAISE_PER_RUPEE;

/**
 * Public view of the policy for `GET /api/business` and MCP `get_business_info`.
 * Deliberately omits provenance (transcript quotes) and delivery aliases.
 */
export function businessView(policy: BusinessPolicy, policyHash: string) {
  const { business, schedule, rush, fulfilment, orderRules, cancellation } = policy;
  return {
    name: business.name,
    slug: business.slug,
    city: business.city,
    languages: business.languages,
    currency: business.currency,
    catalog: policy.catalog.map((item) => ({
      id: item.id,
      name: item.name,
      unit: item.unit,
      pricePaise: item.unitPricePaise,
      priceRupees: rupees(item.unitPricePaise),
      minQty: item.minQty,
      maxQtyPerOrder: item.maxQtyPerOrder,
      prepHours: item.prepHours,
      options: item.options.map((o) => ({
        id: o.id,
        label: o.label,
        surchargePaise: o.surchargePaise,
        surchargeRupees: rupees(o.surchargePaise),
      })),
      dietary: item.dietary,
    })),
    pickup: fulfilment.pickup,
    delivery: {
      enabled: fulfilment.delivery.enabled,
      unlistedArea: fulfilment.delivery.unlistedArea,
      areas: fulfilment.delivery.areas.map((a) => ({
        id: a.id,
        name: a.name,
        feePaise: a.feePaise,
        feeRupees: rupees(a.feePaise),
      })),
    },
    schedule: {
      closedWeekdays: schedule.closedWeekdays,
      closedDates: schedule.closedDates,
      minLeadHours: schedule.minLeadHours,
      maxAdvanceDays: schedule.maxAdvanceDays,
    },
    rush: rush && {
      withinHours: rush.withinHours,
      surcharge: rush.surcharge,
      maxRushUnitsPerDay: rush.maxRushUnitsPerDay,
    },
    rules: {
      minOrderPaise: orderRules.minOrderPaise,
      minOrderRupees: rupees(orderRules.minOrderPaise),
      maxLinesPerOrder: orderRules.maxLinesPerOrder,
      customRequests: orderRules.customRequests,
      quoteValidityMinutes: orderRules.quoteValidityMinutes,
      negotiation: orderRules.negotiation,
      freeCancelHours: cancellation.freeCancelHours,
    },
    policyHash,
  };
}

export type BusinessView = ReturnType<typeof businessView>;
