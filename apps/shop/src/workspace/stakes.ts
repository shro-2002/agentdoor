import { evaluate, istDateOf, simulateBusyDay, type BusinessPolicy, type BusyDayResult, type EngineResult } from "@agentdoor/core";
import { gapText } from "../../../launcher/src/flows/gapText.js";
import type { RunGap } from "../../../launcher/src/flows/rehearse.js";
import { resolveScenarios } from "../../../launcher/src/flows/scenarios.js";
import { shortDate } from "../views/format.js";
import { rupees } from "./money.js";
import type { DraftState, ProtectedStake } from "./state.js";

/**
 * "Money at stake" on an issue: a rupee figure with the working beside it. Every figure is a total the
 * engine quoted for a concrete order (the scenario's own order, or the orders of the busy-day
 * simulation). Nothing here is an estimate or a multiplier; when no such quote exists there is no stake.
 */
export interface Stake {
  paise: number;
  /** One line the owner can check by hand. */
  line: string;
}

export interface StakeContext {
  draftId: string;
  nowMs: number;
}

type Quoted = Extract<EngineResult, { outcome: "QUOTED" }>;
type Item = BusinessPolicy["catalog"][number];

const UNIT_RATE: Record<Item["unit"], (qty: number, name: string, price: string) => string> = {
  kg: (qty, name, price) => `${qty} kg ${name} at ${price}/kg`,
  dozen: (qty, name, price) => `${qty} dozen ${name} at ${price}/dozen`,
  box: (qty, name, price) => `${qty} × ${name} at ${price}/box`,
  piece: (qty, name, price) => `${qty} × ${name} at ${price} each`,
};

/** "3 kg Chocolate cake at ₹600/kg + ₹80 delivery = ₹1,880": the parts add up to the quoted total. */
function orderWords(policy: BusinessPolicy, quote: Quoted): string {
  const parts = quote.lines.map((l) => {
    const item = policy.catalog.find((c) => c.id === l.itemId);
    const base = item ? UNIT_RATE[item.unit](l.qty, item.name.en, rupees(l.unitPricePaise)) : `${l.qty} × ${l.itemId}`;
    return l.optionsPaise > 0 ? `${base} + ${rupees(l.optionsPaise)} for options` : base;
  });
  if (quote.deliveryFeePaise > 0) parts.push(`${rupees(quote.deliveryFeePaise)} delivery`);
  if (quote.rushSurchargePaise > 0) parts.push(`${rupees(quote.rushSurchargePaise)} rush charge`);
  return `${parts.join(" + ")} = ${rupees(quote.totalPaise)}`;
}

/** The scenario's own order, priced by the engine now. Only an order the shop would quote has a stake. */
function scenarioStake(gap: RunGap, policy: BusinessPolicy, state: DraftState, nowMs: number): Stake | null {
  const wire = state.scenarios?.items.find((s) => s.id === String(gap.params.scenarioId ?? ""));
  const request = wire ? resolveScenarios([wire], istDateOf(nowMs)).valid[0]?.request : undefined;
  if (!request) return null;
  const quote = evaluate(policy, request, nowMs);
  if (quote.outcome !== "QUOTED") return null;
  return { paise: quote.totalPaise, line: `Order in this case: ${orderWords(policy, quote)} quoted automatically` };
}

function noLimitStake(sim: BusyDayResult | null): Stake | null {
  if (!sim || !sim.noDailyLimit || sim.accepted === 0) return null;
  const day = shortDate(sim.calendar.rushDay);
  return { paise: sim.revenuePaise, line: `From the busy-day simulation: ${sim.accepted} orders (${rupees(sim.revenuePaise)}) accepted with no daily limit, ${sim.booked.units} units booked for ${day}` };
}

function rushStake(sim: BusyDayResult | null, policy: BusinessPolicy): Stake | null {
  const rush = sim?.results.flatMap((r) => (r.outcome.kind === "accepted" && r.outcome.isRush ? [r.outcome.totalPaise] : [])) ?? [];
  if (!policy.rush || rush.length === 0) return null;
  const paise = rush.reduce((a, b) => a + b, 0);
  return { paise, line: `From the busy-day simulation: ${rush.length} rush orders (${rupees(paise)}) accepted with the rush limit at ${policy.rush.maxRushUnitsPerDay} units a day` };
}

/** The stake of every open issue that has one, by gap id. The busy-day simulation runs only if an issue needs it. */
export function stakesFor(state: DraftState, ctx: StakeContext): Map<string, Stake> {
  const { policy, run } = state;
  const out = new Map<string, Stake>();
  if (!policy || !run) return out;
  let sim: BusyDayResult | null | undefined;
  const busy = (): BusyDayResult | null => (sim === undefined ? (sim = simulateBusyDay(policy, ctx.draftId, ctx.nowMs)) : sim);
  const compute: Partial<Record<string, (gap: RunGap) => Stake | null>> = {
    SCENARIO_UNHANDLED: (gap) => scenarioStake(gap, policy, state, ctx.nowMs),
    NO_CAPACITY_LIMIT: () => noLimitStake(busy()),
    RUSH_UNBOUNDED: () => rushStake(busy(), policy),
  };
  for (const gap of run.gaps) {
    const stake = gap.dismissed ? null : (compute[gap.code]?.(gap) ?? null);
    if (stake) out.set(gap.id, stake);
  }
  return out;
}

/** A short name for an issue: the customer's own message for a test customer, else the card's title. */
function gapLabel(gap: RunGap, policy: BusinessPolicy, state: DraftState): string {
  const scenario = state.scenarios?.items.find((s) => s.id === String(gap.params.scenarioId ?? ""));
  return scenario?.customerMessage ?? gapText(gap, policy, "en").title;
}

/** What was at stake on issues that were open before a change, remembered so a fix can show what it protected. */
export function stakesToRemember(state: DraftState, ctx: StakeContext): ProtectedStake[] {
  const { policy } = state;
  const open = stakesFor(state, ctx);
  return (state.run?.gaps ?? []).flatMap((g) => {
    const stake = open.get(g.id);
    return stake && policy ? [{ gapId: g.id, title: gapLabel(g, policy, state), paise: stake.paise, line: stake.line }] : [];
  });
}

/** Adds the remembered stakes whose issue is no longer open. Each issue counts once. */
export function settleStakes(state: DraftState, remembered: ProtectedStake[]): void {
  const stillOpen = new Set((state.run?.gaps ?? []).filter((g) => !g.dismissed).map((g) => g.id));
  const done = state.protectedStakes ?? [];
  const fresh = remembered.filter((s) => !stillOpen.has(s.gapId) && !done.some((d) => d.gapId === s.gapId));
  if (fresh.length > 0) state.protectedStakes = [...done, ...fresh];
}

export const protectedTotal = (state: DraftState): number => (state.protectedStakes ?? []).reduce((sum, s) => sum + s.paise, 0);
