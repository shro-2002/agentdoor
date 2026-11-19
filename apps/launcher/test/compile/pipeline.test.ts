import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BusinessPolicySchema, requiredPaths } from "@agentdoor/core";
import { buildCompileResult, compileSession, isVerbatim } from "../../src/flows/compile.js";
import { liveClient, newStore, wireFromPolicy } from "./helpers.js";

function built(mutate?: (w: ReturnType<typeof wireFromPolicy>["wire"]) => void, transcriptExtra = "") {
  const { wire, transcript } = wireFromPolicy();
  mutate?.(wire);
  const out = buildCompileResult(wire, [transcript + transcriptExtra]);
  if (!out.ok) throw new Error(out.issues.join("; "));
  return out.value;
}

describe("evidence -> provenance (04 §1)", () => {
  it("maps quote/inferred evidence to proposed provenance and builds a valid BusinessPolicy", () => {
    const r = built((w) => {
      w.evidence.find((e) => e.path === "capacity.unitsPerDay")!.quote = null;
    });
    expect(BusinessPolicySchema.safeParse(r.policy).success).toBe(true);
    const cap = r.policy.provenance["capacity.unitsPerDay"]!;
    expect(cap.source).toEqual({ kind: "owner_edit", note: "AgentDoor default — confirm" });
    expect(cap).toMatchObject({ status: "proposed", approvedAt: null });
    const price = r.policy.provenance["catalog[choco-cake].unitPricePaise"]!;
    expect(price.source.kind).toBe("transcript");
    expect(price).toMatchObject({ status: "proposed", approvedAt: null, readback: { lang: "en" } });
  });

  it("drops null Localized.hi from the wire draft", () => {
    const r = built();
    expect(JSON.stringify(r.policy)).not.toContain('"hi":null');
    expect(r.policy.cancellation.note).toEqual({ en: "Free cancellation up to 24 hours before delivery." });
  });

  it("duplicate paths keep the highest confidence", () => {
    const r = built((w) => {
      const e = w.evidence.find((x) => x.path === "schedule.minLeadHours")!;
      e.confidence = "low";
      w.evidence.push({ ...e, confidence: "high", readback: "the better one" });
      w.evidence.push({ ...e, confidence: "medium", readback: "middle" });
    });
    const p = r.policy.provenance["schedule.minLeadHours"]!;
    expect(p.confidence).toBe("high");
    expect(p.readback.text).toBe("the better one");
  });

  it("drops orphan evidence (path not in the policy) and reports it", () => {
    const r = built((w) => {
      w.evidence.push({ path: "catalog[no-such-item].unitPricePaise", quote: null, turn: 0, readback: "x", confidence: "low" });
    });
    expect(r.policy.provenance["catalog[no-such-item].unitPricePaise"]).toBeUndefined();
    expect(r.validation.issues.some((i) => i.code === "ORPHAN_EVIDENCE" && i.path === "catalog[no-such-item].unitPricePaise")).toBe(true);
  });
});

describe("U-CMP-5 verbatim check (hallucination guard)", () => {
  it("downgrades a fabricated quote to owner_edit, low confidence, proposed", () => {
    const r = built((w) => {
      const e = w.evidence.find((x) => x.path === "orderRules.minOrderPaise")!;
      e.quote = "the minimum is one million rupees, said the owner";
      e.confidence = "high";
    });
    const p = r.policy.provenance["orderRules.minOrderPaise"]!;
    expect(p.source).toEqual({ kind: "owner_edit", note: "Couldn't find this in your words — please confirm" });
    expect(p).toMatchObject({ confidence: "low", status: "proposed" });
  });

  it("accepts quotes that differ only by whitespace or Unicode normalization", () => {
    expect(isVerbatim("चॉकलेट  केक\n 600", "मुझे चॉकलेट केक 600 चाहिए")).toBe(true);
    expect(isVerbatim("café is 5", "the café is 5 rupees")).toBe(true);
    expect(isVerbatim("is   600\trupees", "cake is 600 rupees")).toBe(true);
    expect(isVerbatim("cake is 700", "cake is 600 rupees")).toBe(false);
    expect(isVerbatim("   ", "anything")).toBe(false);
  });

  it("corrects the turn number when the quote is found in another turn", () => {
    const { wire, transcript } = wireFromPolicy();
    wire.evidence.find((e) => e.path === "capacity.unitsPerDay")!.quote = "I can do fifteen a day";
    wire.evidence.find((e) => e.path === "capacity.unitsPerDay")!.turn = 0;
    const out = buildCompileResult(wire, [transcript, "Q: How many?\nA: I can do fifteen a day"]);
    if (!out.ok) throw new Error(out.issues.join(";"));
    expect(out.value.policy.provenance["capacity.unitsPerDay"]!.source).toEqual({
      kind: "transcript",
      quote: "I can do fifteen a day",
      turn: 1,
    });
  });
});

