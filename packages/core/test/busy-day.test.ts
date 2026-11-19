import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BUSY_DAY_ORDERS, evaluate, simulateBusyDay, type BusinessPolicy } from "../src/index.js";
import { bakery } from "./helpers.js";

/** Thursday 19 Nov 2026, 11:30 IST. */
const NOW = Date.parse("2026-11-19T06:00:00Z");
const DRAFT = "draft-fixture";

const run = (policy: BusinessPolicy = bakery(), draft = DRAFT) => {
  const result = simulateBusyDay(policy, draft, NOW);
  if (!result) throw new Error("the fixture shop has open days");
  return result;
};
const groups = (r: ReturnType<typeof run>) => Object.fromEntries(r.refusals.map((x) => [x.group, x.count]));

describe("busy-day simulation", () => {
  it("is deterministic: the same draft, rules and day give the same 50 orders and the same answers", () => {
    expect(run()).toEqual(run());
    expect(run().results).toHaveLength(BUSY_DAY_ORDERS);
  });

  it("changes with the draft id or with a rule, because the seed is the draft id plus the policy hash", () => {
    const base = JSON.stringify(run().results.map((r) => r.order.request));
    expect(JSON.stringify(run(bakery(), "another-draft").results.map((r) => r.order.request))).not.toBe(base);
    const edited = bakery();
    edited.catalog[0]!.unitPricePaise += 100;
    expect(JSON.stringify(run(edited).results.map((r) => r.order.request))).not.toBe(base);
  });

  it("fixture: the exact figures for the fixture bakery (10 units a day) on the rush day", () => {
    const r = run();
    expect(r.calendar).toEqual({ today: "2026-11-19", rushDay: "2026-11-22", tomorrow: "2026-11-20", closedDay: "2026-11-23" });
    expect(r.accepted).toBe(4);
    expect(r.revenuePaise).toBe(532_000);
    expect(r.booked).toEqual({ units: 10, limit: 10 });
    expect(groups(r)).toEqual({ DAILY_LIMIT: 30, RUSH_FULL: 3, TOO_SOON: 3, CLOSED: 3, AREA: 3, OVER_LIMIT: 4 });
    expect(r.noDailyLimit).toBe(false);
    expect(r.oversold).toBe(0);
  });

  it("every refusal group in the brief appears, each for the right reason", () => {
    const r = run();
    const reasons = (kind: string) => new Set(r.results.filter((x) => x.order.kind === kind).map((x) => (x.outcome.kind === "refused" ? x.outcome.group : "ACCEPTED")));
    expect(reasons("overLimit")).toEqual(new Set(["OVER_LIMIT"]));
    expect(reasons("unlistedArea")).toEqual(new Set(["AREA"]));
    expect(reasons("closedDay")).toEqual(new Set(["CLOSED"]));
    expect(reasons("tooSoon")).toEqual(new Set(["TOO_SOON"]));
    expect([...reasons("nextDay")].every((g) => g === "RUSH_FULL" || g === "ACCEPTED")).toBe(true);
  });

  it("draws only from the draft's own menu and delivery areas, plus the deliberate unlisted ones", () => {
    const policy = bakery();
    const items = new Set(policy.catalog.map((c) => c.id));
    const areas = new Set(policy.fulfilment.delivery.areas.map((a) => a.name));
    for (const { order } of run(policy).results) {
      for (const line of order.request.lines) expect(items.has(line.itemId)).toBe(true);
      if (order.request.fulfilment.kind === "delivery" && order.kind !== "unlistedArea") expect(areas.has(order.request.fulfilment.area)).toBe(true);
    }
  });

  it("arrivals fall inside one hour and are in order", () => {
    const times = run().results.map((r) => r.order.atMs - NOW);
    expect(Math.min(...times)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...times)).toBeLessThan(3_600_000);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("prices every accepted order with the engine's own quote", () => {
    const policy = bakery();
    for (const { order, outcome } of run(policy).results) {
      const quote = evaluate(policy, order.request, order.atMs);
      if (outcome.kind === "accepted") {
        expect(quote.outcome).toBe("QUOTED");
        expect(quote.outcome === "QUOTED" && quote.totalPaise).toBe(outcome.totalPaise);
      }
    }
  });

  it("no daily limit: the day's limit never refuses anyone, and the result says there is no limit", () => {
    const policy = bakery();
    policy.capacity.unitsPerDay = 500;
    const r = run(policy);
    expect(r.noDailyLimit).toBe(true);
    expect(groups(r).DAILY_LIMIT).toBeUndefined();
    expect(r.booked).toEqual({ units: 122, limit: 500 });
    expect(r.accepted).toBe(34);
    expect(r.revenuePaise).toBe(4_512_000);
  });

  it("is never oversold, whatever the daily and rush limits are", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), fc.integer({ min: 0, max: 40 }), fc.boolean(), (daily, rushCap, rushOn) => {
        const policy = bakery();
        policy.capacity.unitsPerDay = daily;
        policy.rush = rushOn && policy.rush ? { ...policy.rush, maxRushUnitsPerDay: rushCap } : null;
        const r = run(policy);
        expect(r.oversold).toBe(0);
        expect(r.booked.units).toBeLessThanOrEqual(r.booked.limit);
      }),
      { numRuns: 60 },
    );
  });

  it("returns null when no day can be booked", () => {
    const policy = bakery();
    policy.schedule.closedWeekdays = [0, 1, 2, 3, 4, 5, 6];
    expect(simulateBusyDay(policy, DRAFT, NOW)).toBeNull();
  });

  it("skips the closed-day orders when the shop is never closed", () => {
    const policy = bakery();
    policy.schedule.closedWeekdays = [];
    const r = run(policy);
    expect(r.calendar.closedDay).toBeNull();
    expect(r.results.some((x) => x.order.kind === "closedDay")).toBe(false);
  });
});
