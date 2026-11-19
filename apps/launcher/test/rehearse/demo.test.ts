import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessPolicySchema, CompileResultWireSchema, ScenarioWireSchema } from "@agentdoor/core";
import { answerQuestions } from "../../src/flows/clarify.js";
import { compileSession } from "../../src/flows/compile.js";
import { applyGapFix, fixOptions } from "../../src/flows/gapFix.js";
import { DemoSessionSchema } from "../../src/flows/demoSession.js";
import { exportDemo } from "../../src/flows/exportDemo.js";
import { Rehearsals } from "../../src/flows/rehearse.js";
import { FIXTURES, newStore, readTranscript, replayClient } from "../compile/helpers.js";
import { clientWithScenarios, pinClock, rehearse, scenario, tmpDir, writeKeys } from "./helpers.js";

beforeEach(() => pinClock());
afterEach(() => vi.unstubAllEnvs());

// Assembled at runtime so scripts/check-secrets.sh does not flag the fake key in this file.
const API_KEY_LOOKALIKE = `${["sk", "ant", "api03"].join("-")}-AbCdEfGhIjKlMnOp`;
const OWNER_TOKEN ="OWNERTOKEN-q8Zr3vL0mXp7Kd2Ws9Yt";
const SESSION_SECRET = "c2Vzc2lvbi1zZWNyZXQtZm9yLXRlc3Rz";
const answersTable = JSON.parse(readFileSync(path.join(FIXTURES, "answers", "seeded-leaky.json"), "utf8")) as Record<string, string>;

/** A recorded-style session: compile (replayed fixtures) + answers + rehearsal + one gap fix. */
async function recordedSession() {
  const store = newStore();
  const replay = replayClient();
  const created = store.createSession({ language: "en", transcript: readTranscript("seeded-leaky"), fixtureKey: "seeded-leaky" });
  const id = created.id;
  const round0 = await compileSession({ client: replay, store }, id);
  const answers = round0.compileResult.questions.flatMap((q) => (answersTable[q.path] ? [{ questionId: q.id, text: answersTable[q.path]! }] : []));
  await answerQuestions({ client: replay, store }, id, answers);
  const fake = clientWithScenarios([scenario("s1"), scenario("s2", { ownerWouldWant: "REFUSE" })]);
  const deps = { client: fake.client, store };
  const rehearsals = new Rehearsals(deps);
  const run = (await rehearse(rehearsals, id)).result!;
  const gap = run.gaps.find((g) => g.severity === "critical" && g.code !== "SCENARIO_UNHANDLED")!;
  const choice = fixOptions(gap, store.readPolicy(id, 2))[0]!.choice;
  applyGapFix(deps, id, gap.id, choice);

  const dir = tmpDir();
  const secretsDir = path.join(dir, "secrets");
  writeKeys(secretsDir);
  writeFileSync(path.join(secretsDir, "owner-token.txt"), `${OWNER_TOKEN}\n`);
  writeFileSync(path.join(secretsDir, "publish.json"), JSON.stringify({ SESSION_SECRET, OWNER_TOKEN_HASH: "f".repeat(64), PUBLIC_BASE_URL: "https://agentdoor.shop" }));
  const usagePath = path.join(dir, "usage.jsonl");
  return { store, id, dir, secretsDir, usagePath, bundleDir: path.join(dir, "bundle"), answers, fix: { gapId: gap.id, choice } };
}

