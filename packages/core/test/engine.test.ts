import { describe, expect, it } from "vitest";
import { evaluate } from "../src/index.js";
import {
  FAR_DATE,
  NOW,
  bakery,
  codes,
  deliveryReq,
  nowFor,
  pickupReq,
} from "./helpers.js";

describe("U-ENG-1 exact arithmetic", () => {
  it("prices lines, options, delivery fee and total", () => {
    const r = evaluate(
      bakery(),
      {
        lines: [
          { itemId: "choco-cake", qty: 2, optionIds: ["message-on-cake"] },
          { itemId: "eggless-vanilla-cake", qty: 1, optionIds: [] },
        ],
        fulfilment: { kind: "delivery", area: "Aundh" },
        date: FAR_DATE,
      },
      NOW,
    );
    // choco: 2*60000 + 2*5000 = 130000; vanilla: 65000; subtotal 195000; Aundh fee 8000
    expect(r).toMatchObject({
      outcome: "QUOTED",
      deliveryFeePaise: 8000,
      rushSurchargePaise: 0,
      totalPaise: 203000,
      capacityUnits: 6,
      isRush: false,
    });
    if (r.outcome !== "QUOTED") throw new Error("unreachable");
    expect(r.lines).toEqual([
      {
        itemId: "choco-cake",
        qty: 2,
        unitPricePaise: 60000,
        optionsPaise: 10000,
        lineTotalPaise: 130000,
      },
      {
        itemId: "eggless-vanilla-cake",
        qty: 1,
        unitPricePaise: 65000,
        optionsPaise: 0,
        lineTotalPaise: 65000,
      },
    ]);
  });
});

describe("U-ENG-2 lead time", () => {
  const date = "2026-11-21"; // Saturday
  it("47h59m ahead is refused", () => {
    const r = evaluate(
      bakery(),
      pickupReq("cookie-box", 1, date),
      nowFor(date, 47, 59),
    );
    expect(r.outcome).toBe("REFUSED");
    expect(codes(r)).toContain("LEAD_TIME_NOT_MET");
  });
  it("exactly 48h ahead is quoted", () => {
    expect(
      evaluate(bakery(), pickupReq("cookie-box", 1, date), nowFor(date, 48))
        .outcome,
    ).toBe("QUOTED");
  });
  it("a date in the past is refused", () => {
    const r = evaluate(
      bakery(),
      pickupReq("cookie-box", 1, date),
      nowFor(date, -1),
    );
    expect(codes(r)).toContain("LEAD_TIME_NOT_MET");
  });
});

describe("U-ENG-3 prep hours beat lead time", () => {
  const date = "2026-11-21";
  const slow = () => {
    const p = bakery();
    p.catalog.find((c) => c.id === "cookie-box")!.prepHours = 72;
    return p;
  };
  it("refused at 71h, quoted at 72h", () => {
    expect(
      evaluate(slow(), pickupReq("cookie-box", 1, date), nowFor(date, 71))
        .outcome,
    ).toBe("REFUSED");
    expect(
      evaluate(slow(), pickupReq("cookie-box", 1, date), nowFor(date, 72))
        .outcome,
    ).toBe("QUOTED");
  });
  it("uses the largest prep among the lines", () => {
    const r = evaluate(
      slow(),
      {
        lines: [
          { itemId: "brownie-dozen", qty: 1, optionIds: [] },
          { itemId: "cookie-box", qty: 1, optionIds: [] },
        ],
        fulfilment: { kind: "pickup" },
        date,
      },
      nowFor(date, 60),
    );
    expect(codes(r)).toContain("LEAD_TIME_NOT_MET");
  });
});

