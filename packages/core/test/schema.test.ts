import { describe, expect, it } from "vitest";
import { BusinessPolicySchema, type BusinessPolicy } from "../src/index.js";
import bakery from "./fixtures/policy.bakery.json";
import leaky from "./fixtures/policy.seeded-leaky.json";

const clone = () => structuredClone(bakery) as Record<string, any>;

describe("U-SCH-1 valid fixtures parse", () => {
  it("bakery parses and keeps its type", () => {
    const parsed: BusinessPolicy = BusinessPolicySchema.parse(bakery);
    expect(parsed.business.slug).toBe("meeras-kitchen");
    expect(parsed.catalog).toHaveLength(4);
  });
  it("seeded-leaky parses", () => {
    expect(BusinessPolicySchema.safeParse(leaky).success).toBe(true);
  });
});

describe("U-SCH-2 strict at every level", () => {
  const injections: [string, (p: Record<string, any>) => void][] = [
    ["root", (p) => (p.extra = 1)],
    ["business", (p) => (p.business.extra = 1)],
    ["catalog item", (p) => (p.catalog[0].extra = 1)],
    ["option", (p) => (p.catalog[0].options[0].extra = 1)],
    ["localized", (p) => (p.catalog[0].name.extra = "x")],
    ["capacity", (p) => (p.capacity.extra = 1)],
    ["schedule", (p) => (p.schedule.extra = 1)],
    ["rush", (p) => (p.rush.extra = 1)],
    ["rush surcharge", (p) => (p.rush.surcharge.extra = 1)],
    ["delivery area", (p) => (p.fulfilment.delivery.areas[0].extra = 1)],
    ["orderRules", (p) => (p.orderRules.extra = 1)],
    ["provenance entry", (p) => (p.provenance.rush.extra = 1)],
    ["provenance source", (p) => (p.provenance.rush.source.extra = 1)],
  ];
  it.each(injections)("rejects unknown key in %s", (_name, mutate) => {
    const p = clone();
    mutate(p);
    expect(BusinessPolicySchema.safeParse(p).success).toBe(false);
  });
});

describe("U-SCH-3 money is bounded integer paise; strings are bounded", () => {
  it("rejects a float price", () => {
    const p = clone();
    p.catalog[0].unitPricePaise = 600.5;
    expect(BusinessPolicySchema.safeParse(p).success).toBe(false);
  });
  it("rejects a negative price and a zero price", () => {
    for (const bad of [-1, 0]) {
      const p = clone();
      p.catalog[0].unitPricePaise = bad;
      expect(BusinessPolicySchema.safeParse(p).success).toBe(false);
    }
  });
  it("rejects a negative delivery fee", () => {
    const p = clone();
    p.fulfilment.delivery.areas[0].feePaise = -5;
    expect(BusinessPolicySchema.safeParse(p).success).toBe(false);
  });
  it("rejects an over-long string", () => {
    const p = clone();
    p.business.name = "x".repeat(500);
    expect(BusinessPolicySchema.safeParse(p).success).toBe(false);
  });
  it("rejects out-of-range numbers and bad slugs/dates", () => {
    const cases: ((p: Record<string, any>) => void)[] = [
      (p) => (p.capacity.unitsPerDay = 501),
      (p) => (p.schedule.minLeadHours = 337),
      (p) => (p.schedule.maxAdvanceDays = 91),
      (p) => (p.schedule.closedWeekdays = [7]),
      (p) => (p.schedule.closedDates = ["2026-13-40"]),
      (p) => (p.schedule.dailyCutoff = "6pm"),
      (p) => (p.business.slug = "Bad Slug"),
      (p) => (p.orderRules.quoteValidityMinutes = 4),
      (p) => (p.catalog = []),
    ];
    for (const mutate of cases) {
      const p = clone();
      mutate(p);
      expect(BusinessPolicySchema.safeParse(p).success).toBe(false);
    }
  });
});

describe("U-SCH-4 a discount cannot be expressed", () => {
  it.each(["ALWAYS", "ALLOW", "", null, 10])("rejects negotiation=%s", (v) => {
    const p = clone();
    p.orderRules.negotiation = v;
    expect(BusinessPolicySchema.safeParse(p).success).toBe(false);
  });
});
