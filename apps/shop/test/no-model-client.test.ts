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

describe("SEC-17 the deployed shop (and so /try) has no model client", () => {
  it("no model SDK in dependencies and no model endpoint or SDK import in src/", () => {
    const pkg = JSON.parse(readFileSync(join(SHOP, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).filter((n) => /anthropic|openai/i.test(n))).toEqual([]);
    const files = sourceFiles(join(SHOP, "src"));
    expect(files.length).toBeGreaterThan(20);
    const hits = files.filter((f) => /@anthropic-ai|api\.anthropic\.com|api\.openai\.com/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
