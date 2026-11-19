import type { BusinessPolicy, Gap, GapCode } from "@agentdoor/core";

/**
 * Plain-English wording for each kind of gap. The launcher has the same templates (plus Hinglish and
 * the fix choices); the shop is deployed without the launcher, so the read-only pages keep their own
 * English copy. No model is involved: the numbers come from the gap's own params.
 */
export interface GapWords {
  title: string;
  body: string;
}

const MAX_NAME = 30;
const clip = (s: string): string => (s.length <= MAX_NAME ? s : `${s.slice(0, MAX_NAME - 1).trimEnd()}…`);
const humanize = (code: string): string => code.toLowerCase().replace(/_/g, " ");

interface Ctx {
  p: (key: string) => string;
  item: string;
  areas: string;
  readback: string;
  policy?: BusinessPolicy;
}

const SCENARIO_EXPECTED: Record<string, string> = { QUOTE: "accept the order", REFUSE: "refuse the order", ASK_OWNER: "ask you first" };
const SCENARIO_ACTUAL: Record<string, string> = { QUOTED: "quoted it automatically", REFUSED: "refused it", NEEDS_OWNER: "left it to you" };

const TEMPLATES: Record<GapCode, (c: Ctx) => GapWords> = {
  NO_CAPACITY_LIMIT: (c) => ({
    title: "Orders had no real daily limit",
    body: `Customers could order up to ${c.p("unitsPerDay")} units in one day. Nobody can bake that much, so one big order could swallow the week.`,
  }),
  RUSH_UNBOUNDED: (c) => ({
    title: "Rush orders had no safe cap",
    body: `Same-day rush orders were allowed up to ${c.p("maxRushUnitsPerDay")} units a day, while normal capacity is ${c.policy?.capacity.unitsPerDay ?? "far lower"}. A burst of rush orders could break the day.`,
  }),
  RUSH_LEAD_CONFLICT: (c) => ({
    title: "Rush window was longer than the notice",
    body: `Orders due within ${c.p("withinHours")} hours counted as rush, but normal notice is only ${c.p("minLeadHours")} hours.`,
  }),
  PREP_EXCEEDS_LEAD: (c) => ({
    title: "Prep time was longer than the notice",
    body: `${c.item} needs ${c.p("prepHours")} hours to prepare, but the usual notice is ${c.p("minLeadHours")} hours.`,
  }),
  UNLISTED_AREA_POLICY: (c) => ({
    title: "Unknown delivery areas were not decided",
    body: `Delivery covers ${c.areas}. If someone asked for another area, AgentDoor had guessed what to do.`,
  }),
  AREA_ALIAS_AMBIGUOUS: () => ({
    title: "Two delivery areas looked alike",
    body: "Two areas shared a name or alias, so a customer could be matched to the wrong area and fee.",
  }),
  NO_MIN_ORDER: (c) => ({
    title: "There was no minimum order amount",
    body: `Any order was accepted, even a single ${c.item} with free delivery. That may cost more than it earns.`,
  }),
  UNAPPROVED_RULE: (c) => ({
    title: "A rule was waiting for the owner's OK",
    body: `Not yet confirmed: “${c.readback}”. AgentDoor will not launch a rule the owner has not approved.`,
  }),
  LOW_CONFIDENCE_SOURCE: (c) => ({
    title: "AgentDoor was not sure about a rule",
    body: `AgentDoor was unsure when it wrote down: “${c.readback}”. The owner read it and approved or changed it.`,
  }),
  DIETARY_CLAIM_UNSUPPORTED: (c) => ({
    title: "A dietary label was not in the owner's words",
    body: `${c.item} was marked ${c.p("tag")}, but the owner never said that. A wrong dietary label can hurt a customer.`,
  }),
  CUSTOM_REQUESTS_UNDEFINED: () => ({
    title: "Custom orders were not decided",
    body: "If a customer asked for a custom design or something off the menu, AgentDoor had guessed the answer.",
  }),
  SCENARIO_UNHANDLED: (c) => ({
    title: "A customer case went the wrong way",
    body: `For this customer the owner would want the shop to ${SCENARIO_EXPECTED[c.p("expected")] ?? c.p("expected")}, but it ${SCENARIO_ACTUAL[c.p("actual")] ?? c.p("actual")}.`,
  }),
  ENGINE_PROBE_FAILED: (c) => ({
    title: "AgentDoor's own self-test failed",
    body: `A built-in check (${humanize(c.p("family"))}) gave a wrong answer. Launch stays blocked until it is fixed.`,
  }),
  PROBE_NEEDS_OWNER: (c) => ({
    title: "A check needed the owner's decision",
    body: `A test case (${humanize(c.p("family"))}) cannot be settled by the rules, so the shop would pass it to the owner.`,
  }),
};

export function gapWords(gap: Pick<Gap, "code" | "params" | "paths">, policy: BusinessPolicy): GapWords {
  const path = gap.paths[0] ?? "";
  const itemId = gap.params.itemId ?? policy.catalog[0]?.id;
  const areas = policy.fulfilment.delivery.areas.slice(0, 3).map((a) => clip(a.name));
  const ctx: Ctx = {
    p: (key) => String(gap.params[key] ?? ""),
    item: clip(policy.catalog.find((c) => c.id === itemId)?.name.en ?? "this item"),
    areas: areas.length > 0 ? areas.join(", ") : "the listed areas",
    readback: policy.provenance[path]?.readback.text ?? path,
    policy,
  };
  return TEMPLATES[gap.code](ctx);
}

/** Title only: the launch report knows a gap by its code and id, not by the full gap. */
export const gapTitle = (code: string): string => {
  const known = TEMPLATES[code as GapCode];
  return known ? known({ p: () => "…", item: "an item", areas: "the listed areas", readback: "…" }).title : humanize(code);
};
