import type { EngineOutcome, EngineResult } from "../engine/types.js";
import type { ProbeResult } from "./probes.js";
import { makeGap, type Gap } from "./types.js";

export type OwnerExpectation = "QUOTE" | "REFUSE" | "ASK_OWNER";

export interface ScenarioExpectation {
  id: string;
  ownerWouldWant: OwnerExpectation;
  relatedPaths: string[];
}

/**
 * The owner's "refuse" and "ask me" both mean "do not quote automatically";
 * only a QUOTE-vs-not mismatch is a policy hole (05 §5.2).
 */
export function classifyScenario(
  scenario: ScenarioExpectation,
  result: EngineResult,
): Gap | null {
  const wantsQuote = scenario.ownerWouldWant === "QUOTE";
  const gotQuote = result.outcome === "QUOTED";
  if (wantsQuote === gotQuote) return null;
  return makeGap(
    "SCENARIO_UNHANDLED",
    "critical",
    scenario.id,
    scenario.relatedPaths,
    {
      scenarioId: scenario.id,
      expected: scenario.ownerWouldWant,
      actual: result.outcome satisfies EngineOutcome,
    },
  );
}

/** FAIL = engine bug (blocks launch); GAP = the engine handed the decision to the owner. */
export function classifyProbeResult(result: ProbeResult): Gap | null {
  if (result.status === "PASS") return null;
  const params = { probeId: result.probeId, family: result.family };
  return result.status === "FAIL"
    ? makeGap("ENGINE_PROBE_FAILED", "critical", result.probeId, [], params)
    : makeGap("PROBE_NEEDS_OWNER", "warning", result.probeId, [], params);
}
