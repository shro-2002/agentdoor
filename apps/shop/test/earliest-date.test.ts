import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BusinessPolicySchema, evaluate, istDateOf, type BusinessPolicy, type QuoteRequest } from "@agentdoor/core";
import { earliestDate, earliestStandardDate } from "../src/views/format.js";
import { emptyValues, orderPage } from "../src/views/order.js";
import { firstWorkingDate, problemsFor } from "../src/views/order/problems.js";

const fixture = new URL("../../../packages/core/test/fixtures/policy.bakery.json", import.meta.url);
/**
 * The live Meera rules: 48 h notice, a 24 h rush window, closed Mondays. That leaves a dead zone:
 * today is a rush order, tomorrow is refused, the day after is a normal order.
 * Friday 20 Nov 2026, 09:30 IST.
 */
const NOW = Date.parse("2026-11-20T04:00:00Z");
const TODAY = "2026-11-20";
const TOMORROW = "2026-11-21";
const DAY_AFTER = "2026-11-22";

const policy = (): BusinessPolicy => BusinessPolicySchema.parse(JSON.parse(readFileSync(fixture, "utf8")));
const cakeOn = (date: string): QuoteRequest => ({ lines: [{ itemId: "choco-cake", qty: 1, optionIds: [] }], fulfilment: { kind: "pickup" }, date });

describe("earliest-order dates never contradict the date she chose", () => {
  it("the fixture really has the dead zone (guards the test itself)", () => {
    const p = policy();
    expect(istDateOf(NOW)).toBe(TODAY);
    expect(evaluate(p, cakeOn(TODAY), NOW)).toMatchObject({ outcome: "QUOTED", isRush: true });
    expect(evaluate(p, cakeOn(TOMORROW), NOW).outcome).toBe("REFUSED");
    expect(evaluate(p, cakeOn(DAY_AFTER), NOW)).toMatchObject({ outcome: "QUOTED", isRush: false });
  });

  it("a refused date suggests a later working date, never an earlier rush slot", () => {
    const p = policy();
    const suggestion = firstWorkingDate(p, cakeOn(TOMORROW), NOW);
    expect(suggestion).toBe(DAY_AFTER);
    const refused = evaluate(p, cakeOn(TOMORROW), NOW);
    if (refused.outcome !== "REFUSED") throw new Error("expected a refusal");
    const [problem] = problemsFor(refused.reasons, p, suggestion);
    expect(problem!.text).toContain("We need 2 days of notice");
    expect(problem!.text).toContain("The earliest day that works is Sun 22 Nov.");
    expect(problem!.text).not.toContain("Fri 20 Nov");
  });

  it("a closed Monday suggests the next open day after it", () => {
    expect(firstWorkingDate(policy(), cakeOn("2026-11-23"), NOW)).toBe("2026-11-24");
  });

  it("a date in the past still searches from today", () => {
    expect(firstWorkingDate(policy(), cakeOn("2026-11-01"), NOW)).toBe(TODAY);
  });

  it("the form defaults to the first standard day and says sooner dates carry a rush charge", () => {
    const p = policy();
    expect(earliestDate(p, NOW)).toBe(TODAY);
    expect(earliestStandardDate(p, NOW)).toBe(DAY_AFTER);
    const launch = { launched: true as const, policy: p } as Parameters<typeof orderPage>[0]["launch"];
    const html = orderPage({ launch, values: emptyValues(), earliest: earliestStandardDate(p, NOW), nowMs: NOW });
    expect(html).toContain(`min="${TODAY}"`);
    expect(html).toContain(`value="${DAY_AFTER}"`);
    expect(html).toContain("The earliest day is Sun 22 Nov. Sooner dates may be possible with a rush charge.");
  });
});
