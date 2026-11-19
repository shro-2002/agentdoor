import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(fileURLToPath(import.meta.url), "../../../../..");

describe("SEC-10 / SEC-19 / SUB-3 nothing secret or private is tracked", () => {
  it("scripts/check-secrets.sh finds nothing in tracked or about-to-be-tracked files", () => {
    expect(execFileSync("bash", ["scripts/check-secrets.sh"], { cwd: ROOT }).toString()).toContain("check-secrets: clean");
  });

  it("no private/, env, key, generated-bundle or state file is tracked", () => {
    const tracked = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
    const forbidden = [/^private\//, /^\.agentdoor\//, /(^|\/)\.env($|\.)(?!example)/, /^bundle\//, /^out\//, /^test-results\//, /^playwright-report\//, /\.key$/, /\.pem$/];
    expect(tracked.filter((f) => forbidden.some((re) => re.test(f)))).toEqual([]);
  });
});
