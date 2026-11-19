import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOWED_SECRET_NAMES, PRIVATE_OPTIONAL_SECRET_NAMES, REQUIRED_SECRET_NAMES } from "../../src/deploy/secrets.js";
import { REAL_ROOT } from "./helpers.js";

/** The names inside `const ALLOWED_NAMES = [...]` of scripts/set-secrets.mjs. */
function scriptNames(): string[] {
  const text = readFileSync(join(REAL_ROOT, "scripts/set-secrets.mjs"), "utf8");
  const block = /const ALLOWED_NAMES = \[([\s\S]*?)\];/.exec(text)?.[1] ?? "";
  return [...block.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]!);
}

describe("secrets allow-list for the live workspace", () => {
  it("carries the runtime key, the access code and the budget into PREVIEW and PUBLISH", () => {
    for (const name of ["ANTHROPIC_API_KEY", "WORKSPACE_ACCESS_CODE", "WORKSPACE_BUDGET_USD", "WORKSPACE_OPEN"]) expect(ALLOWED_SECRET_NAMES).toContain(name);
    for (const name of REQUIRED_SECRET_NAMES) expect(ALLOWED_SECRET_NAMES).toContain(name);
  });

  it("scripts/set-secrets.mjs sends exactly the same names (so the JSON-body path can carry them)", () => {
    expect([...scriptNames()].sort()).toEqual([...ALLOWED_SECRET_NAMES].sort());
  });

  it("the key and the access code are credentials: their values may never appear in a packed file", () => {
    expect([...PRIVATE_OPTIONAL_SECRET_NAMES]).toEqual(["ANTHROPIC_API_KEY", "WORKSPACE_ACCESS_CODE"]);
  });
});
