import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { istDateOf } from "@agentdoor/core";
import { buildScenariosUser, calendarLines, resolveScenarios, runScenarios } from "../../src/flows/scenarios.js";
import { bakeryPolicy, pinClock, rehearse, scenario, setup } from "./helpers.js";

beforeEach(() => pinClock());
afterEach(() => vi.unstubAllEnvs());

const NOW_MS = Date.parse("2026-11-19T06:00:00Z");

describe("U-REH-3 scenario runner", () => {
  it("resolves daysAhead against the injected IST clock, never an absolute date", () => {
    const { valid } = resolveScenarios([scenario("a", { request: { ...scenario("a").request, daysAhead: 5 } })], "2026-11-19");
    expect(valid[0]!.request.date).toBe("2026-11-24");
    const midnight = resolveScenarios([scenario("a", { request: { ...scenario("a").request, daysAhead: 0 } })], istDateOf(Date.parse("2026-11-19T20:00:00Z")));
    expect(midnight.valid[0]!.request.date).toBe("2026-11-20");
  });

  it("drops schema-invalid scenarios and counts them", () => {
    const base = scenario("ok").request;
    const bad: unknown[] = [
      scenario("qty-zero", { request: { ...base, lines: [{ itemId: "cookie-box", qty: 0, optionIds: [] }] } }),
      scenario("no-lines", { request: { ...base, lines: [] } }),
      scenario("delivery-no-area", { request: { ...base, fulfilment: { kind: "delivery", area: null } } }),
      scenario("negative-days", { request: { ...base, daysAhead: -1 } }),
      scenario("far-days", { request: { ...base, daysAhead: 400 } }),
      scenario("fraction-days", { request: { ...base, daysAhead: 1.5 } }),
      scenario("Bad Id!"),
      { id: "missing-everything" },
      "not an object",
      null,
    ];
    const { valid, dropped } = resolveScenarios([scenario("ok"), ...bad, scenario("ok")], "2026-11-19");
    expect(valid.map((s) => s.wire.id)).toEqual(["ok"]);
    expect(dropped).toBe(bad.length + 1); // + the duplicate id
  });

  it("turns QUOTE-vs-not mismatches into critical SCENARIO_UNHANDLED gaps; refuse and ask both mean 'not automatic'", () => {
    const policy = bakeryPolicy();
    const base = scenario("x").request;
    const wires = [
      scenario("fine"),
      scenario("unknown-item", { request: { ...base, lines: [{ itemId: "free-cake", qty: 1, optionIds: [] }] }, relatedPaths: ["capacity.unitsPerDay"] }),
      scenario("wanted-refusal", { ownerWouldWant: "REFUSE", relatedPaths: ["orderRules.minOrderPaise"] }),
      scenario("ask-and-refused", { ownerWouldWant: "ASK_OWNER", request: { ...base, lines: [{ itemId: "free-cake", qty: 1, optionIds: [] }] } }),
    ];
    const { valid, dropped } = resolveScenarios(wires, "2026-11-19");
    expect(dropped).toBe(0);
    const outcomes = runScenarios(policy, valid, NOW_MS);
    const gaps = Object.fromEntries(outcomes.map((o) => [o.id, o.gap]));
    expect(gaps["fine"]).toBeNull();
    expect(gaps["ask-and-refused"]).toBeNull();
    expect(gaps["unknown-item"]).toMatchObject({ code: "SCENARIO_UNHANDLED", severity: "critical", paths: ["capacity.unitsPerDay"] });
    expect(gaps["wanted-refusal"]).toMatchObject({ code: "SCENARIO_UNHANDLED", params: { expected: "REFUSE", actual: "QUOTED" } });
  });

  it("a rehearsal run counts dropped scenarios, shows mismatches as gaps, and ignores related paths that do not exist", async () => {
    const base = scenario("x").request;
    const { rehearsals, sessionId } = setup(bakeryPolicy(), [
      scenario("fine"),
      scenario("mismatch", { ownerWouldWant: "REFUSE", relatedPaths: ["orderRules.minOrderPaise", "no.such.path"] }),
      scenario("broken", { request: { ...base, lines: [] } }),
    ]);
    const run = (await rehearse(rehearsals, sessionId)).result!;
    expect(run.droppedScenarios).toBe(1);
    expect(run.scenarios.map((s) => s.id)).toEqual(["fine", "mismatch"]);
    const gap = run.gaps.find((g) => g.code === "SCENARIO_UNHANDLED")!;
    expect(gap.paths).toEqual(["orderRules.minOrderPaise"]);
    expect(gap.example).toBe("message for mismatch");
    expect(run.summary.criticalOpen).toBe(1);
  });
});

describe("scenarios call (Claude, effort low)", () => {
  it("sends the structured-output request the client rules require and reuses the cached scenarios", async () => {
    const { rehearsals, sessionId, create } = setup(bakeryPolicy());
    await rehearse(rehearsals, sessionId);
    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0]![0] as unknown as Record<string, any>;
    expect(params.model).toContain("sonnet");
    expect(params.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toContain("server-side-fallback-2026-07-01");
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("top_p");
    expect(params).not.toHaveProperty("tool_choice");
    expect(params.messages.at(-1).role).toBe("user"); // no prefill
    expect(params.messages[0].content).toContain("cookie-box"); // the policy's own ids reach the prompt

    await rehearse(rehearsals, sessionId); // same policy: cached, no second call
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("an engine-failing probe is reported as a critical failure", async () => {
    const { deps, sessionId } = setup(bakeryPolicy());
    const { Rehearsals } = await import("../../src/flows/rehearse.js");
    const broken = new Rehearsals(deps, { evaluate: () => ({ outcome: "REFUSED", reasons: [] }) });
    const run = (await rehearse(broken, sessionId)).result!;
    expect(run.summary.probesFailed).toBeGreaterThan(0);
    expect(run.gaps.some((g) => g.code === "ENGINE_PROBE_FAILED")).toBe(true);
  });
});

describe("scenario calendar (weekday-aware daysAhead)", () => {
  it("maps every daysAhead to its weekday and marks closed days, so a 'Sunday' customer lands on Sunday", () => {
    const policy = bakeryPolicy();
    const lines = calendarLines("2026-11-20", policy);
    expect(lines).toContain("daysAhead 0 = Friday 2026-11-20");
    expect(lines).toContain("daysAhead 2 = Sunday 2026-11-22");
    expect(lines).toContain("daysAhead 3 = Monday 2026-11-23 (the shop is closed)");
    const resolved = resolveScenarios([scenario("sun", { request: { ...scenario("sun").request, daysAhead: 2 } })], "2026-11-20");
    expect(resolved.valid[0]!.request.date).toBe("2026-11-22");
  });

  it("the scenario writer's message starts with today's calendar when today is known", () => {
    const user = buildScenariosUser({ turns: ["I bake cakes."] }, bakeryPolicy(), "2026-11-20");
    expect(user.startsWith("Calendar (IST).")).toBe(true);
    expect(buildScenariosUser({ turns: ["I bake cakes."] }, bakeryPolicy())).not.toContain("Calendar (IST)");
  });
});
