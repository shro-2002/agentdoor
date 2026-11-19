import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BusinessPolicySchema, capsFor, evaluate, simulateBusyDay, type BusinessPolicy } from "@agentdoor/core";
import { readFileSync } from "node:fs";
import { placeOrder } from "../../src/db/orders.js";
import { freshPool, ledger, orderInput, quote } from "./helpers.js";

const fixture = new URL("../../../../packages/core/test/fixtures/policy.bakery.json", import.meta.url);
const NOW = Date.parse("2026-11-19T06:00:00Z");

const policyWith = (daily: number): BusinessPolicy => {
  const policy = BusinessPolicySchema.parse(JSON.parse(readFileSync(fixture, "utf8")));
  policy.capacity.unitsPerDay = daily;
  return policy;
};

let pool: Pool;
beforeAll(async () => {
  pool = await freshPool();
});
afterAll(async () => {
  await pool?.end();
});

const CODE_OF = { DAILY_LIMIT: "CAPACITY_FULL", RUSH_FULL: "RUSH_CAP_REACHED" } as const;

/**
 * The busy-day simulation books with the pure rule; the live shop books with one conditional SQL UPDATE.
 * Both get the same 50 orders in the same arrival order and must answer every one the same way.
 */
describe("the simulator's booking rule and the shop's SQL agree", () => {
  for (const daily of [10, 3, 500]) {
    it(`fixture bakery with ${daily} units a day: every order, and the final ledger`, async () => {
      const policy = policyWith(daily);
      const sim = simulateBusyDay(policy, "draft-fixture", NOW);
      if (!sim) throw new Error("the fixture shop has open days");
      await pool.end();
      pool = await freshPool();
      let compared = 0;
      for (const { order, outcome } of sim.results) {
        const quoted = evaluate(policy, order.request, order.atMs);
        if (quoted.outcome !== "QUOTED") continue;
        const date = order.request.date;
        const db = await placeOrder(pool, orderInput({ quote: quote({ capacityUnits: quoted.capacityUnits, isRush: quoted.isRush }), fulfilDate: date, capacity: capsFor(policy, date) }));
        if (outcome.kind === "accepted") expect(db.ok).toBe(true);
        else expect(db).toEqual({ ok: false, code: CODE_OF[outcome.group as keyof typeof CODE_OF] });
        compared += 1;
      }
      expect(compared).toBeGreaterThan(0);
      const booked = sim.results.flatMap((r) => (r.outcome.kind === "accepted" ? [r.order.request.date] : []));
      for (const date of new Set(booked)) {
        const units = sim.results.filter((r) => r.outcome.kind === "accepted" && r.order.request.date === date).reduce((n, r) => n + (r.outcome.kind === "accepted" ? r.outcome.units : 0), 0);
        expect((await ledger(pool, date)).reserved).toBe(units);
      }
      expect(sim.oversold).toBe(0);
    });
  }
});