describe("U-ENG-4 rush", () => {
  const date = "2026-11-21";
  it("inside the rush window: surcharge and RUSH_APPLIED (rush waives lead; see STATUS decision)", () => {
    const r = evaluate(
      bakery(),
      pickupReq("cookie-box", 1, date),
      nowFor(date, 10),
    );
    expect(r).toMatchObject({
      outcome: "QUOTED",
      isRush: true,
      rushSurchargePaise: 20000,
      totalPaise: 55000,
    });
    expect(codes(r)).toContain("RUSH_APPLIED");
  });
  it("between the rush window and the lead time: plain lead refusal, no rush", () => {
    const r = evaluate(
      bakery(),
      pickupReq("cookie-box", 1, date),
      nowFor(date, 30),
    );
    expect(r.outcome).toBe("REFUSED");
    expect(codes(r)).toEqual(["LEAD_TIME_NOT_MET"]);
  });
  it("rush disabled: refusal also says RUSH_NOT_OFFERED", () => {
    const p = bakery();
    p.rush = null;
    const r = evaluate(p, pickupReq("cookie-box", 1, date), nowFor(date, 10));
    expect(codes(r)).toEqual(["LEAD_TIME_NOT_MET", "RUSH_NOT_OFFERED"]);
  });
  it("a single rush order over maxRushUnitsPerDay is refused", () => {
    const r = evaluate(
      bakery(),
      pickupReq("cookie-box", 3, date),
      nowFor(date, 10),
    );
    expect(codes(r)).toEqual(["RUSH_CAP_REACHED"]);
  });
  it("the rush window is strict: exactly withinHours is not rush", () => {
    const p = bakery();
    p.schedule.minLeadHours = 12;
    p.catalog.forEach((c) => (c.prepHours = 0));
    const r = evaluate(p, pickupReq("cookie-box", 1, date), nowFor(date, 24));
    expect(r).toMatchObject({ outcome: "QUOTED", isRush: false });
  });
});

describe("U-ENG-5 closed days", () => {
  it("closed weekday (Monday)", () => {
    const date = "2026-11-23";
    expect(
      codes(
        evaluate(bakery(), pickupReq("cookie-box", 1, date), nowFor(date, 100)),
      ),
    ).toEqual(["CLOSED_DAY"]);
  });
  it("closed date", () => {
    const p = bakery();
    p.schedule.closedDates = ["2026-11-25"];
    expect(
      codes(evaluate(p, pickupReq("cookie-box", 1, "2026-11-25"), NOW)),
    ).toEqual(["CLOSED_DAY"]);
  });
});

describe("U-ENG-6 advance window", () => {
  it("30 days ahead is fine, 31 is refused", () => {
    const now = nowFor("2026-11-19", 0);
    expect(
      evaluate(bakery(), pickupReq("cookie-box", 1, "2026-12-19"), now).outcome,
    ).toBe("QUOTED");
    expect(
      codes(evaluate(bakery(), pickupReq("cookie-box", 1, "2026-12-20"), now)),
    ).toEqual(["TOO_FAR_AHEAD"]);
  });
});

describe("U-ENG-7 quantity bounds", () => {
  const p = () => {
    const b = bakery();
    b.catalog.find((c) => c.id === "cookie-box")!.minQty = 2;
    return b;
  };
  it("below min", () =>
    expect(codes(evaluate(p(), pickupReq("cookie-box", 1), NOW))).toEqual([
      "QTY_BELOW_MIN",
    ]));
  it("above max", () =>
    expect(codes(evaluate(p(), pickupReq("cookie-box", 11), NOW))).toEqual([
      "QTY_ABOVE_MAX",
    ]));
  it("too many lines", () => {
    const b = bakery();
    b.orderRules.maxLinesPerOrder = 1;
    const req = pickupReq();
    req.lines.push({ itemId: "brownie-dozen", qty: 1, optionIds: [] });
    expect(codes(evaluate(b, req, NOW))).toEqual(["TOO_MANY_LINES"]);
  });
});

describe("U-ENG-8 delivery areas", () => {
  it("matches alias after trim + lowercase", () => {
    const r = evaluate(bakery(), deliveryReq("  HINJAWADI "), NOW);
    expect(r).toMatchObject({ outcome: "QUOTED", deliveryFeePaise: 15000 });
  });
  it("unlisted + REFUSE", () => {
    expect(codes(evaluate(bakery(), deliveryReq("Kothrud"), NOW))).toEqual([
      "AREA_NOT_SERVED",
    ]);
  });
  it("unlisted + ASK_OWNER", () => {
    const p = bakery();
    p.fulfilment.delivery.unlistedArea = "ASK_OWNER";
    const r = evaluate(p, deliveryReq("Kothrud"), NOW);
    expect(r.outcome).toBe("NEEDS_OWNER");
    expect(codes(r)).toEqual(["AREA_NEEDS_OWNER"]);
  });
  it("a later refusal beats NEEDS_OWNER", () => {
    const p = bakery();
    p.fulfilment.delivery.unlistedArea = "ASK_OWNER";
    p.orderRules.minOrderPaise = 1_000_000;
    expect(evaluate(p, deliveryReq("Kothrud"), NOW).outcome).toBe("REFUSED");
  });
  it("delivery disabled", () => {
    const p = bakery();
    p.fulfilment.delivery.enabled = false;
    expect(codes(evaluate(p, deliveryReq("Baner"), NOW))).toEqual([
      "DELIVERY_NOT_OFFERED",
    ]);
  });
  it("pickup disabled", () => {
    const p = bakery();
    p.fulfilment.pickup.enabled = false;
    expect(evaluate(p, pickupReq(), NOW).outcome).toBe("REFUSED");
  });
});

