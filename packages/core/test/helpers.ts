import {
  BusinessPolicySchema,
  fulfilmentInstantMs,
  type BusinessPolicy,
  type QuoteRequest,
} from "../src/index.js";
import bakeryJson from "./fixtures/policy.bakery.json";
import leakyJson from "./fixtures/policy.seeded-leaky.json";

export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;

export const bakery = (): BusinessPolicy =>
  BusinessPolicySchema.parse(structuredClone(bakeryJson));
export const leaky = (): BusinessPolicy =>
  BusinessPolicySchema.parse(structuredClone(leakyJson));

/** Instant that is `hoursBefore` (+ `minutesBefore`) before 10:00 IST on `date`. */
export const nowFor = (
  date: string,
  hoursBefore: number,
  minutesBefore = 0,
): number =>
  fulfilmentInstantMs(date) - hoursBefore * HOUR_MS - minutesBefore * MINUTE_MS;

/** 2026-11-26 is a Thursday, 168 h after the reference "now": lead and rush windows are clear. */
export const FAR_DATE = "2026-11-26";
export const NOW = nowFor(FAR_DATE, 168);

export const pickupReq = (
  itemId = "cookie-box",
  qty = 1,
  date = FAR_DATE,
): QuoteRequest => ({
  lines: [{ itemId, qty, optionIds: [] }],
  fulfilment: { kind: "pickup" },
  date,
});

export const deliveryReq = (
  area: string,
  itemId = "cookie-box",
  qty = 1,
  date = FAR_DATE,
): QuoteRequest => ({
  ...pickupReq(itemId, qty, date),
  fulfilment: { kind: "delivery", area },
});

export const codes = (r: { reasons: { code: string }[] }): string[] =>
  r.reasons.map((x) => x.code);
