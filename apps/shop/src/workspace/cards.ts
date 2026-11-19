import { gapCategory, type BusinessPolicy, type GapCategory } from "@agentdoor/core";
import { DISMISS, fixOptions } from "../../../launcher/src/flows/gapFix.js";
import { gapText } from "../../../launcher/src/flows/gapText.js";
import type { RunGap, RunResult } from "../../../launcher/src/flows/rehearse.js";
import type { DraftState } from "./state.js";

export interface IssueFix {
  choice: string;
  label: string;
  needsValue: { min: number; max: number } | null;
}

export interface IssueCard {
  gapId: string;
  code: string;
  category: GapCategory;
  dismissed: boolean;
  title: string;
  /** The realistic customer request that exposes it. */
  request: string;
  /** What would go wrong. */
  wrong: string;
  why: string;
  suggestion: string;
  fixes: IssueFix[];
  /** Where the owner can edit the rule by hand, or null. */
  editHref: string | null;
  evidence: string[];
}

interface Words {
  request: string;
  wrong: string;
  why: string;
  suggestion: string;
}

const HOURS_PER_DAY = 24;
const BIG_ORDER = 40;
const span = (h: number): string => (h % HOURS_PER_DAY === 0 && h >= HOURS_PER_DAY ? `${h / HOURS_PER_DAY} day${h === HOURS_PER_DAY ? "" : "s"}` : `${h} hours`);
const itemOf = (p: BusinessPolicy, id: unknown): string => p.catalog.find((c) => c.id === id)?.name.en ?? p.catalog[0]?.name.en ?? "a cake";
const areaOf = (p: BusinessPolicy): string => p.fulfilment.delivery.areas[0]?.name ?? "your area";

type Writer = (gap: RunGap, p: BusinessPolicy, state: DraftState) => Words;

function scenarioWords(gap: RunGap, p: BusinessPolicy, state: DraftState): Words {
  const id = String(gap.params.scenarioId ?? "");
  const item = state.scenarios?.items.find((s) => s.id === id);
  const expected = { QUOTE: "accept it", REFUSE: "turn it down", ASK_OWNER: "check with you first" }[String(gap.params.expected)] ?? "handle it differently";
  const actual = { QUOTED: "quoted it automatically", REFUSED: "turned it down", NEEDS_OWNER: "left it for you to decide" }[String(gap.params.actual)] ?? "answered differently";
  return {
    request: gap.example ?? item?.customerMessage ?? "A customer sends an unusual request.",
    wrong: `You would want the shop to ${expected}, but it ${actual}.`,
    why: item?.rationale ?? "An automatic answer that differs from what you would do can cost you money or a customer.",
    suggestion: gap.paths.length > 0 ? "Change the rule behind it, or accept the shop's answer if it is fine." : "Accept the shop's answer if it is fine.",
  };
}