describe("U-ENG-9 minimum order (on the item subtotal, before fee and rush)", () => {
  const p = () => {
    const b = bakery();
    b.orderRules.minOrderPaise = 70000;
    return b;
  };
  it("below", () =>
    expect(codes(evaluate(p(), pickupReq("cookie-box", 1), NOW))).toEqual([
      "BELOW_MIN_ORDER",
    ]));
  it("exactly at", () =>
    expect(evaluate(p(), pickupReq("cookie-box", 2), NOW).outcome).toBe(
      "QUOTED",
    ));
  it("a delivery fee does not satisfy the minimum", () => {
    expect(
      evaluate(p(), deliveryReq("Wakad", "cookie-box", 1), NOW).outcome,
    ).toBe("REFUSED");
  });
});

describe("U-ENG-10 single-order capacity", () => {
  const two = (date = FAR_DATE) => ({
    lines: [
      { itemId: "choco-cake", qty: 3, optionIds: [] },
      { itemId: "choco-cake", qty: 3, optionIds: [] },
    ],
    fulfilment: { kind: "pickup" as const },
    date,
  });
  it("12 units > 10 per day", () =>
    expect(codes(evaluate(bakery(), two(), NOW))).toEqual(["CAPACITY_FULL"]));
  it("a date override lowers the cap", () => {
    const p = bakery();
    p.capacity.overrides = [{ date: FAR_DATE, units: 5 }];
    expect(codes(evaluate(p, pickupReq("choco-cake", 3), NOW))).toEqual([
      "CAPACITY_FULL",
    ]);
    expect(evaluate(bakery(), pickupReq("choco-cake", 3), NOW).outcome).toBe(
      "QUOTED",
    );
  });
});

describe("U-ENG-11 unknown ids and bad input", () => {
  it("unknown item", () => {
    expect(codes(evaluate(bakery(), pickupReq("free-cake"), NOW))).toEqual([
      "UNKNOWN_ITEM",
    ]);
  });
  it("unknown option", () => {
    const req = pickupReq();
    req.lines[0]!.optionIds = ["gold-leaf"];
    expect(codes(evaluate(bakery(), req, NOW))).toEqual(["UNKNOWN_ITEM"]);
  });
  it.each([
    ["garbage", 42],
    ["extra key", { ...pickupReq(), discount: 50 }],
    ["zero qty", pickupReq("cookie-box", 0)],
    ["bad date", pickupReq("cookie-box", 1, "2026-02-30")],
    [
      "duplicate options",
      {
        lines: [{ itemId: "choco-cake", qty: 1, optionIds: ["a", "a"] }],
        fulfilment: { kind: "pickup" },
        date: FAR_DATE,
      },
    ],
  ])("schema failure: %s", (_n, bad) => {
    expect(codes(evaluate(bakery(), bad, NOW))).toEqual(["VALIDATION_FAILED"]);
  });
});

describe("U-ENG-12 percent rush rounds half-up in basis points", () => {
  const date = "2026-11-21";
  const percent = (bp: number) => {
    const p = bakery();
    p.rush = {
      withinHours: 24,
      surcharge: { kind: "percent", bp },
      maxRushUnitsPerDay: 5,
    };
    return evaluate(p, pickupReq("cookie-box", 1, date), nowFor(date, 10));
  };
  it.each([
    [333, 1166], // 35000 * 3.33% = 1165.5 -> 1166
    [249, 872], //  871.5 -> 872
    [1000, 3500], // exact
    [1, 4], //  3.5 -> 4
    [0, 0],
  ])("bp %i -> %i paise", (bp, expected) => {
    expect(percent(bp)).toMatchObject({
      outcome: "QUOTED",
      rushSurchargePaise: expected,
      totalPaise: 35000 + expected,
    });
  });
});
