import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CompileResultWireSchema, toWireJsonSchema } from "@agentdoor/core";
import { ClaudeClient, type ClaudeCall } from "../../src/claude/client.js";
import { costUsd } from "../../src/claude/pricing.js";
import { liveClient, tmpDir } from "../compile/helpers.js";

const Out = z.strictObject({ answer: z.string(), n: z.number() });
const good = JSON.stringify({ answer: "ok", n: 1 });
const bad = JSON.stringify({ answer: "ok", n: "one" });

const call = (over: Partial<ClaudeCall<z.infer<typeof Out>>> = {}): ClaudeCall<z.infer<typeof Out>> => ({
  flow: "compile",
  fixtureId: "compile/unit/round0",
  model: "claude-sonnet-5-5",
  effort: "medium",
  system: "SYSTEM",
  user: "USER",
  wireSchema: Out,
  maxTokens: 1000,
  sessionId: "s1",
  ...over,
});

const FORBIDDEN = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "pattern", "minItems", "maxItems", "multipleOf", "format"];

function violations(node: unknown, at = "#"): string[] {
  if (Array.isArray(node)) return node.flatMap((v, i) => violations(v, `${at}[${i}]`));
  if (!node || typeof node !== "object") return [];
  const n = node as Record<string, unknown>;
  const out: string[] = [];
  if (n.type === "object") {
    if (n.additionalProperties !== false) out.push(`${at}: additionalProperties`);
    if (!n.properties) out.push(`${at}: dynamic keys`);
  }
  for (const kw of FORBIDDEN) if (kw in n) out.push(`${at}: ${kw}`);
  for (const [k, v] of Object.entries(n)) out.push(...violations(v, `${at}/${k}`));
  return out;
}

describe("ClaudeClient request shape (CLAUDE.md API rules)", () => {
  it("sends structured output, effort, fallbacks + beta, cached system; none of the banned params", async () => {
    const { client, create } = liveClient([{ text: good }]);
    await client.callStructured(call());
    const p = create.mock.calls[0]![0] as unknown as Record<string, any>;
    expect(p.model).toBe("claude-sonnet-5-5");
    expect(p.max_tokens).toBe(1000);
    expect(p.output_config.effort).toBe("medium");
    expect(p.output_config.format.type).toBe("json_schema");
    expect(p.fallbacks).toBe("default");
    expect(p.betas).toContain("server-side-fallback-2026-07-01");
    expect(p.system[0].cache_control).toEqual({ type: "ephemeral" });
    for (const banned of ["temperature", "top_p", "top_k", "tool_choice", "budget_tokens"])
      expect(p).not.toHaveProperty(banned);
    expect(p.thinking === undefined || p.thinking.type === "adaptive").toBe(true);
    expect(p.messages.at(-1).role).toBe("user"); // no assistant prefill
  });

  it("U-CMP-7: the JSON Schema sent for CompileResult has no dynamic keys, bounds or patterns", async () => {
    expect(violations(toWireJsonSchema(CompileResultWireSchema))).toEqual([]);
    const { client, create } = liveClient([{ text: good }]);
    await client.callStructured(call());
    const p = create.mock.calls[0]![0] as unknown as { output_config: { format: { schema: unknown } } };
    expect(violations(p.output_config.format.schema)).toEqual([]);
  });
});

