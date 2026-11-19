import { describe, expect, it } from "vitest";
import { GAP_CODES, countOpenByCategory, gapCategory } from "../src/index.js";

describe("gap categories", () => {
  it("every gap code belongs to exactly one category", () => {
    for (const code of GAP_CODES) expect(["policy", "approval", "scenario", "engine"]).toContain(gapCategory(code));
  });

  it("classifies the examples the owner sees", () => {
    expect(gapCategory("NO_CAPACITY_LIMIT")).toBe("policy");
    expect(gapCategory("UNLISTED_AREA_POLICY")).toBe("policy");
    expect(gapCategory("RUSH_UNBOUNDED")).toBe("policy");
    expect(gapCategory("UNAPPROVED_RULE")).toBe("approval");
    expect(gapCategory("LOW_CONFIDENCE_SOURCE")).toBe("approval");
    expect(gapCategory("SCENARIO_UNHANDLED")).toBe("scenario");
    expect(gapCategory("ENGINE_PROBE_FAILED")).toBe("engine");
  });

  it("counts open findings per category and never sums them", () => {
    const counts = countOpenByCategory([
      { code: "NO_CAPACITY_LIMIT" },
      { code: "UNAPPROVED_RULE" },
      { code: "UNAPPROVED_RULE" },
      { code: "SCENARIO_UNHANDLED", dismissed: true },
      { code: "SCENARIO_UNHANDLED" },
    ]);
    expect(counts).toEqual({ policy: 1, approval: 2, scenario: 1, engine: 0 });
  });
});