const WRITERS: Partial<Record<string, Writer>> = {
  NO_CAPACITY_LIMIT: (g, p) => ({
    request: `Someone orders ${BIG_ORDER} ${itemOf(p, null)} for this weekend.`,
    wrong: `The shop has no real daily limit (it allows up to ${g.params.unitsPerDay ?? p.capacity.unitsPerDay} units), so it would accept far more than you can make.`,
    why: "One huge order could use up your whole week.",
    suggestion: "Set how many units you can really make in a day.",
  }),
  RUSH_UNBOUNDED: (g, p) => ({
    request: "Five customers each ask for a cake the same day.",
    wrong: `Same-day orders have no safe cap (up to ${g.params.maxRushUnitsPerDay ?? "many"} units a day while normal capacity is ${p.capacity.unitsPerDay}).`,
    why: "A burst of rush orders could break your day.",
    suggestion: "Pick a small rush limit, or turn rush off.",
  }),
  RUSH_LEAD_CONFLICT: (g, p) => ({
    request: `A customer asks for ${itemOf(p, null)} in ${span(Number(g.params.withinHours ?? 24))}.`,
    wrong: `Rush covers orders due within ${g.params.withinHours} hours, but normal notice is only ${g.params.minLeadHours} hours.`,
    why: "Rush would apply to orders that are not really urgent.",
    suggestion: "Make the two numbers agree.",
  }),
  PREP_EXCEEDS_LEAD: (g, p) => ({
    request: `A customer orders ${itemOf(p, g.params.itemId)} ${span(Number(g.params.minLeadHours ?? 24))} ahead.`,
    wrong: `It needs ${g.params.prepHours} hours to make, longer than your usual notice of ${g.params.minLeadHours} hours.`,
    why: "The shop will quietly use the longer time, which may surprise customers.",
    suggestion: "Keep it, or raise your usual notice.",
  }),
  UNLISTED_AREA_POLICY: (_g, p) => ({
    request: `A customer asks for delivery to a neighbourhood next to ${areaOf(p)} that you do not list.`,
    wrong: "You have not said what to do, so AgentDoor guessed.",
    why: "A wrong guess means a delivery you cannot make, or a customer turned away.",
    suggestion: "Refuse other areas, or ask you first.",
  }),
  AREA_ALIAS_AMBIGUOUS: (_g, p) => ({
    request: `A customer types a locality name that matches two of your delivery areas.`,
    wrong: "Two areas share a name, so the customer could get the wrong area and fee.",
    why: `Delivery fees would be wrong for ${areaOf(p)} or its neighbour.`,
    suggestion: "Remove the extra names, or keep them if they are fine.",
  }),
  NO_MIN_ORDER: (_g, p) => ({
    request: `A customer orders one ${itemOf(p, null)} with free delivery.`,
    wrong: "Any order is accepted, even one that costs more to deliver than it earns.",
    why: "Small orders can cost you money.",
    suggestion: "Set a minimum order amount, or keep it without one.",
  }),
  DIETARY_CLAIM_UNSUPPORTED: (g, p) => ({
    request: `A customer with an allergy asks if ${itemOf(p, g.params.itemId)} is ${g.params.tag}.`,
    wrong: `It is labelled ${g.params.tag}, but you never said so.`,
    why: "A wrong dietary label can hurt a customer.",
    suggestion: "Confirm the label, or remove it.",
  }),
  CUSTOM_REQUESTS_UNDEFINED: () => ({
    request: "A customer asks for a custom design that is not on your menu.",
    wrong: "You have not said what to do, so AgentDoor guessed.",
    why: "The shop may promise something you cannot make.",
    suggestion: "Refuse custom requests, or ask you first.",
  }),
  UNAPPROVED_RULE: (g, p) => approvalWords(g, p, "You have not confirmed this rule yet."),
  LOW_CONFIDENCE_SOURCE: (g, p) => approvalWords(g, p, "AgentDoor was not sure when it wrote this rule down."),
  SCENARIO_UNHANDLED: scenarioWords,
  ENGINE_PROBE_FAILED: (g) => ({
    request: `An automatic self-test of the price engine (${String(g.params.family ?? "check").replace(/_/g, " ")}).`,
    wrong: "The engine gave a wrong answer on a built-in check.",
    why: "Prices or refusals could be wrong for real customers.",
    suggestion: "Run the checks again. If it still fails, do not publish.",
  }),
  PROBE_NEEDS_OWNER: (g) => ({
    request: g.example ?? "An automatic test case that your rules cannot settle.",
    wrong: "The rules do not settle this case, so the shop would pass it to you.",
    why: "You may get requests the shop cannot answer alone.",
    suggestion: "Check the rule behind it.",
  }),
};

function approvalWords(g: RunGap, p: BusinessPolicy, wrong: string): Words {
  const path = g.paths[0] ?? "";
  return {
    request: `A customer's order depends on this rule: "${p.provenance[path]?.readback.text ?? path}".`,
    wrong,
    why: "The shop will not publish a rule you have not read and approved.",
    suggestion: "Read it, then approve it or change it.",
  };
}

function editHref(path: string | undefined, base: string): string | null {
  if (!path) return null;
  const tab = path.startsWith("catalog[") ? "products" : "rules";
  return `${base}/${tab}`;
}

function evidenceFor(gap: RunGap, run: RunResult, state: DraftState): string[] {
  const lines: string[] = [];
  const id = String(gap.params.scenarioId ?? "");
  const scenario = run.scenarios.find((s) => s.id === id);
  if (scenario) {
    const wire = state.scenarios?.items.find((s) => s.id === id);
    lines.push(`Customer: ${scenario.customerMessage}`, `You would want: ${scenario.ownerWouldWant}`, `The shop said: ${scenario.outcome}${scenario.reasonCodes.length ? ` (${scenario.reasonCodes.join(", ")})` : ""}`);
    if (wire) lines.push(`Request: ${JSON.stringify(wire.request)}`);
  }
  const probe = run.probes.find((p) => String(gap.params.probeId ?? "") === p.probeId);
  if (probe) lines.push(`Check: ${probe.family} (${probe.probeId})`, `Result: ${probe.status}`, probe.detail);
  if (!scenario && !probe) lines.push(`Rule: ${gap.paths.join(", ") || "(whole policy)"}`, ...Object.entries(gap.params).map(([k, v]) => `${k}: ${String(v)}`));
  return lines;
}

/** One card per finding, with the typed controls that fix it in place (no model involved). */
export function buildCards(state: DraftState, base: string): IssueCard[] {
  const { policy, run } = state;
  if (!policy || !run) return [];
  return run.gaps.map((gap) => {
    const words = (WRITERS[gap.code] ?? ((g: RunGap, p: BusinessPolicy) => ({ request: g.example ?? "", wrong: gapText(g, p, "en").body, why: "", suggestion: "" })))(gap, policy, state);
    return {
      gapId: gap.id,
      code: gap.code,
      category: gapCategory(gap.code),
      dismissed: gap.dismissed,
      title: gapText(gap, policy, "en").title,
      ...words,
      fixes: fixOptions(gap, policy).map((f) => ({
        choice: f.choice,
        label: f.choice === DISMISS ? "Accept the shop's answer" : f.label.en,
        needsValue: f.needsValue ? { min: f.needsValue.min, max: f.needsValue.max } : null,
      })),
      editHref: editHref(gap.paths[0], base),
      evidence: evidenceFor(gap, run, state),
    };
  });
}
