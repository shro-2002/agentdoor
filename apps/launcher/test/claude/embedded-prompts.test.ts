import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ClaudeClient, type SpendGuard } from "../../src/claude/client.js";
import { compileSystemPrompt, scenariosSystemPrompt } from "../../src/prompts/load.js";
import { COMPILE_PROMPT_TEMPLATE, SCENARIOS_PROMPT } from "../../src/prompts/texts.js";
import { LAUNCHER_ROOT, tmpDir } from "../compile/helpers.js";

const read = (name: string): string => readFileSync(path.join(LAUNCHER_ROOT, "src/prompts", name), "utf8");

describe("embedded prompts (run `node scripts/gen-prompt-texts.mjs` after editing a .md)", () => {
  it("texts.ts matches the .md sources", () => {
    expect(COMPILE_PROMPT_TEMPLATE).toBe(read("compile.md"));
    expect(SCENARIOS_PROMPT).toBe(read("scenarios.md"));
  });

  it("the loaders still fill the placeholders", () => {
    expect(compileSystemPrompt()).not.toContain("{{");
    expect(scenariosSystemPrompt()).toContain("test customers");
  });
});

describe("ClaudeClient with a host spend guard", () => {
  const Out = z.strictObject({ ok: z.boolean() });
  const usage = { input_tokens: 1000, output_tokens: 100 };
  const call = { flow: "compile" as const, fixtureId: "compile/x/round0", model: "claude-sonnet-5-5", effort: "low" as const, system: "S", user: "U", wireSchema: Out, maxTokens: 500, sessionId: "d1" };

  function guard(): SpendGuard & { reserved: number[]; settled: number[] } {
    const g = { reserved: [] as number[], settled: [] as number[] };
    return {
      ...g,
      async reserve(_s: string, est: number) {
        g.reserved.push(est);
        return { settle: async (usd: number) => void g.settled.push(usd) };
      },
      reserved: g.reserved,
      settled: g.settled,
    };
  }

  const client = (create: ReturnType<typeof vi.fn>, spendGuard: SpendGuard) =>
    new ClaudeClient({
      mode: "live",
      spendGuard,
      usagePath: path.join(tmpDir(), "usage.jsonl"),
      sdkFactory: () => ({ beta: { messages: { create } } }) as never,
    });

  it("reserves before the call and settles the real cost after it", async () => {
    const create = vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }], stop_reason: "end_turn", model: "claude-sonnet-5-5", usage }));
    const g = guard();
    await client(create, g).callStructured(call);
    expect(g.reserved).toHaveLength(1);
    expect(g.reserved[0]).toBeGreaterThan(0);
    expect(g.settled).toHaveLength(1);
    expect(g.settled[0]).toBeLessThan(g.reserved[0]!);
  });

  it("a refused reservation never reaches the network", async () => {
    const create = vi.fn();
    const refusing: SpendGuard = {
      reserve: async () => {
        throw new Error("cap");
      },
    };
    await expect(client(create, refusing).callStructured(call)).rejects.toThrow("cap");
    expect(create).not.toHaveBeenCalled();
  });

  it("a failed call releases the reservation (settles 0)", async () => {
    const create = vi.fn(async () => {
      throw new Error("network");
    });
    const g = guard();
    await expect(client(create, g).callStructured(call)).rejects.toThrow("network");
    expect(g.settled).toEqual([0]);
  });
});
