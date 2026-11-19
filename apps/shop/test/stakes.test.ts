import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BusinessPolicySchema, evaluate, simulateBusyDay, type BusinessPolicy } from "@agentdoor/core";
import { vocabularyHash, type ScenarioWire } from "../../launcher/src/flows/scenarios.js";
import { recordRun, rehearseNow } from "../src/workspace/flows.js";
import { rupees } from "../src/workspace/money.js";
import { applyFix, commitPolicy } from "../src/workspace/ops.js";
import { protectedTotal, stakesFor } from "../src/workspace/stakes.js";
import { emptyState, type DraftState } from "../src/workspace/state.js";
import { DISMISS } from "../../launcher/src/flows/gapFix.js";

const fixture = new URL("../../../packages/core/test/fixtures/policy.bakery.json", import.meta.url);
/** Thursday 19 Nov 2026, 11:30 IST. */
const NOW = Date.parse("2026-11-19T06:00:00Z");
const CTX = { draftId: "draft-stakes", nowMs: NOW };

const scenario = (id: string, itemId: string, qty: number, area: string, want: ScenarioWire["ownerWouldWant"]): ScenarioWire => ({
  id,
  customerMessage: `Customer ${id}`,
  request: { lines: [{ itemId, qty, optionIds: [] }], fulfilment: { kind: "delivery", area }, daysAhead: 5, notes: null },
  ownerWouldWant: want,
  rationale: "",
  relatedPaths: [],
});

const BULK = scenario("office-bulk", "choco-cake", 3, "Aundh", "ASK_OWNER");
const UNLISTED = scenario("kothrud", "cookie-box", 1, "Kothrud", "QUOTE");

function draft(edit: (p: BusinessPolicy) => void = () => undefined): DraftState {
  const policy = BusinessPolicySchema.parse(JSON.parse(readFileSync(fixture, "utf8")));
  edit(policy);
  const state = emptyState("a bakery");
  state.policy = policy;
  state.policyVersion = 1;
  state.scenarios = { vocabHash: vocabularyHash(policy), items: [BULK, UNLISTED] };
  recordRun(state, rehearseNow(state, NOW));
  return state;
}

const gapOf = (state: DraftState, code: string) => state.run?.gaps.find((g) => g.code === code && !g.dismissed);

describe("money at stake comes only from engine quotes of concrete orders", () => {
  it("a customer case shows the scenario's own order, priced by the engine, with the working", () => {
    const state = draft();
    const gap = gapOf(state, "SCENARIO_UNHANDLED");
    const stake = stakesFor(state, CTX).get(gap!.id);
    expect(stake?.paise).toBe(188_000);
    expect(stake?.line).toBe(`Order in this case: 3 kg ${state.policy!.catalog[0]!.name.en} at ₹600/kg + ₹80 delivery = ₹1,880 quoted automatically`);
    const quote = evaluate(state.policy!, { lines: BULK.request.lines, fulfilment: { kind: "delivery", area: "Aundh" }, date: "2026-11-24" }, NOW);
    expect(quote.outcome === "QUOTED" && quote.totalPaise).toBe(188_000);
  });

  it("shows nothing when the shop would not quote the order (a refused order has no price)", () => {
    const state = draft();
    const refused = state.run!.gaps.filter((g) => g.code === "SCENARIO_UNHANDLED" && g.params.scenarioId === "kothrud");
    expect(refused).toHaveLength(1);
    expect(stakesFor(state, CTX).has(refused[0]!.id)).toBe(false);
  });

  it("shows nothing for issues that have no concrete order behind them", () => {
    const state = draft((p) => {
      p.provenance["orderRules.minOrderPaise"]!.status = "proposed";
    });
    const codes = new Set(state.run!.gaps.map((g) => g.code));
    expect(codes.has("UNAPPROVED_RULE")).toBe(true);
    const stakes = stakesFor(state, CTX);
    for (const g of state.run!.gaps.filter((x) => x.code === "UNAPPROVED_RULE")) expect(stakes.has(g.id)).toBe(false);
  });

  it("no daily limit: the stake is the revenue the busy-day simulation accepted", () => {
    const state = draft((p) => {
      p.capacity.unitsPerDay = 500;
    });
    const stake = stakesFor(state, CTX).get(gapOf(state, "NO_CAPACITY_LIMIT")!.id);
    const sim = simulateBusyDay(state.policy!, CTX.draftId, NOW)!;
    expect(stake?.paise).toBe(sim.revenuePaise);
    expect(stake?.line).toBe(`From the busy-day simulation: ${sim.accepted} orders (${rupees(sim.revenuePaise)}) accepted with no daily limit, ${sim.booked.units} units booked for Sun 22 Nov`);
  });

  it("an unbounded rush limit: the stake is the rush orders the simulation accepted", () => {
    const state = draft((p) => {
      p.rush!.maxRushUnitsPerDay = 10;
    });
    const stake = stakesFor(state, CTX).get(gapOf(state, "RUSH_UNBOUNDED")!.id);
    const sim = simulateBusyDay(state.policy!, CTX.draftId, NOW)!;
    const rush = sim.results.flatMap((r) => (r.outcome.kind === "accepted" && r.outcome.isRush ? [r.outcome.totalPaise] : []));
    expect(rush.length).toBeGreaterThan(0);
    expect(stake?.paise).toBe(rush.reduce((a, b) => a + b, 0));
    expect(stake?.line).toContain(`${rush.length} rush orders`);
    expect(stake?.line).toContain("rush limit at 10 units a day");
  });
});

