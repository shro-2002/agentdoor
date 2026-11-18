import { describe, expect, it } from "vitest";
import { isTerminal, transition, type OrderEvent, type OrderStatus } from "../src/index.js";

describe("order state machine", () => {
  it("U-SM-1 allowed transitions", () => {
    expect(transition("PENDING_OWNER", "confirm")).toMatchObject({ ok: true, to: "CONFIRMED" });
    expect(transition("PENDING_OWNER", "decline")).toMatchObject({ ok: true, to: "DECLINED" });
    expect(transition("CONFIRMED", "cancel")).toMatchObject({ ok: true, to: "CANCELLED" });
  });
  it("U-SM-2 everything else is rejected", () => {
    const allowed = new Set(["PENDING_OWNER:confirm", "PENDING_OWNER:decline", "CONFIRMED:cancel"]);
    const statuses: OrderStatus[] = ["PENDING_OWNER", "CONFIRMED", "DECLINED", "CANCELLED"];
    const events: OrderEvent[] = ["confirm", "decline", "cancel"];
    for (const s of statuses)
      for (const e of events)
        if (!allowed.has(`${s}:${e}`))
          expect(transition(s, e)).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(transition("DECLINED", "confirm").ok).toBe(false);
  });
  it("U-SM-3 capacity released only by decline and cancel", () => {
    expect(transition("PENDING_OWNER", "confirm")).toMatchObject({ releasesCapacity: false });
    expect(transition("PENDING_OWNER", "decline")).toMatchObject({ releasesCapacity: true });
    expect(transition("CONFIRMED", "cancel")).toMatchObject({ releasesCapacity: true });
  });
  it("terminal states", () => {
    expect(isTerminal("DECLINED") && isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("PENDING_OWNER") || isTerminal("CONFIRMED")).toBe(false);
  });
});
