import type { Pool } from "mysql2/promise";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { placeOrder, transitionOrder } from "../../src/db/orders.js";
import {
  count,
  customer,
  freshPool,
  ledger,
  orderInput,
  quote,
} from "./helpers.js";

let pool: Pool;
beforeEach(async () => {
  pool = await freshPool();
});
afterAll(async () => {
  await pool?.end();
});

const place = (o = {}) => placeOrder(pool, orderInput(o));

describe("placeOrder", () => {
  it("I-ORD-1 persists PENDING_OWNER, reserves units, writes redemption + audit", async () => {
    const q = quote({ capacityUnits: 2 });
    const r = await place({ quote: q });
    expect(r).toMatchObject({ ok: true, created: true, status: "PENDING_OWNER" });
    expect(r.ok && r.accessToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(await ledger(pool)).toEqual({ reserved: 2, rush: 0 });
    expect(await count(pool, "quote_redemptions")).toBe(1);
    expect(await count(pool, "audit_events")).toBe(1);
    const [rows] = await pool.query("SELECT access_token_hash, status FROM orders");
    expect((rows as { access_token_hash: string }[])[0]!.access_token_hash).toHaveLength(64);
  });

  it("I-ORD-2 reusing a quote with another idem key → QUOTE_ALREADY_USED", async () => {
    const q = quote();
    expect((await place({ quote: q })).ok).toBe(true);
    const r = await place({ quote: q });
    expect(r).toMatchObject({ ok: false, code: "QUOTE_ALREADY_USED" });
    expect(await ledger(pool)).toEqual({ reserved: 1, rush: 0 });
    expect(await count(pool, "orders")).toBe(1);
  });

  it("I-ORD-3 same idem key + same body → same order, one row, no token", async () => {
    const input = orderInput();
    const a = await placeOrder(pool, input);
    const b = await placeOrder(pool, input);
    expect(a.ok && b.ok && a.orderId === b.orderId).toBe(true);
    expect(b.ok && b.created).toBe(false);
    expect(b.ok && b.accessToken).toBeUndefined();
    expect(await count(pool, "orders")).toBe(1);
  });

  it("I-ORD-4 same idem key + different body → IDEMPOTENCY_CONFLICT", async () => {
    const input = orderInput();
    await placeOrder(pool, input);
    const r = await placeOrder(pool, {
      ...input,
      customer: { ...customer, name: "Someone Else" },
    });
    expect(r).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("I-ORD-6 third rush unit on a cap-2 day → RUSH_CAP_REACHED", async () => {
    const rush = () => place({ quote: quote({ isRush: true }) });
    expect((await rush()).ok).toBe(true);
    expect((await rush()).ok).toBe(true);
    expect(await rush()).toMatchObject({ ok: false, code: "RUSH_CAP_REACHED" });
    expect(await ledger(pool)).toEqual({ reserved: 2, rush: 2 });
    expect(await count(pool, "quote_redemptions")).toBe(2);
  });

  it("CAPACITY_FULL leaves no redemption or order behind", async () => {
    expect((await place({ quote: quote({ capacityUnits: 5 }) })).ok).toBe(true);
    const r = await place();
    expect(r).toMatchObject({ ok: false, code: "CAPACITY_FULL" });
    expect(await count(pool, "quote_redemptions")).toBe(1);
    expect(await count(pool, "orders")).toBe(1);
  });
});

describe("transitionOrder", () => {
  it("I-ORD-5 decline releases capacity; double decline and confirm-after-decline → 409 code", async () => {
    const q = quote({ capacityUnits: 2, isRush: true });
    const placed = await place({ quote: q });
    if (!placed.ok) throw new Error("setup");
    expect(await ledger(pool)).toEqual({ reserved: 2, rush: 2 });
    const d = await transitionOrder(pool, placed.orderId, "decline", { nowMs: 1 });
    expect(d).toMatchObject({ ok: true, to: "DECLINED" });
    expect(await ledger(pool)).toEqual({ reserved: 0, rush: 0 });
    expect(await transitionOrder(pool, placed.orderId, "decline", { nowMs: 1 })).toMatchObject({
      ok: false,
      code: "INVALID_TRANSITION",
    });
    expect(await transitionOrder(pool, placed.orderId, "confirm", { nowMs: 1 })).toMatchObject({
      ok: false,
      code: "INVALID_TRANSITION",
    });
    expect(await ledger(pool)).toEqual({ reserved: 0, rush: 0 });
  });

  it("confirm keeps capacity; cancel after confirm releases it", async () => {
    const placed = await place();
    if (!placed.ok) throw new Error("setup");
    await transitionOrder(pool, placed.orderId, "confirm", { nowMs: 1 });
    expect(await ledger(pool)).toEqual({ reserved: 1, rush: 0 });
    await transitionOrder(pool, placed.orderId, "cancel", { nowMs: 1 });
    expect(await ledger(pool)).toEqual({ reserved: 0, rush: 0 });
  });

  it("unknown order → ORDER_NOT_FOUND", async () => {
    expect(await transitionOrder(pool, "0".repeat(26), "confirm", { nowMs: 1 })).toMatchObject({
      ok: false,
      code: "ORDER_NOT_FOUND",
    });
  });
});
