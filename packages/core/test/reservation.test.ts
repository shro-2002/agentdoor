import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { capsFor, emptyLedgerRow, fitsCaps, refusalCode, reservationOf, reserve } from "../src/index.js";
import { bakery } from "./helpers.js";

const caps = { unitsCap: 5, rushCap: 2 };

describe("reservation rule (the shop's booking rule, in pure form)", () => {
  it("a rush order asks for its units twice: from the day and from the rush allowance", () => {
    expect(reservationOf(3, false)).toEqual({ units: 3, rushUnits: 0 });
    expect(reservationOf(3, true)).toEqual({ units: 3, rushUnits: 3 });
  });

  it("books up to the limit exactly and refuses the next unit", () => {
    const first = reserve(emptyLedgerRow(), reservationOf(5, false), caps);
    expect(first).toEqual({ ok: true, row: { reservedUnits: 5, rushUnits: 0 } });
    if (!first.ok) throw new Error("unreachable");
    expect(reserve(first.row, reservationOf(1, false), caps)).toEqual({ ok: false, code: "CAPACITY_FULL" });
  });

  it("names the daily limit first, the rush allowance only when the day still has room", () => {
    const row = { reservedUnits: 1, rushUnits: 2 };
    expect(reserve(row, reservationOf(1, true), caps)).toEqual({ ok: false, code: "RUSH_CAP_REACHED" });
    expect(reserve({ reservedUnits: 5, rushUnits: 2 }, reservationOf(1, true), caps)).toEqual({ ok: false, code: "CAPACITY_FULL" });
  });

  it("reads the day's limit from the policy, with an override winning over the default", () => {
    const policy = bakery();
    policy.capacity.overrides = [{ date: "2026-12-25", units: 3 }];
    expect(capsFor(policy, "2026-12-24")).toEqual({ unitsCap: policy.capacity.unitsPerDay, rushCap: policy.rush?.maxRushUnitsPerDay });
    expect(capsFor(policy, "2026-12-25").unitsCap).toBe(3);
    policy.rush = null;
    expect(capsFor(policy, "2026-12-24").rushCap).toBe(0);
  });

  it("never lets a ledger exceed either limit, whatever the orders are", () => {
    const order = fc.record({ units: fc.integer({ min: 1, max: 4 }), rush: fc.boolean() });
    fc.assert(
      fc.property(fc.array(order, { maxLength: 40 }), (orders) => {
        let row = emptyLedgerRow();
        for (const o of orders) {
          const r = reservationOf(o.units, o.rush);
          const before = row;
          const result = reserve(row, r, caps);
          expect(result.ok).toBe(fitsCaps(before, r, caps));
          if (result.ok) row = result.row;
          else expect(result.code).toBe(refusalCode(before, r, caps));
          expect(row.reservedUnits).toBeLessThanOrEqual(caps.unitsCap);
          expect(row.rushUnits).toBeLessThanOrEqual(caps.rushCap);
        }
      }),
    );
  });
});
