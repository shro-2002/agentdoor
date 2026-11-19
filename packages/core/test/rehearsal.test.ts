import { describe, expect, it } from "vitest";
import {
  PROBE_FAMILIES,
  classifyProbeResult,
  classifyScenario,
  evaluate,
  generateProbes,
  lintPolicy,
  runProbes,
} from "../src/index.js";
import { NOW, bakery, leaky, pickupReq } from "./helpers.js";

describe("U-REH-1 probes cover every family for the bakery fixture", () => {
  const policy = bakery();
  const probes = generateProbes(policy, NOW, 7);
  const results = runProbes(policy, probes);

  it("has at least 25 probes", () =>
    expect(probes.length).toBeGreaterThanOrEqual(25));
  it("covers every family (token attacks need T04 crypto and are listed separately)", () => {
    const covered = new Set(probes.map((p) => p.family));
    for (const family of PROBE_FAMILIES)
      expect(covered, family).toContain(family);
  });
  it("all pass", () => {
    const bad = results
      .filter((r) => r.status !== "PASS")
      .map((r) => `${r.probeId}: ${r.detail}`);
    expect(bad).toEqual([]);
  });
  it("probe ids are unique", () =>
    expect(new Set(probes.map((p) => p.id)).size).toBe(probes.length));
  it("is reproducible for a seed and differs across seeds", () => {
    expect(generateProbes(policy, NOW, 7)).toEqual(probes);
    expect(generateProbes(policy, NOW, 8)).not.toEqual(probes);
  });
  it("also passes for the seeded-leaky policy and the percent-rush variant", () => {
    const p = leaky();
    expect(
      runProbes(p, generateProbes(p, NOW, 1)).filter(
        (r) => r.status !== "PASS",
      ),
    ).toEqual([]);
    const pct = bakery();
    pct.rush = {
      withinHours: 24,
      surcharge: { kind: "percent", bp: 1250 },
      maxRushUnitsPerDay: 3,
    };
    pct.rush.maxRushUnitsPerDay = 3;
    expect(
      runProbes(pct, generateProbes(pct, NOW, 1)).filter(
        (r) => r.status !== "PASS",
      ),
    ).toEqual([]);
  });
  it("adapts: no rush family when rush is null, no delivery probes when delivery is off", () => {
    const p = bakery();
    p.rush = null;
    p.fulfilment.delivery.enabled = false;
    const fam = new Set(generateProbes(p, NOW, 1).map((x) => x.family));
    expect(fam.has("RUSH_CAP")).toBe(false);
    expect(fam.has("AREAS")).toBe(false);
    expect(
      runProbes(p, generateProbes(p, NOW, 1)).filter(
        (r) => r.status !== "PASS",
      ),
    ).toEqual([]);
  });
});

describe("probe runner detects a broken engine", () => {
  it("FAIL when the evaluator ignores notes invariance", () => {
    const policy = bakery();
    const broken: typeof evaluate = (p, r, n) => {
      const res = evaluate(p, r, n);
      const notes = (r as { notes?: string }).notes;
      return notes && res.outcome === "QUOTED"
        ? { ...res, totalPaise: res.totalPaise - 1 }
        : res;
    };
    const results = runProbes(policy, generateProbes(policy, NOW, 1), broken);
    expect(
      results.some((r) => r.status === "FAIL" && r.family === "HAGGLING"),
    ).toBe(true);
  });
  it("FAIL when evaluator is non-deterministic", () => {
    const policy = bakery();
    let n = 0;
    const flaky: typeof evaluate = (p, r, now) => {
      const res = evaluate(p, r, now);
      return res.outcome === "QUOTED"
        ? { ...res, capacityUnits: res.capacityUnits + (n++ % 2) }
        : res;
    };
    expect(
      runProbes(policy, generateProbes(policy, NOW, 1), flaky).some(
        (r) => r.status === "FAIL",
      ),
    ).toBe(true);
  });
  it("GAP when the engine hands back NEEDS_OWNER where a plain outcome was expected", () => {
    const policy = bakery();
    const needsOwner: typeof evaluate = () => ({
      outcome: "NEEDS_OWNER",
      reasons: [],
    });
    const results = runProbes(
      policy,
      generateProbes(policy, NOW, 1),
      needsOwner,
    );
    expect(results.some((r) => r.status === "GAP")).toBe(true);
  });
});

