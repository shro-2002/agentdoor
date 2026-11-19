import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(fileURLToPath(import.meta.url), "../../../../..");

/**
 * SEC-16: no source file may contain a GoDaddy spend command. The patterns are assembled from
 * fragments; this file is the one place the rule is spelled out, so it is the one file skipped.
 */
const SPEND_COMMANDS = [
  ["gddy", "domain", "purchase"],
  ["shopping", "checkout", "complete"],
  ["email", "create"],
  ["payment-method", "add"],
];
const asProse = (words: string[]): RegExp => new RegExp(words.join("\\s+"), "i");
// The same words split into an argv array: ["domain", "purchase"].
const asArgv = (words: string[]): RegExp => new RegExp(words.map((w) => `["'\`]${w}["'\`]`).join("\\s*,\\s*"), "i");

/** Docs and the lockfile only describe the rule or list packages; this file is the deny-list itself. */
const SKIPPED = [/^apps\/launcher\/test\/security\/sources\.test\.ts$/,/^planning\//, /^docs\//, /^private\//, /^node_modules\//, /package-lock\.json$/, /^CLAUDE\.md$/, /^STATUS\.md$/];

const trackedSources = (): string[] =>
  // Untracked-but-not-ignored files count too: they are about to be committed.
  execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString("utf8")
    .split("\0")
    .filter((f) => f && !SKIPPED.some((re) => re.test(f)));

describe("SEC-16 no spend commands in the tracked sources", () => {
  it("scans a real file list", () => {
    const files = trackedSources();
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("apps/launcher/src/deploy/gddy.ts");
  });

  it("no source, script, test or config file spells out a spend command", () => {
    const patterns = SPEND_COMMANDS.flatMap((w) => [asProse(w), asArgv(w)]);
    const hits: string[] = [];
    for (const file of trackedSources()) {
      let body: string;
      try {
        body = readFileSync(join(ROOT, file), "utf8");
      } catch {
        continue; // deleted in the working tree
      }
      if (body.includes("\0")) continue; // binary
      body.split("\n").forEach((line, i) => {
        if (patterns.some((re) => re.test(line))) hits.push(`${file}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("the patterns do catch a spend command (so an empty result means something)", () => {
    const [domain, checkout, email, payment] = SPEND_COMMANDS as [string[], string[], string[], string[]];
    expect(asProse(domain).test(`run ${domain.join("  ")} now`)).toBe(true);
    expect(asArgv(checkout).test(`exec([${checkout.map((w) => JSON.stringify(w)).join(", ")}])`)).toBe(true);
    expect(asProse(payment).test(payment.join(" "))).toBe(true);
    expect(asProse(email).test("gddy hosting app list")).toBe(false);
  });
});
