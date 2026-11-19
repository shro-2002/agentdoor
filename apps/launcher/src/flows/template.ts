/**
 * AgentDoor's bakery vertical defaults (05 §4). Used three ways: rendered into the compile prompt,
 * to fill a required rule the owner never mentioned, and as the baseline for "differs from template".
 * A leaf listed here may be reset to its default when the model produced it without evidence.
 */
export const REQUIRED_DEFAULTS: Readonly<Record<string, unknown>> = {
  "capacity.unitsPerDay": 10,
  "schedule.minLeadHours": 48,
  "schedule.closedWeekdays": [],
  rush: null,
  "rush.maxRushUnitsPerDay": 3,
  "fulfilment.delivery.unlistedArea": "ASK_OWNER",
  "orderRules.minOrderPaise": 0,
  "orderRules.customRequests": "ASK_OWNER",
  "orderRules.quoteValidityMinutes": 30,
};

/** Non-required rule leaves: only need evidence when they differ from these. */
export const OPTIONAL_DEFAULTS: Readonly<Record<string, unknown>> = {
  "schedule.dailyCutoff": null,
  "schedule.maxAdvanceDays": 30,
  "schedule.closedDates": [],
  "capacity.overrides": [],
  "fulfilment.pickup": { enabled: true, areaLabel: null },
  "orderRules.maxLinesPerOrder": 10,
  "cancellation.freeCancelHours": 24,
};

/** Per catalog item (`catalog[<id>].<leaf>`). */
export const ITEM_DEFAULTS: Readonly<Record<string, unknown>> = {
  minQty: 1,
  capacityUnitsPerQty: 1,
};

export const DEFAULT_NOTE = "AgentDoor default — confirm";
export const UNFOUND_QUOTE_NOTE = "Couldn't find this in your words — please confirm";

export const renderDefaults = (): string =>
  [...Object.entries(REQUIRED_DEFAULTS), ...Object.entries(OPTIONAL_DEFAULTS)]
    .map(([p, v]) => `- ${p} = ${JSON.stringify(v)}`)
    .join("\n") +
  `\n${Object.entries(ITEM_DEFAULTS)
    .map(([p, v]) => `- catalog[<id>].${p} = ${JSON.stringify(v)}`)
    .join("\n")}`;
