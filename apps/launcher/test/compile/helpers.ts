import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import type { BusinessPolicy } from "@agentdoor/core";
import bakery from "../../../../packages/core/test/fixtures/policy.bakery.json";
import { ClaudeClient } from "../../src/claude/client.js";
import type { Expected } from "../../src/flows/score.js";

export { scoreCompile, valueAt, type Expected } from "../../src/flows/score.js";
import { FsStore } from "../../src/store/fsStore.js";

export const LAUNCHER_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const FIXTURES = path.join(LAUNCHER_ROOT, "fixtures");
export const LLM_FIXTURES = path.join(FIXTURES, "llm");

export const tmpDir = (): string =>
  mkdtempSync(path.join(tmpdir(), "agentdoor-t07-"));

export const readTranscript = (name: string): string =>
  readFileSync(path.join(FIXTURES, "transcripts", `${name}.txt`), "utf8").trim();

export const readExpected = (name: string): Expected =>
  JSON.parse(
    readFileSync(path.join(FIXTURES, "expected", `${name}.json`), "utf8"),
  ) as Expected;

export const replayClient = (): ClaudeClient =>
  new ClaudeClient({
    mode: "replay",
    fixturesDir: LLM_FIXTURES,
    usagePath: path.join(tmpDir(), "usage.jsonl"),
  });

export const newStore = (): FsStore => new FsStore(tmpDir());

/** A schema-valid wire CompileResult built from the committed bakery policy fixture. */
export function wireFromPolicy(policy: BusinessPolicy = bakery as unknown as BusinessPolicy) {
  const { provenance, ...draft } = structuredClone(policy);
  const withNulls = JSON.parse(
    JSON.stringify(draft, (_k, v) =>
      v && typeof v === "object" && "en" in v && !("hi" in v) ? { ...v, hi: null } : v,
    ),
  );
  const evidence = Object.entries(provenance).map(([p, v]) => ({
    path: p,
    quote: v.source.kind === "transcript" ? v.source.quote : null,
    turn: 0,
    readback: v.readback.text,
    confidence: v.confidence,
  }));
  const transcript = [
    ...new Set(evidence.flatMap((e) => (e.quote ? [e.quote] : []))),
  ].join(". ");
  const wire = {
    detectedLanguage: "en" as const,
    policyDraft: withNulls,
    evidence,
    missing: [] as { path: string; why: string }[],
    questions: [] as { id: string; path: string; text: string; choices: string[] }[],
    assumptions: [] as { path: string; value: string; why: string }[],
  };
  return { wire, transcript };
}

/** The text a model would return for a wire result: the policy travels as JSON text (compile-api.ts). */
export function apiText(wire: { policyDraft: unknown } & Record<string, unknown>): string {
  const { policyDraft, ...rest } = wire;
  return JSON.stringify({ ...rest, policyDraftJson: JSON.stringify(policyDraft) });
}

interface FakeReply {
  text: string;
  stop_reason?: string;
  usage?: Record<string, number>;
}

/** A stand-in for the Anthropic SDK: records every request, answers from a queue. */
export function fakeSdk(replies: FakeReply[]) {
  const queue = [...replies];
  const create = vi.fn(async (params: { model: string }) => {
    const r = queue.shift();
    if (!r) throw new Error("fakeSdk: no reply queued");
    return {
      model: params.model,
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text: r.text },
      ],
      stop_reason: r.stop_reason ?? "end_turn",
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        ...r.usage,
      },
    };
  });
  return { create, sdk: { beta: { messages: { create } } } };
}

export function liveClient(
  replies: FakeReply[],
  opts: Partial<ConstructorParameters<typeof ClaudeClient>[0]> = {},
) {
  const dir = tmpDir();
  const fake = fakeSdk(replies);
  const client = new ClaudeClient({
    mode: "live",
    fixturesDir: path.join(dir, "llm"),
    usagePath: path.join(dir, "usage.jsonl"),
    sdkFactory: () => fake.sdk,
    ...opts,
  });
  return { client, dir, ...fake };
}