describe("coverage check (both directions, 05 §4.3)", () => {
  it("every required path ends up with provenance, never approved", () => {
    const r = built();
    for (const p of requiredPaths(r.policy)) {
      expect(r.policy.provenance[p], p).toBeDefined();
      expect(r.policy.provenance[p]!.status).toBe("proposed");
    }
  });

  it("a required path without evidence is added to missing and filled with the template default, marked proposed", () => {
    const r = built((w) => {
      w.evidence = w.evidence.filter((e) => e.path !== "capacity.unitsPerDay");
      w.policyDraft.capacity.unitsPerDay = 500;
    });
    expect(r.missing.some((m) => m.path === "capacity.unitsPerDay")).toBe(true);
    expect(r.policy.capacity.unitsPerDay).toBe(10);
    expect(r.policy.provenance["capacity.unitsPerDay"]).toMatchObject({
      source: { kind: "owner_edit", note: "AgentDoor default — confirm" },
      status: "proposed",
      confidence: "low",
    });
  });

  it("inferred (quote null) required paths are reported as missing too; stated ones are not", () => {
    const r = built((w) => {
      w.evidence.find((e) => e.path === "orderRules.quoteValidityMinutes")!.quote = null;
    });
    const paths = r.missing.map((m) => m.path);
    expect(paths).toContain("orderRules.quoteValidityMinutes");
    expect(paths).not.toContain("catalog[choco-cake].unitPricePaise");
  });

  it("rush cap without its own evidence is missing and gets the template cap (the seeded leak)", () => {
    const r = built((w) => {
      w.evidence = w.evidence.filter((e) => e.path !== "rush.maxRushUnitsPerDay");
      w.policyDraft.rush!.maxRushUnitsPerDay = 500;
    });
    expect(r.missing.some((m) => m.path === "rush.maxRushUnitsPerDay")).toBe(true);
    expect(r.policy.rush?.maxRushUnitsPerDay).toBe(3);
  });

  it("warns (does not block) when rush.withinHours exceeds minLeadHours", () => {
    const r = built((w) => {
      w.policyDraft.rush!.withinHours = 72;
      w.policyDraft.schedule.minLeadHours = 24;
    });
    expect(r.validation.issues.some((i) => i.code === "RUSH_WINDOW_EXCEEDS_LEAD" && i.severity === "warning")).toBe(true);
  });

  it("truncates questions to 5 and choices to 4", () => {
    const r = built((w) => {
      w.questions = Array.from({ length: 8 }, (_, i) => ({
        id: `q${i}`,
        path: "capacity.unitsPerDay",
        text: "How many?",
        choices: ["1", "2", "3", "4", "5", "6"],
      }));
    });
    expect(r.questions).toHaveLength(5);
    expect(r.questions.every((q) => q.choices.length <= 4)).toBe(true);
  });
});

describe("domain validation after parsing (bounds live only in Zod)", () => {
  it("out-of-range value is an invalid outcome with the offending path in the issues", () => {
    const { wire, transcript } = wireFromPolicy();
    wire.policyDraft.catalog[0]!.unitPricePaise = 0;
    const out = buildCompileResult(wire, [transcript]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.issues.join("\n")).toContain("unitPricePaise");
  });
});

describe("compileSession persistence (U-CMP-6)", () => {
  const start = (store = newStore()) => {
    const { wire, transcript } = wireFromPolicy();
    const session = store.createSession({ language: "en", transcript, fixtureKey: "unit" });
    return { store, wire, transcript, session };
  };

  it("repairs once on a domain violation and persists policies/v1.json + compile-v1.json", async () => {
    const { store, wire, session } = start();
    const broken = structuredClone(wire);
    broken.policyDraft.catalog[0]!.unitPricePaise = 0;
    const { client, create } = liveClient([{ text: JSON.stringify(broken) }, { text: JSON.stringify(wire) }]);
    const res = await compileSession({ client, store }, session.id);
    expect(res.version).toBe(1);
    expect(create).toHaveBeenCalledTimes(2);
    const second = (create.mock.calls[1]![0] as unknown as { messages: { content: string }[] }).messages;
    expect(second[2]!.content).toContain("unitPricePaise");
    const dir = store.sessionDir(session.id);
    expect(existsSync(path.join(dir, "policies", "v1.json"))).toBe(true);
    expect(existsSync(path.join(dir, "compile-v1.json"))).toBe(true);
  });

  it("two failures surface COMPILE_INVALID and write no policy file", async () => {
    const { store, wire, session } = start();
    const broken = structuredClone(wire);
    broken.policyDraft.catalog[0]!.unitPricePaise = 0;
    const { client, create } = liveClient([{ text: JSON.stringify(broken) }, { text: JSON.stringify(broken) }]);
    await expect(compileSession({ client, store }, session.id)).rejects.toMatchObject({
      code: "COMPILE_INVALID",
      message: expect.stringContaining("try rephrasing"),
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(existsSync(path.join(store.sessionDir(session.id), "policies"))).toBe(false);
    expect(store.latestVersion(session.id)).toBe(0);
  });

  it("recompiling creates v2 without touching v1", async () => {
    const { store, wire, session } = start();
    const { client } = liveClient([{ text: JSON.stringify(wire) }, { text: JSON.stringify(wire) }]);
    await compileSession({ client, store }, session.id);
    const v1 = store.readPolicy(session.id, 1);
    await compileSession({ client, store }, session.id);
    expect(store.latestVersion(session.id)).toBe(2);
    expect(store.readPolicy(session.id, 1)).toEqual(v1);
  });

  it("a transcript with no business (policyDraft null) is NO_BUSINESS_FOUND and writes nothing", async () => {
    const { store, wire, session } = start();
    const { client } = liveClient([{ text: JSON.stringify({ ...wire, policyDraft: null, evidence: [] }) }]);
    await expect(compileSession({ client, store }, session.id)).rejects.toMatchObject({ code: "NO_BUSINESS_FOUND" });
    expect(store.latestVersion(session.id)).toBe(0);
  });
});