describe("replay mode", () => {
  it("U-BUD-3: never instantiates a network client, and a missing fixture throws FIXTURE_MISSING", async () => {
    const factory = vi.fn();
    const client = new ClaudeClient({
      mode: "replay",
      fixturesDir: path.join(tmpDir(), "llm"),
      usagePath: path.join(tmpDir(), "usage.jsonl"),
      sdkFactory: factory,
    });
    await expect(client.callStructured(call())).rejects.toMatchObject({
      code: "FIXTURE_MISSING",
      message: expect.stringContaining("compile/unit/round0"),
    });
    expect(factory).not.toHaveBeenCalled();
  });

  it("rejects fixture ids that could escape the fixtures directory", async () => {
    const { client } = liveClient([{ text: good }]);
    await expect(client.callStructured(call({ fixtureId: "../../etc/passwd" }))).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("record then replay returns the same data; the prompt hash only produces a warning", async () => {
    const dir = tmpDir();
    const fixturesDir = path.join(dir, "llm");
    const usagePath = path.join(dir, "usage.jsonl");
    const fake = liveClient([{ text: good }]);
    const rec = new ClaudeClient({ mode: "record", fixturesDir, usagePath, sdkFactory: () => fake.sdk });
    const recorded = await rec.callStructured(call());
    expect(recorded.fromFixture).toBe(false);
    expect(existsSync(path.join(fixturesDir, "compile/unit/round0.json"))).toBe(true);

    const warn = vi.fn();
    const factory = vi.fn();
    const rep = new ClaudeClient({ mode: "replay", fixturesDir, usagePath, sdkFactory: factory, warn });
    const replayed = await rep.callStructured(call({ system: "A DIFFERENT SYSTEM PROMPT" }));
    expect(replayed.data).toEqual({ answer: "ok", n: 1 });
    expect(replayed.fromFixture).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("prompt changed"));
    expect(factory).not.toHaveBeenCalled();
    const same = vi.fn();
    await new ClaudeClient({ mode: "replay", fixturesDir, usagePath, warn: same }).callStructured(call());
    expect(same).not.toHaveBeenCalled();
  });
});

describe("U-BUD budget guard and cost", () => {
  it("U-BUD-2: cost from usage incl. cache tokens matches the hand calculation", () => {
    // 1000*2 + 2000*10 + 10000*0.10 + 4000*2.50 = 33000 micro-USD
    const usage = { inputTokens: 1000, outputTokens: 2000, cacheReadTokens: 10000, cacheWriteTokens: 4000 };
    expect(costUsd("claude-sonnet-5-5", usage)).toBeCloseTo(0.033, 10);
    expect(costUsd("claude-haiku-5-5", usage)).toBeCloseTo((1000 * 0.1 + 2000 * 0.5 + 10000 * 0.01 + 4000 * 0.125) / 1e6, 10);
    expect(costUsd("claude-opus-5-5", usage)).toBeCloseTo((1000 * 4 + 2000 * 20 + 10000 * 0.2 + 4000 * 5) / 1e6, 10);
  });

  it("U-BUD-2: the live call is logged to usage.jsonl with that cost", async () => {
    const { client, dir } = liveClient([
      { text: good, usage: { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 10000, cache_creation_input_tokens: 4000 } },
    ]);
    const res = await client.callStructured(call());
    expect(res.costUsd).toBeCloseTo(0.033, 10);
    const rows = readFileSync(path.join(dir, "usage.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: "s1", flow: "compile", fixtureId: "compile/unit/round0" });
    expect(rows[0].costUsd).toBeCloseTo(0.033, 10);
  });

  it("U-BUD-1: blocks a call when session spend + estimate exceeds the cap, before any network call", async () => {
    // estimate = ~input + maxTokens*10/1e6 = at least 0.01 for maxTokens 1000
    const { client, create } = liveClient(
      [{ text: good, usage: { input_tokens: 1000, output_tokens: 3000 } }, { text: good }],
      { maxUsdPerSession: 0.04, maxUsdTotal: 100 },
    );
    await client.callStructured(call()); // spends 0.032
    await expect(client.callStructured(call())).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("U-BUD-1: the total cap counts other sessions, and a different session is still bound by the total", async () => {
    const { client, create } = liveClient(
      [{ text: good, usage: { input_tokens: 1000, output_tokens: 3000 } }, { text: good }],
      { maxUsdPerSession: 100, maxUsdTotal: 0.04 },
    );
    await client.callStructured(call({ sessionId: "a" }));
    await expect(client.callStructured(call({ sessionId: "b" }))).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("an estimate above the cap blocks even the first call", async () => {
    const { client, create } = liveClient([{ text: good }], { maxUsdPerSession: 0.001 });
    await expect(client.callStructured(call({ maxTokens: 12000 }))).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("stop_reason and repair", () => {
  it("checks stop_reason before parsing: refusal and max_tokens are not parsed or repaired", async () => {
    const r = liveClient([{ text: good, stop_reason: "refusal" }]);
    await expect(r.client.callStructured(call())).rejects.toMatchObject({ code: "MODEL_REFUSED" });
    const t = liveClient([{ text: '{"answer":', stop_reason: "max_tokens" }]);
    await expect(t.client.callStructured(call())).rejects.toMatchObject({ code: "OUTPUT_TRUNCATED" });
    expect(r.create).toHaveBeenCalledTimes(1);
    expect(t.create).toHaveBeenCalledTimes(1);
  });

  it("U-CMP-6: invalid output gets exactly one repair attempt carrying the errors as a new user turn", async () => {
    const { client, create } = liveClient([{ text: bad }, { text: good }]);
    const res = await client.callStructured(call());
    expect(res.data).toEqual({ answer: "ok", n: 1 });
    expect(create).toHaveBeenCalledTimes(2);
    const second = (create.mock.calls[1]![0] as unknown as { messages: { role: string; content: string }[] }).messages;
    expect(second.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(second[2]!.content).toContain("n");
  });

  it("U-CMP-6: a second failure surfaces STRUCTURED_OUTPUT_INVALID and makes no third call", async () => {
    const { client, create } = liveClient([{ text: bad }, { text: bad }, { text: good }]);
    await expect(client.callStructured(call())).rejects.toMatchObject({ code: "STRUCTURED_OUTPUT_INVALID" });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("domain validation failures (bounds that the wire schema cannot carry) use the same repair path", async () => {
    const validate = (d: { n: number }) => (d.n > 5 ? ["n: must be <= 5"] : []);
    const { client, create } = liveClient([
      { text: JSON.stringify({ answer: "x", n: 99 }) },
      { text: JSON.stringify({ answer: "x", n: 2 }) },
    ]);
    const res = await client.callStructured(call({ validate }));
    expect(res.data.n).toBe(2);
    const second = (create.mock.calls[1]![0] as unknown as { messages: { content: string }[] }).messages;
    expect(second[2]!.content).toContain("n: must be <= 5");
  });

  it("replay follows the recorded repair sequence", async () => {
    const dir = tmpDir();
    const fixturesDir = path.join(dir, "llm");
    const usagePath = path.join(dir, "usage.jsonl");
    const fake = liveClient([{ text: bad }, { text: good }]);
    await new ClaudeClient({ mode: "record", fixturesDir, usagePath, sdkFactory: () => fake.sdk }).callStructured(call());
    const res = await new ClaudeClient({ mode: "replay", fixturesDir, usagePath }).callStructured(call());
    expect(res.data).toEqual({ answer: "ok", n: 1 });
    expect(res.fromFixture).toBe(true);
  });
});