describe("U-REH-2 gap linter", () => {
  it("bakery fixture has no gaps", () =>
    expect(lintPolicy(bakery())).toEqual([]));

  it("seeded-leaky yields the required critical gaps", () => {
    const gaps = lintPolicy(leaky());
    const codes = gaps.map((g) => g.code);
    for (const c of [
      "NO_CAPACITY_LIMIT",
      "RUSH_UNBOUNDED",
      "UNLISTED_AREA_POLICY",
      "LOW_CONFIDENCE_SOURCE",
      "UNAPPROVED_RULE",
    ]) {
      expect(codes).toContain(c);
    }
    expect(
      gaps.filter((g) => g.severity === "critical").length,
    ).toBeGreaterThanOrEqual(4);
    expect(new Set(gaps.map((g) => g.id)).size).toBe(gaps.length);
  });

  it("each rule fires on its own trigger", () => {
    const fire = (mutate: (p: ReturnType<typeof bakery>) => void) => {
      const p = bakery();
      mutate(p);
      return lintPolicy(p).map((g) => g.code);
    };
    expect(fire((p) => (p.capacity.unitsPerDay = 500))).toContain(
      "NO_CAPACITY_LIMIT",
    );
    expect(fire((p) => (p.rush!.maxRushUnitsPerDay = 10))).toContain(
      "RUSH_UNBOUNDED",
    );
    expect(fire((p) => (p.rush!.withinHours = 72))).toContain(
      "RUSH_LEAD_CONFLICT",
    );
    expect(fire((p) => (p.catalog[0]!.prepHours = 100))).toContain(
      "PREP_EXCEEDS_LEAD",
    );
    expect(
      fire((p) => p.fulfilment.delivery.areas[1]!.aliases.push("baner")),
    ).toContain("AREA_ALIAS_AMBIGUOUS");
    expect(
      fire((p) => p.fulfilment.delivery.areas[1]!.aliases.push("ban")),
    ).toContain("AREA_ALIAS_AMBIGUOUS");
    expect(
      fire((p) => {
        p.orderRules.minOrderPaise = 0;
        p.fulfilment.delivery.areas.forEach((a) => (a.feePaise = 0));
      }),
    ).toContain("NO_MIN_ORDER");
    expect(fire((p) => delete p.provenance["capacity.unitsPerDay"])).toContain(
      "UNAPPROVED_RULE",
    );
    expect(fire((p) => (p.provenance["rush"]!.status = "proposed"))).toContain(
      "UNAPPROVED_RULE",
    );
    expect(fire((p) => (p.catalog[0]!.dietary = ["vegan"]))).toContain(
      "DIETARY_CLAIM_UNSUPPORTED",
    );
    expect(
      fire((p) => {
        p.provenance["orderRules.customRequests"] = {
          source: { kind: "owner_edit", note: "AgentDoor default — confirm" },
          readback: { lang: "en", text: "x" },
          confidence: "medium",
          status: "proposed",
          approvedAt: null,
        };
      }),
    ).toContain("CUSTOM_REQUESTS_UNDEFINED");
  });

  it("a confirmed default (approved) is not a gap, and same-area aliases are fine", () => {
    const p = bakery();
    p.provenance["capacity.unitsPerDay"] = {
      source: { kind: "owner_edit", note: "AgentDoor default — confirm" },
      readback: { lang: "en", text: "10 a day" },
      confidence: "high",
      status: "approved",
      approvedAt: "2026-11-18T12:00:00+05:30",
    };
    expect(lintPolicy(p)).toEqual([]);
  });

  it("dietary check can use a supplied transcript", () => {
    const p = bakery();
    expect(
      lintPolicy(p, { transcript: "I bake cakes" }).map((g) => g.code),
    ).toContain("DIETARY_CLAIM_UNSUPPORTED");
    expect(lintPolicy(p, { transcript: "my vanilla cake is eggless" })).toEqual(
      [],
    );
  });
});

describe("classify", () => {
  const policy = bakery();
  it("scenario mismatch becomes a critical SCENARIO_UNHANDLED gap carrying the related paths", () => {
    const result = evaluate(policy, pickupReq(), NOW);
    const gap = classifyScenario(
      {
        id: "s1",
        ownerWouldWant: "REFUSE",
        relatedPaths: ["schedule.minLeadHours"],
      },
      result,
    );
    expect(gap).toMatchObject({
      code: "SCENARIO_UNHANDLED",
      severity: "critical",
      paths: ["schedule.minLeadHours"],
    });
  });
  it("matching expectation yields no gap (all three outcomes)", () => {
    const quoted = evaluate(policy, pickupReq(), NOW);
    const refused = evaluate(policy, pickupReq("free-cake"), NOW);
    expect(
      classifyScenario(
        { id: "a", ownerWouldWant: "QUOTE", relatedPaths: [] },
        quoted,
      ),
    ).toBeNull();
    expect(
      classifyScenario(
        { id: "b", ownerWouldWant: "REFUSE", relatedPaths: [] },
        refused,
      ),
    ).toBeNull();
    expect(
      classifyScenario(
        { id: "c", ownerWouldWant: "ASK_OWNER", relatedPaths: [] },
        { outcome: "NEEDS_OWNER", reasons: [] },
      ),
    ).toBeNull();
  });
  it("probe FAIL is a critical engine gap, PASS and GAP are not auto-critical", () => {
    const base = { probeId: "p", family: "AREAS" as const, detail: "d" };
    expect(classifyProbeResult({ ...base, status: "FAIL" })).toMatchObject({
      severity: "critical",
    });
    expect(classifyProbeResult({ ...base, status: "PASS" })).toBeNull();
    expect(classifyProbeResult({ ...base, status: "GAP" })).toMatchObject({
      severity: "warning",
    });
  });
});