describe("U-DEMO-1 export-demo writes a schema-valid DemoSession with no secrets and no PII", () => {
  it("writes bundle/try/session.json built from the stored session", async () => {
    const s = await recordedSession();
    const session = exportDemo({ store: s.store, usagePath: s.usagePath }, { sessionId: s.id, bundleDir: s.bundleDir, secretsDir: s.secretsDir });
    const file = path.join(s.bundleDir, "try", "session.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(session);

    expect(DemoSessionSchema.safeParse(session).success).toBe(true);
    expect(session).toMatchObject({ v: 1, language: "en", transcript: readTranscript("seeded-leaky") });
    expect(CompileResultWireSchema.safeParse(session.compile.result).success).toBe(true);
    expect(session.compile).toMatchObject({ model: expect.stringContaining("sonnet"), costUsd: expect.any(Number), latencyMs: expect.any(Number) });
    expect(session.answers.map((a) => a.questionId)).toEqual(s.answers.map((a) => a.questionId));
    expect(session.policyVersions).toHaveLength(s.store.latestVersion(s.id));
    for (const p of session.policyVersions) expect(BusinessPolicySchema.safeParse(p).success).toBe(true);
    expect(session.scenarios.map((x) => ScenarioWireSchema.safeParse(x).success)).toEqual([true, true]);
    expect(session.scenarios[0]!.request).toHaveProperty("daysAhead"); // never absolute dates
    expect(session.gapFixes).toEqual([{ ...s.fix, fromVersion: 2, toVersion: s.store.latestVersion(s.id) }]);
    expect(s.store.latestVersion(s.id)).toBe(3);
    expect(session.deployLog).toEqual([]);
    expect(session.usage).toEqual({ calls: 0, totalUsd: 0 });
  });

  it("reads a names-only deploy log when one exists and drops every other field", async () => {
    const s = await recordedSession();
    const deployLogFile = path.join(s.dir, "deploy-log.json");
    writeFileSync(deployLogFile, JSON.stringify([{ step: "upload", ms: 1200, ok: true, argv: ["--token", "nope"] }, { step: "publish", ms: 13000, ok: true }]));
    const session = exportDemo({ store: s.store, usagePath: s.usagePath }, { sessionId: s.id, bundleDir: s.bundleDir, secretsDir: s.secretsDir, deployLogFile });
    expect(session.deployLog).toEqual([{ step: "upload", ms: 1200, ok: true }, { step: "publish", ms: 13000, ok: true }]);
  });

  it("sums only this session's recorded (non-replay) Claude calls", async () => {
    const s = await recordedSession();
    const row = (sessionId: string, mode: string, costUsd: number) =>
      JSON.stringify({ at: "2026-11-19T06:00:00.000Z", sessionId, flow: "compile", fixtureId: "x", model: "claude-sonnet-5-5", mode, attempt: 0, usage: {}, costUsd });
    writeFileSync(s.usagePath, [row(s.id, "live", 0.05), row(s.id, "record", 0.02), row("other", "live", 9)].join("\n") + "\n");
    const session = exportDemo({ store: s.store, usagePath: s.usagePath }, { sessionId: s.id, bundleDir: s.bundleDir, secretsDir: s.secretsDir });
    expect(session.usage).toEqual({ calls: 2, totalUsd: 0.07 });
  });

  const leaks: [string, (turn: string) => string][] = [
    ["an owner token", (t) => `${t}\nmy admin token is ${OWNER_TOKEN}`],
    ["a session secret", (t) => `${t}\n${SESSION_SECRET}`],
    ["a phone number", (t) => `${t}\ncall me on 98765 43210`],
    ["an e-mail address", (t) => `${t}\nwrite to meera.kitchen@example.com`],
    ["an Anthropic key", (t) => `${t}\n${API_KEY_LOOKALIKE}`],
    ["a PEM private key", (t) => `${t}\n-----BEGIN ${["PRIVATE", "KEY"].join(" ")}-----`],
  ];
  for (const [name, inject] of leaks) {
    it(`refuses to export when the session contains ${name}, writes nothing and does not echo it`, async () => {
      const s = await recordedSession();
      const session = s.store.getSession(s.id);
      s.store.saveSession({ ...session, turns: [inject(session.turns[0]!), ...session.turns.slice(1)] });
      let message = "";
      try {
        exportDemo({ store: s.store, usagePath: s.usagePath }, { sessionId: s.id, bundleDir: s.bundleDir, secretsDir: s.secretsDir });
      } catch (e) {
        message = `${(e as { code?: string }).code} ${(e as Error).message}`;
      }
      expect(message).toContain("EXPORT_SCAN_FAILED");
      for (const value of [OWNER_TOKEN, SESSION_SECRET, "98765", "meera.kitchen", "AbCdEfGhIjKl"]) expect(message).not.toContain(value);
      expect(existsSync(path.join(s.bundleDir, "try", "session.json"))).toBe(false);
    });
  }

  it("also scans the private signing key's own value", async () => {
    const s = await recordedSession();
    const key = readFileSync(path.join(s.secretsDir, "quote-signing-private.key"), "utf8").trim();
    const session = s.store.getSession(s.id);
    s.store.saveSession({ ...session, turns: [`${session.turns[0]} ${key}`] });
    expect(() => exportDemo({ store: s.store, usagePath: s.usagePath }, { sessionId: s.id, bundleDir: s.bundleDir, secretsDir: s.secretsDir })).toThrow(/scan/i);
  });
});
