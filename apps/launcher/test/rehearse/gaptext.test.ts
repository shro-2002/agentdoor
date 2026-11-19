import { describe, expect, it } from "vitest";
import { GAP_CODES, makeGap, type Gap, type GapCode } from "@agentdoor/core";
import { gapCard, gapText } from "../../src/flows/gapText.js";
import { fixOptions } from "../../src/flows/gapFix.js";
import { bakeryPolicy, leakyPolicy } from "./helpers.js";

const words = (s: string): number => s.trim().split(/\s+/).length;
const LANGS = ["en", "hinglish"] as const;

/** One representative gap per code, with the params the core linter really emits. */
function sample(code: GapCode): Gap {
  const policy = bakeryPolicy();
  const item = policy.catalog[1]!.id; // eggless-vanilla-cake
  const table: Record<GapCode, Gap> = {
    NO_CAPACITY_LIMIT: makeGap(code, "critical", "", ["capacity.unitsPerDay"], { unitsPerDay: 500 }),
    RUSH_UNBOUNDED: makeGap(code, "critical", "", ["rush.maxRushUnitsPerDay"], { maxRushUnitsPerDay: 500 }),
    RUSH_LEAD_CONFLICT: makeGap(code, "critical", "", ["rush.withinHours"], { withinHours: 72, minLeadHours: 48 }),
    PREP_EXCEEDS_LEAD: makeGap(code, "warning", item, [`catalog[${item}].prepHours`], { itemId: item, prepHours: 72, minLeadHours: 48 }),
    UNLISTED_AREA_POLICY: makeGap(code, "critical", "", ["fulfilment.delivery.unlistedArea"]),
    AREA_ALIAS_AMBIGUOUS: makeGap(code, "warning", "aundh:wakad", [
      "fulfilment.delivery.areas[aundh].aliases",
      "fulfilment.delivery.areas[wakad].aliases",
    ]),
    NO_MIN_ORDER: makeGap(code, "warning", "", ["orderRules.minOrderPaise"]),
    UNAPPROVED_RULE: makeGap(code, "critical", `catalog[${item}].unitPricePaise`, [`catalog[${item}].unitPricePaise`]),
    LOW_CONFIDENCE_SOURCE: makeGap(code, "critical", `catalog[${item}].maxQtyPerOrder`, [`catalog[${item}].maxQtyPerOrder`]),
    DIETARY_CLAIM_UNSUPPORTED: makeGap(code, "warning", `${item}:eggless`, [`catalog[${item}].dietary`], { itemId: item, tag: "eggless" }),
    CUSTOM_REQUESTS_UNDEFINED: makeGap(code, "warning", "", ["orderRules.customRequests"]),
    SCENARIO_UNHANDLED: makeGap(code, "critical", "s1", ["capacity.unitsPerDay"], { scenarioId: "s1", expected: "REFUSE", actual: "QUOTED" }),
    ENGINE_PROBE_FAILED: makeGap(code, "critical", "LEAD_BOUNDARY-3", [], { probeId: "LEAD_BOUNDARY-3", family: "LEAD_BOUNDARY" }),
    PROBE_NEEDS_OWNER: makeGap(code, "warning", "AREAS-9", [], { probeId: "AREAS-9", family: "AREAS" }),
  };
  return table[code];
}

describe("U-REH-5 gap cards come from templates, EN and Hinglish, for every GapCode", () => {
  it("covers every GapCode (the sample table is exhaustive)", () => {
    for (const code of GAP_CODES) expect(sample(code).code).toBe(code);
  });

  for (const code of GAP_CODES) {
    it(`${code}: title <= 8 words, body <= 40 words, both languages, nothing left unfilled`, () => {
      const policy = bakeryPolicy();
      const en = gapText(sample(code), policy, "en");
      const hi = gapText(sample(code), policy, "hinglish");
      for (const t of [en, hi]) {
        expect(words(t.title)).toBeLessThanOrEqual(8);
        expect(words(t.body)).toBeLessThanOrEqual(40);
        expect(t.title.length).toBeGreaterThan(3);
        expect(`${t.title} ${t.body}`).not.toMatch(/[{}]|undefined|NaN|\[object|null/);
      }
      expect(hi.body).not.toBe(en.body);
      expect(hi.title).not.toBe(en.title);
    });
  }

  it("fills the text with the policy's own item, area and number values", () => {
    const policy = bakeryPolicy();
    const eggless = policy.catalog[1]!.name.en;
    for (const lang of LANGS) {
      expect(gapText(sample("PREP_EXCEEDS_LEAD"), policy, lang).body).toContain(eggless);
      expect(gapText(sample("PREP_EXCEEDS_LEAD"), policy, lang).body).toContain("72");
      expect(gapText(sample("DIETARY_CLAIM_UNSUPPORTED"), policy, lang).body).toContain(eggless);
      const alias = gapText(sample("AREA_ALIAS_AMBIGUOUS"), policy, lang).body;
      expect(alias).toContain("Aundh");
      expect(alias).toContain("Wakad");
      expect(gapText(sample("NO_CAPACITY_LIMIT"), policy, lang).body).toContain("500");
      expect(gapText(sample("RUSH_LEAD_CONFLICT"), policy, lang).body).toMatch(/72[\s\S]*48|48[\s\S]*72/);
    }
    // the owner's own read-back words describe an unapproved rule
    const readback = policy.provenance[`catalog[${policy.catalog[1]!.id}].unitPricePaise`]!.readback.text;
    expect(gapText(sample("UNAPPROVED_RULE"), policy, "en").body).toContain(readback);
  });

  it("a card carries the example, the severity and the typed fix choices", () => {
    const policy = leakyPolicy();
    const gap = makeGap("NO_CAPACITY_LIMIT", "critical", "", ["capacity.unitsPerDay"], { unitsPerDay: 500 });
    const card = gapCard(gap, policy, "hinglish", "kya 40 cakes mil sakte hain?");
    expect(card).toMatchObject({ gapId: "NO_CAPACITY_LIMIT", severity: "critical", example: "kya 40 cakes mil sakte hain?" });
    expect(card.fixes.map((f) => f.choice)).toEqual(["units-5", "units-10", "units-15", "units-custom"]);
    expect(card.fixes.every((f) => f.label.length > 0)).toBe(true);
    expect(card.fixes.find((f) => f.choice === "units-custom")!.needsValue).toBe(true);
    expect(fixOptions(gap, policy).map((f) => f.choice)).toEqual(card.fixes.map((f) => f.choice));
  });
});
