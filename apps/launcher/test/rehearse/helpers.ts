import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import {
  BusinessPolicySchema,
  generateKeyPair,
  type BusinessPolicy,
  type ScenarioWireSchema,
} from "@agentdoor/core";
import type { z } from "zod";
import bakeryJson from "../../../../packages/core/test/fixtures/policy.bakery.json";
import leakyJson from "../../../../packages/core/test/fixtures/policy.seeded-leaky.json";
import type { ClaudeClient } from "../../src/claude/client.js";
import type { Deps } from "../../src/flows/compile.js";
import { applyGapFix, fixOptions } from "../../src/flows/gapFix.js";
import { Rehearsals, type RunStatus } from "../../src/flows/rehearse.js";
import type { FsStore } from "../../src/store/fsStore.js";
import { liveClient, newStore, tmpDir } from "../compile/helpers.js";

export { liveClient, newStore, tmpDir };
export type ScenarioWire = z.infer<typeof ScenarioWireSchema>;

/** A Thursday, 06:00 UTC (11:30 IST). Bakery is closed on Mondays, so 5 days ahead is a Tuesday. */
export const NOW_ISO = "2026-11-19T06:00:00Z";
export const pinClock = (iso: string = NOW_ISO): void => {
  vi.stubEnv("AGENTDOOR_NOW", iso);
};

export const bakeryPolicy = (): BusinessPolicy => BusinessPolicySchema.parse(structuredClone(bakeryJson));
export const leakyPolicy = (): BusinessPolicy => BusinessPolicySchema.parse(structuredClone(leakyJson));

/** A session whose v1 is the given policy (no compile call). */
export function seedSession(store: FsStore, policy: BusinessPolicy, fixtureKey = "t-seed"): string {
  const session = store.createSession({ language: "en", transcript: "seeded by a test", fixtureKey });
  store.writeVersion(session.id, policy, { kind: "seed", result: { questions: [], missing: [], assumptions: [] } });
  return session.id;
}

export function scenario(id: string, over: Partial<ScenarioWire> = {}): ScenarioWire {
  return {
    id,
    customerMessage: `message for ${id}`,
    request: {
      lines: [{ itemId: "cookie-box", qty: 1, optionIds: [] }],
      fulfilment: { kind: "pickup", area: null },
      daysAhead: 5,
      notes: null,
    },
    ownerWouldWant: "QUOTE",
    rationale: "a plain order",
    relatedPaths: [],
    ...over,
  };
}

/** A client in live mode whose fake SDK answers one scenarios call with these scenarios. */
export function clientWithScenarios(scenarios: unknown[]) {
  return liveClient([{ text: JSON.stringify({ scenarios }) }]);
}

export async function rehearse(rehearsals: Rehearsals, sessionId: string): Promise<RunStatus> {
  const started = rehearsals.start(sessionId);
  await rehearsals.settled(started.runId);
  const done = rehearsals.get(started.runId);
  if (done.status !== "done") throw new Error(`rehearsal ${done.status}: ${JSON.stringify(done.error)}`);
  return done;
}

/** Owner behaviour for tests: take the first offered fix for every open critical gap, re-run, repeat. */
export async function resolveAll(rehearsals: Rehearsals, deps: Deps, sessionId: string, maxRounds = 6): Promise<RunStatus> {
  for (let round = 0; round < maxRounds; round++) {
    const run = await rehearse(rehearsals, sessionId);
    const open = run.result!.gaps.filter((g) => g.severity === "critical" && !g.dismissed);
    if (open.length === 0) return run;
    for (const gap of open) {
      const first = fixOptions(gap, deps.store.readPolicy(sessionId, deps.store.latestVersion(sessionId)))[0]!;
      applyGapFix(deps, sessionId, gap.id, gap.code === "SCENARIO_UNHANDLED" ? "dismiss" : first.choice, first.needsValue ? 10 : undefined);
    }
  }
  throw new Error("critical gaps did not converge");
}

export function setup(policy: BusinessPolicy, scenarios: unknown[] = [scenario("s1")], fixtureKey = "t-seed") {
  const store = newStore();
  const fake = clientWithScenarios(scenarios);
  const deps = { client: fake.client as ClaudeClient, store };
  const sessionId = seedSession(store, policy, fixtureKey);
  return { ...fake, store, deps, sessionId, rehearsals: new Rehearsals(deps) };
}

/** Throw-away Ed25519 key files in the layout gen-keys writes. Returns the public key. */
export function writeKeys(secretsDir: string): { publicKey: string; privateKey: string } {
  const keys = generateKeyPair();
  mkdirSync(secretsDir, { recursive: true });
  const priv = path.join(secretsDir, "quote-signing-private.key");
  writeFileSync(priv, keys.privateKey, { mode: 0o600 });
  chmodSync(priv, 0o600);
  writeFileSync(path.join(secretsDir, "quote-signing-public.key"), keys.publicKey);
  return keys;
}
