import { execFileSync } from "node:child_process";
import { builtinModules } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ZIP_LEVEL_ARGS, assertAllowed, pack, repack, type PackOptions } from "../../src/deploy/pack.js";
import { makeBundle, makeEnv, type Env } from "./helpers.js";

let env: Env;
const options = (extra: Partial<PackOptions> = {}): PackOptions => ({
  repoRoot: env.root,
  bundleDir: env.bundleDir,
  outDir: join(env.root, "out"),
  trustedPublicKey: env.keys.publicKey,
  lockfile: async (dir) => writeFileSync(join(dir, "package-lock.json"), '{"lockfileVersion":3}'),
  ...extra,
});

beforeEach(() => {
  env = makeEnv();
});

describe("pack", () => {
  it("builds the deployable artifact: generated manifest, npmrc, lockfile, bundle, dist", async () => {
    const res = await pack(options());
    const photos = ["brownies", "chocolate-cake", "cookie-box", "eggless-vanilla-cake", "hero-chocolate-cake", "kitchen-flour-hands", "kitchen-sifting-flour", "occasion-anniversary", "occasion-birthday", "occasion-gifting"];
    const styles = ["agentdoor-launch", "agentdoor-try", "agentdoor", "bakery", "shop", "tokens", "ui"];
    expect(res.entries.sort()).toEqual(
      [
        ".npmrc",
        "bundle/launch-record.json",
        "bundle/policy.json",
        "dist/index.js",
        "package-lock.json",
        "package.json",
        "public/favicon.svg",
        "public/photos/CREDITS.md",
        "public/shop.js",
        ...photos.map((f) => `public/photos/${f}.jpg`),
        ...styles.map((f) => `public/${f}.css`),
      ].sort(),
    );
    const pkg = JSON.parse(readFileSync(join(env.root, "out/shop/package.json"), "utf8"));
    expect(pkg).toMatchObject({ main: "dist/index.js", scripts: { build: "echo build", start: "node dist/index.js" }, engines: { node: "22.x" } });
    expect(Object.values(pkg.dependencies as Record<string, string>).every((v) => /^\d+\.\d+\.\d+$/.test(v))).toBe(true);
    expect(pkg.dependencies.express).toBe("5.3.0");
    expect(readFileSync(join(env.root, "out/shop/.npmrc"), "utf8")).toContain("registry=https://registry.npmjs.org/");
    expect(res.policyHash).toBe(env.hash);
  });

  it("inlines core and leaves runtime deps external", async () => {
    await pack(options());
    const js = readFileSync(join(env.root, "out/shop/dist/index.js"), "utf8");
    expect(js).not.toMatch(/from ["']@agentdoor\/core["']/);
    expect(js).toMatch(/from ["']express["']/);
  });

  it("every package the built shop imports is a pinned runtime dependency in the generated manifest (C2)", async () => {
    await pack(options());
    const js = readFileSync(join(env.root, "out/shop/dist/index.js"), "utf8");
    const specifiers = [...js.matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*)["']([^"']+)["']/g)].map((m) => m[1]!);
    const bare = specifiers.filter((s) => !s.startsWith(".") && !s.startsWith("/") && !s.startsWith("node:") && !builtinModules.includes(s));
    const packages = new Set(bare.map((s) => (s.startsWith("@") ? s.split("/").slice(0, 2).join("/") : s.split("/")[0]!)));
    expect(packages.size).toBeGreaterThan(0);
    const pkg = JSON.parse(readFileSync(join(env.root, "out/shop/package.json"), "utf8")) as { dependencies: Record<string, string>; devDependencies?: unknown };
    for (const name of packages) expect(pkg.dependencies, name).toHaveProperty([name]);
    expect(pkg.devDependencies).toBeUndefined();
    expect(packages.has("@agentdoor/core")).toBe(false);
  });

  it("includes try/session.json when present, and is a real zip with only allow-listed entries", async () => {
    mkdirSync(join(env.bundleDir, "try"));
    writeFileSync(join(env.bundleDir, "try/session.json"), '{"recorded":true}');
    const res = await pack(options());
    expect(res.entries).toContain("bundle/try/session.json");
    const listed = execFileSync("unzip", ["-Z1", res.zipPath]).toString().split("\n").filter(Boolean);
    expect(listed.sort()).toEqual(res.entries.sort());
    expect(() => assertAllowed(listed)).not.toThrow();
  });

  it("rejects an invalid try/session.json", async () => {
    mkdirSync(join(env.bundleDir, "try"));
    writeFileSync(join(env.bundleDir, "try/session.json"), "{nope");
    await expect(pack(options())).rejects.toThrow();
  });

  it("artifact id is stable for identical content", async () => {
    const a = await pack(options());
    const b = await pack(options());
    expect(b.artifactId).toBe(a.artifactId);
  });

  it("fails closed when the launch record is missing or does not match the policy", async () => {
    makeBundle(env.bundleDir, env.keys, (p) => {
      (p.business as { name: string }).name = "Edited";
    });
    await expect(pack(options())).rejects.toMatchObject({ code: "GATE_BLOCKED", status: 409 });
    await expect(pack(options({ bundleDir: join(env.root, "nowhere") }))).rejects.toMatchObject({ code: "GATE_BLOCKED" });
  });

  it("allow-list rejects keys, env files and state", () => {
    for (const bad of [".env", ".agentdoor/secrets/publish.json", "secrets/x.key", "node_modules/a.js", "bundle/other.json"]) {
      expect(() => assertAllowed(["package.json", bad]), bad).toThrowError(/non-allow-listed/);
    }
  });

  it("refuses to pack a secret value found in a packed file", async () => {
    await expect(pack(options({ forbiddenValues: ["Meera's Kitchen"] }))).rejects.toMatchObject({ code: "ZIP_NOT_ALLOWED" });
  });

  it("repacks the same tree at each level (default, -9, -1) with the allow-list re-checked", async () => {
    expect(ZIP_LEVEL_ARGS).toEqual([[], ["-9"], ["-1"]]);
    const first = await pack(options());
    for (const level of ZIP_LEVEL_ARGS) {
      const again = await repack(first, level);
      expect(again.artifactId).toBe(first.artifactId);
      expect([...again.entries].sort()).toEqual([...first.entries].sort());
      const listed = execFileSync("unzip", ["-Z1", again.zipPath]).toString().split("\n").filter(Boolean);
      expect(() => assertAllowed(listed)).not.toThrow();
    }
  });

  it("runs the GoDaddy validator when it exists and fails if it fails", async () => {
    const ok = join(env.root, "validate-ok.mjs");
    writeFileSync(ok, "process.exit(0)");
    await expect(pack(options({ validatorPath: ok }))).resolves.toBeTruthy();
    const bad = join(env.root, "validate-bad.mjs");
    writeFileSync(bad, "process.exit(1)");
    await expect(pack(options({ validatorPath: bad }))).rejects.toThrow();
  });
});
