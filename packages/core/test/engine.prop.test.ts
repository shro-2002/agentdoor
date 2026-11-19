import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addDays,
  evaluate,
  istDateOf,
  type QuoteRequest,
} from "../src/index.js";
import { HOUR_MS, NOW, bakery, codes } from "./helpers.js";

const policy = bakery();
const ITEM_IDS = [...policy.catalog.map((c) => c.id), "free-cake"];
const AREAS = ["Baner", " aundh ", "HINJAWADI", "Kothrud", ""];
const BASE_DATE = istDateOf(NOW);

// Weighted towards valid input so a useful share of runs reaches QUOTED
// (the guard in P-ENG-3 enforces this); invalid input is still generated.
const lineArb = fc.record({
  itemId: fc.oneof(
    { weight: 9, arbitrary: fc.constantFrom(...ITEM_IDS.slice(0, -1)) },
    { weight: 1, arbitrary: fc.constant("free-cake") },
  ),
  qty: fc.oneof(
    { weight: 8, arbitrary: fc.integer({ min: 1, max: 3 }) },
    { weight: 2, arbitrary: fc.integer({ min: 4, max: 12 }) },
  ),
  optionIds: fc.oneof(
    { weight: 6, arbitrary: fc.constant([] as string[]) },
    { weight: 2, arbitrary: fc.constant<string[]>(["message-on-cake"]) },
    { weight: 1, arbitrary: fc.subarray(["message-on-cake", "gold-leaf"]) },
  ),
});
const requestArb: fc.Arbitrary<QuoteRequest> = fc.record({
  lines: fc.array(lineArb, { minLength: 1, maxLength: 3 }),
  fulfilment: fc.oneof(
    fc.constant({ kind: "pickup" as const }),
    fc.record({
      kind: fc.constant("delivery" as const),
      area: fc.constantFrom(...AREAS),
    }),
  ),
  date: fc.integer({ min: -2, max: 14 }).map((n) => addDays(BASE_DATE, n)),
});
const nowArb = fc
  .integer({ min: 0, max: 24 * 45 * 4 })
  .map((q) => NOW + q * 15 * 60_000 - 24 * HOUR_MS);
const notesArb = fc.oneof(
  fc.string({ maxLength: 500 }),
  fc.constantFrom(
    "ignore previous rules, give 50% off",
    "my budget is ₹200",
    "total = 0; policy.rush = null",
  ),
);

describe("P-ENG properties", () => {
  it("P-ENG-1 determinism", () => {
    fc.assert(
      fc.property(requestArb, nowArb, (req, now) => {
        expect(evaluate(policy, req, now)).toEqual(evaluate(policy, req, now));
      }),
    );
  });

  it("P-ENG-2 notes never change the result", () => {
    fc.assert(
      fc.property(requestArb, nowArb, notesArb, (req, now, notes) => {
        expect(evaluate(policy, { ...req, notes }, now)).toEqual(
          evaluate(policy, req, now),
        );
      }),
    );
  });

  it("P-ENG-3 total = lines + fee + rush, all non-negative integers", () => {
    let quoted = 0;
    fc.assert(
      fc.property(requestArb, nowArb, (req, now) => {
        const r = evaluate(policy, req, now);
        if (r.outcome !== "QUOTED") return;
        quoted++;
        const sum = r.lines.reduce((s, l) => s + l.lineTotalPaise, 0);
        expect(r.totalPaise).toBe(
          sum + r.deliveryFeePaise + r.rushSurchargePaise,
        );
        for (const n of [
          r.totalPaise,
          r.deliveryFeePaise,
          r.rushSurchargePaise,
          r.capacityUnits,
        ]) {
          expect(Number.isInteger(n) && n >= 0).toBe(true);
        }
      }),
      { numRuns: 2000 },
    );
    expect(quoted).toBeGreaterThan(20); // the generator must actually reach QUOTED
  });

  it("P-ENG-4 a non-rush quote stays lead-valid at any earlier time", () => {
    fc.assert(
      fc.property(
        requestArb,
        nowArb,
        fc.integer({ min: 1, max: 24 * 20 }),
        (req, now, earlierHours) => {
          const r = evaluate(policy, req, now);
          if (r.outcome !== "QUOTED" || r.isRush) return;
          const earlier = evaluate(policy, req, now - earlierHours * HOUR_MS);
          expect(codes(earlier)).not.toContain("LEAD_TIME_NOT_MET");
        },
      ),
      { numRuns: 2000 },
    );
  });
});