describe("protected so far", () => {
  const limited = (state: DraftState): BusinessPolicy => ({ ...state.policy!, capacity: { ...state.policy!.capacity, unitsPerDay: 10 } });

  it("a fix that closes an issue keeps what was at stake on it, and the total adds those up", () => {
    const state = draft((p) => {
      p.capacity.unitsPerDay = 500;
    });
    const before = stakesFor(state, CTX).get(gapOf(state, "NO_CAPACITY_LIMIT")!.id)!;
    expect(protectedTotal(state)).toBe(0);
    commitPolicy(state, limited(state), NOW, CTX.draftId);
    expect(gapOf(state, "NO_CAPACITY_LIMIT")).toBeUndefined();
    expect(state.protectedStakes).toEqual([{ gapId: "NO_CAPACITY_LIMIT", title: expect.any(String), paise: before.paise, line: before.line }]);
    expect(protectedTotal(state)).toBe(before.paise);
  });

  it("counts an issue once, even if the same change is committed again", () => {
    const state = draft((p) => {
      p.capacity.unitsPerDay = 500;
    });
    commitPolicy(state, limited(state), NOW, CTX.draftId);
    const once = protectedTotal(state);
    commitPolicy(state, { ...limited(state), capacity: { ...state.policy!.capacity, unitsPerDay: 9 } }, NOW, CTX.draftId);
    expect(protectedTotal(state)).toBe(once);
  });

  it("accepting the shop's answer protects nothing", () => {
    const state = draft();
    const gap = gapOf(state, "SCENARIO_UNHANDLED")!;
    expect(stakesFor(state, CTX).has(gap.id)).toBe(true);
    applyFix(state, gap.id, DISMISS, undefined, NOW, CTX.draftId);
    expect(state.protectedStakes ?? []).toEqual([]);
    expect(protectedTotal(state)).toBe(0);
  });

  it("a draft saved before this feature (no list) reads as zero", () => {
    const state = draft();
    delete state.protectedStakes;
    expect(protectedTotal(state)).toBe(0);
  });
});

describe("rupees", () => {
  it("groups digits the Indian way and keeps integer paise exact", () => {
    expect(rupees(1_125_000)).toBe("₹11,250");
    expect(rupees(12_345_600)).toBe("₹1,23,456");
    expect(rupees(4_050)).toBe("₹40.50");
    expect(rupees(0)).toBe("₹0");
  });
});
