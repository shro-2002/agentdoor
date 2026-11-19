import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BusinessPolicySchema, requiredPaths } from "@agentdoor/core";
import { answerQuestions } from "../../src/flows/clarify.js";
import { compileSession, isVerbatim } from "../../src/flows/compile.js";
import {
  FIXTURES,
  newStore,
  readExpected,
  readTranscript,
  replayClient,
  scoreCompile,
  valueAt,
} from "./helpers.js";

type Name = "en" | "hinglish" | "hi" | "seeded-leaky";
const DEVANAGARI = /[ऀ-ॿ]/;

async function compile(name: Name) {
  const store = newStore();
  const exp = readExpected(name);
  const transcript = readTranscript(name);
  const session = store.createSession({ language: exp.language, transcript, fixtureKey: name });
  const client = replayClient();
  const res = await compileSession({ client, store }, session.id);
  return { store, client, session, res, transcript, exp };
}

afterEach(() => {
  delete process.env.AGENTDOOR_NOW;
  vi.restoreAllMocks();
});

describe.each([
  ["U-CMP-1", "en"],
  ["U-CMP-2", "hinglish"],
  ["U-CMP-3", "hi"],
] as [string, Name][])("%s replay compile: %s", (_id, name) => {
  it("yields a valid policy meeting the accuracy bar, with the read-back in the owner's language", async () => {
    const { res, exp, transcript } = await compile(name);
    const { policy } = res.compileResult;
    expect(BusinessPolicySchema.safeParse(policy).success).toBe(true);

    const score = scoreCompile(policy, exp);
    console.info(`compile accuracy [${name}]: ${score.correct}/${score.total} = ${(score.ratio * 100).toFixed(1)}% wrong=${JSON.stringify(score.wrong)}`);
    expect(score.ratio).toBeGreaterThanOrEqual(exp.minAccuracy);

    expect(res.compileResult.detectedLanguage).toBe(exp.language);
    const readbacks = Object.values(policy.provenance).map((p) => p.readback);
    expect(readbacks.every((r) => r.lang === exp.language)).toBe(true);
    const devanagari = readbacks.filter((r) => DEVANAGARI.test(r.text)).length / readbacks.length;
    if (exp.language === "hi") expect(devanagari).toBeGreaterThanOrEqual(0.8);
    else expect(devanagari).toBe(0);

    for (const p of requiredPaths(policy)) expect(policy.provenance[p], p).toBeDefined();
    for (const [p, prov] of Object.entries(policy.provenance)) {
      expect(prov.status, p).toBe("proposed");
      if (prov.source.kind === "transcript") expect(isVerbatim(prov.source.quote, transcript), p).toBe(true);
    }
  });
});

describe("U-CMP-4 seeded-leaky compile", () => {
  it("asks 1-5 questions, each about a missing or required path, and flags the three omissions", async () => {
    const { res, exp } = await compile("seeded-leaky");
    const { questions, missing, policy } = res.compileResult;
    expect(questions.length).toBeGreaterThanOrEqual(1);
    expect(questions.length).toBeLessThanOrEqual(5);
    const critical = new Set([...missing.map((m) => m.path), ...requiredPaths(policy)]);
    for (const q of questions) {
      expect(critical.has(q.path), q.path).toBe(true);
      expect(q.choices.length).toBeLessThanOrEqual(4);
    }
    expect(questions.some((q) => q.path === "capacity.unitsPerDay")).toBe(true);

    for (const p of exp.mustAsk) {
      expect(missing.map((m) => m.path), p).toContain(p);
      expect(policy.provenance[p]?.source.kind, p).toBe("owner_edit");
    }
    const score = scoreCompile(policy, exp);
    console.info(`compile accuracy [seeded-leaky]: ${score.correct}/${score.total} = ${(score.ratio * 100).toFixed(1)}% wrong=${JSON.stringify(score.wrong)}`);
    expect(score.ratio).toBeGreaterThanOrEqual(exp.minAccuracy);
  });
});

describe("clarification: exactly one round", () => {
  function answersFor(questions: { id: string; path: string }[]) {
    const table = JSON.parse(readFileSync(path.join(FIXTURES, "answers", "seeded-leaky.json"), "utf8")) as Record<string, string>;
    return questions.flatMap((q) => (table[q.path] ? [{ questionId: q.id, text: table[q.path]! }] : []));
  }

  it("answers become Q/A turns, the recompile is a new version, and the second round is refused", async () => {
    const { store, client, session, res, exp } = await compile("seeded-leaky");
    const answers = answersFor(res.compileResult.questions);
    expect(answers.length).toBeGreaterThanOrEqual(1);

    const round1 = await answerQuestions({ client, store }, session.id, answers);
    expect(round1.version).toBe(2);
    expect(round1.compileResult.questions).toEqual([]); // no second round
    expect(store.getSession(session.id).turns).toHaveLength(1 + answers.length);
    expect(store.getSession(session.id).turns[1]).toMatch(/^Q: .+\nA: .+/);

    const { policy } = round1.compileResult;
    for (const [p, want] of Object.entries(exp.afterAnswers ?? {})) {
      const asked = res.compileResult.questions.some((q) => q.path === p);
      if (!asked) continue;
      expect(valueAt(policy, p), p).toEqual(want);
      expect(policy.provenance[p]?.source.kind, p).toBe("transcript");
    }
    expect(store.readPolicy(session.id, 1)).toEqual(res.compileResult.policy);

    await expect(answerQuestions({ client, store }, session.id, answers)).rejects.toMatchObject({ code: "CLARIFY_LIMIT" });
  });

  it("rejects an unknown question id before spending anything", async () => {
    const { store, client, session } = await compile("seeded-leaky");
    await expect(answerQuestions({ client, store }, session.id, [{ questionId: "nope", text: "x" }])).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(store.getSession(session.id).turns).toHaveLength(1);
  });
});

describe("U-FIX-1 replay is date-independent", () => {
  const NOWS = ["2026-11-19T10:00:00+05:30", "2026-11-29T10:00:00+05:30", "2026-12-14T23:30:00+05:30"];
  const TODAY = ["2026-11-19", "2026-11-29", "2026-12-14"];

  it("same fixtures load under 3 different AGENTDOOR_NOW values; results are identical; the prompt carries each date", async () => {
    const policies: unknown[] = [];
    for (const [i, now] of NOWS.entries()) {
      process.env.AGENTDOOR_NOW = now;
      const store = newStore();
      const client = replayClient();
      const spy = vi.spyOn(client, "callStructured");
      const session = store.createSession({ language: "en", transcript: readTranscript("seeded-leaky"), fixtureKey: "seeded-leaky" });
      const res = await compileSession({ client, store }, session.id);
      policies.push(res.compileResult);
      expect(spy.mock.calls[0]![0].user).toContain(TODAY[i]!);
      expect(spy.mock.calls[0]![0].system).not.toContain(TODAY[i]!); // keeps the cached prefix date-free
    }
    expect(policies[1]).toEqual(policies[0]);
    expect(policies[2]).toEqual(policies[0]);
  });
});
