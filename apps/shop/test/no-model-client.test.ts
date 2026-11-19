import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SHOP = resolve(fileURLToPath(import.meta.url), "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name)) : /\.(ts|js)$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

const WORKSPACE = join(SHOP, "src", "workspace");
const inWorkspace = (file: string): boolean => file.startsWith(`${WORKSPACE}/`);
const MODEL_CLIENT = /@anthropic-ai|api\.anthropic\.com|api\.openai\.com|launcher\/src\/claude|ClaudeClient|callStructured|ANTHROPIC_API_KEY/;

describe("SEC-17 only the /launch workspace may reach a model", () => {
  const files = sourceFiles(join(SHOP, "src"));
  const outside = files.filter((f) => !inWorkspace(f));

  it("the storefront, /order, quotes, orders, MCP, owner pages, /try and /launch-report have no model client", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(outside.length).toBeGreaterThan(20);
    const hits = outside.filter((f) => MODEL_CLIENT.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("the only model SDK is Anthropic's, pinned to the launcher's version; no other provider", () => {
    const pkg = JSON.parse(readFileSync(join(SHOP, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    const launcher = JSON.parse(readFileSync(join(SHOP, "../launcher/package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).filter((n) => /openai|google|cohere|mistral/i.test(n))).toEqual([]);
    expect(pkg.dependencies["@anthropic-ai/sdk"]).toBe(launcher.dependencies["@anthropic-ai/sdk"]);
  });

  it("nothing outside the workspace imports it except the app that mounts it", () => {
    const importers = outside.filter((f) => /from "(\.\.?\/)+workspace\//.test(readFileSync(f, "utf8"))).map((f) => f.slice(SHOP.length + 1));
    expect(importers).toEqual(["src/app.ts"]);
  });

  it("the workspace client is live-only: no replay mode, no fixtures, no mode switch from the environment", () => {
    const code = files.filter(inWorkspace).map((f) => readFileSync(f, "utf8")).join("\n");
    expect(code).toMatch(/mode: "live"/);
    expect(code).not.toMatch(/AGENTDOOR_LLM_MODE|mode: "replay"|mode: "record"|fixturesDir|readFixture/);
  });
});
