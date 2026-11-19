import type { Pool } from "mysql2/promise";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { placeOrder, transitionOrder } from "../../src/db/orders.js";
import { count, freshPool, ledger, orderInput, quote, uuid } from "./helpers.js";

let pool: Pool;
beforeEach(async () => {
  pool = await freshPool();
});
afterAll(async () => {
  await pool?.end();
});

const INTERNAL_ERRORS = ["RETRY_LATER", "INTERNAL"];

describe("concurrency", () => {
  it.each([1, 2, 3, 4, 5])(
    "C-CAP-1 run %i: 20 parallel orders on cap 5 → exactly 5, no lock errors surfaced",
    async () => {
      const results = await Promise.all(
        Array.from({ length: 20 }, () => placeOrder(pool, orderInput())),
      );
      const ok = results.filter((r) => r.ok);
      const full = results.filter((r) => !r.ok && r.code === "CAPACITY_FULL");
      expect(ok).toHaveLength(5);
      expect(full).toHaveLength(15);
      expect(results.some((r) => !r.ok && INTERNAL_ERRORS.includes(r.code))).toBe(false);
      expect((await ledger(pool)).reserved).toBe(5);
      expect(await count(pool, "orders")).toBe(5);
    },
  );

  it("I-ORD-7 concurrent idempotent retry → same orderId, one 201 and one 200", async () => {
    const input = orderInput();
    const [a, b] = await Promise.all([placeOrder(pool, input), placeOrder(pool, input)]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.orderId).toBe(b.orderId);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(await count(pool, "orders")).toBe(1);
  });

  it("I-ORD-7 rush + normal racing never exceed either counter", async () => {
    const input = (rush: boolean) =>
      orderInput({
        quote: quote({ isRush: rush }),
        capacity: { unitsCap: 4, rushCap: 2 },
      });
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, i) => placeOrder(pool, input(i % 2 === 0))),
    );
    const l = await ledger(pool);
    expect(l.reserved).toBeLessThanOrEqual(4);
    expect(l.rush).toBeLessThanOrEqual(2);
    expect(results.filter((r) => r.ok)).toHaveLength(l.reserved);
    expect(results.some((r) => !r.ok && INTERNAL_ERRORS.includes(r.code))).toBe(false);
  });

  it("I-ORD-8 10 placeOrder + 10 decline on one date: no deadlock, books balance", async () => {
    const seeded = await Promise.all(
      Array.from({ length: 10 }, () =>
        placeOrder(pool, orderInput({ capacity: { unitsCap: 30, rushCap: 30 } })),
      ),
    );
    const ids = seeded.flatMap((r) => (r.ok ? [r.orderId] : []));
    expect(ids).toHaveLength(10);
    const mixed = await Promise.all([
      ...Array.from({ length: 10 }, () =>
        placeOrder(pool, orderInput({ capacity: { unitsCap: 30, rushCap: 30 } })),
      ),
      ...ids.map((id) => transitionOrder(pool, id, "decline", { nowMs: 1 })),
    ]);
    expect(mixed.some((r) => !r.ok && INTERNAL_ERRORS.includes(r.code))).toBe(false);
    const [rows] = await pool.query(
      "SELECT COALESCE(SUM(capacity_units),0) AS s FROM orders WHERE status <> 'DECLINED'",
    );
    expect(Number((rows as { s: string }[])[0]!.s)).toBe((await ledger(pool)).reserved);
    // No redemption without an order and no order without a redemption.
    expect(await count(pool, "quote_redemptions")).toBe(await count(pool, "orders"));
    expect(uuid()).toBeTruthy();
  });
});
