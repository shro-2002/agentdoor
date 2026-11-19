import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { DeployError } from "./errors.js";
import { checkGate } from "./gate.js";

const run = promisify(execFile);
const MAX_SESSION_BYTES = 1024 * 1024;
const TOOL_TIMEOUT_MS = 120_000;
const NODE_ENGINE = "22.x";
const NPMRC = "registry=https://registry.npmjs.org/\nsave-exact=true\n";
const BUNDLE_FILES = ["policy.json", "launch-record.json"] as const;
const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** Everything that may appear in the upload; anything else (keys, env files, state) fails the build. */
const ZIP_ALLOW = [
  /^package\.json$/,
  /^package-lock\.json$/,
  /^\.npmrc$/,
  /^dist\/[\w./-]+\.(js|mjs|map)$/,
  /^public\/[\w./-]+$/,
  /^bundle\/(policy|launch-record)\.json$/,
  /^bundle\/try\/session\.json$/,
];

export interface PackOptions {
  repoRoot: string;
  bundleDir: string;
  outDir: string;
  /** From `.agentdoor/secrets`, never from the bundle. */
  trustedPublicKey: string;
  /** Secret values that must not appear in any packed file (belt and braces on top of the allow-list). */
  forbiddenValues?: string[];
  /** Writes package-lock.json into the staged dir. Default: `npm install --package-lock-only`. */
  lockfile?: (dir: string) => Promise<void>;
  /** GoDaddy's validate-paas.mjs, run when the file exists. */
  validatorPath?: string;
}

export interface PackResult {
  zipPath: string;
  /** Digest of the packed tree: identifies this exact upload (zip bytes carry timestamps). */
  artifactId: string;
  policyHash: string;
  entries: string[];
  /** Staged tree the zip was built from, so the same files can be repacked. */
  stageDir: string;
}

/** Extra zip args per attempt: a filter in front of the upload may reject one particular byte pattern. */
export const ZIP_LEVEL_ARGS: readonly (readonly string[])[] = [[], ["-9"], ["-1"]];

const npmLockfile = async (dir: string): Promise<void> => {
  await run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: dir,
    timeout: TOOL_TIMEOUT_MS,
  });
};

function shopDependencies(repoRoot: string): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "apps/shop/package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  for (const [name, version] of Object.entries(pkg.dependencies)) {
    if (!EXACT_VERSION.test(version)) throw new DeployError("PACK_FAILED", `dependency ${name} is not pinned exactly`);
  }
  return pkg.dependencies;
}

function writeManifest(stage: string, deps: Record<string, string>): void {
  const manifest = {
    name: "agentdoor-shop",
    version: "0.0.1",
    private: true,
    type: "module",
    main: "dist/index.js",
    scripts: { build: "echo build", start: "node dist/index.js" },
    dependencies: deps,
    engines: { node: NODE_ENGINE },
  };
  writeFileSync(join(stage, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(stage, ".npmrc"), NPMRC);
}

function copyBundle(bundleDir: string, stage: string): void {
  const dest = join(stage, "bundle");
  mkdirSync(dest, { recursive: true });
  for (const f of BUNDLE_FILES) cpSync(join(bundleDir, f), join(dest, f));
  const session = join(bundleDir, "try", "session.json");
  if (!existsSync(session)) return;
  if (statSync(session).size > MAX_SESSION_BYTES) throw new DeployError("PACK_FAILED", "try/session.json is too large");
  JSON.parse(readFileSync(session, "utf8")); // must be valid JSON; content is never interpreted here
  mkdirSync(join(dest, "try"), { recursive: true });
  cpSync(session, join(dest, "try", "session.json"));
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(relative(dir, p).split("\\").join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

function digestTree(stage: string, files: string[]): string {
  const h = createHash("sha256");
  for (const f of files) h.update(`${f}\0`).update(readFileSync(join(stage, f))).update("\0");
  return h.digest("hex").slice(0, 16);
}

export function assertAllowed(entries: string[]): void {
  const bad = entries.filter((e) => !ZIP_ALLOW.some((re) => re.test(e)) && !e.endsWith("/"));
  if (bad.length > 0) throw new DeployError("ZIP_NOT_ALLOWED", `zip contains non-allow-listed files: ${bad.join(", ")}`);
}

function assertNoSecrets(stage: string, files: string[], values: string[]): void {
  const needles = values.filter((v) => v.length >= 8);
  for (const f of files) {
    const body = readFileSync(join(stage, f), "utf8");
    if (needles.some((n) => body.includes(n))) throw new DeployError("ZIP_NOT_ALLOWED", `a secret value was found in ${f}`);
  }
}

async function bundleShop(repoRoot: string, stage: string, deps: Record<string, string>): Promise<void> {
  await build({
    entryPoints: [join(repoRoot, "apps/shop/src/server.ts")],
    outfile: join(stage, "dist/index.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: Object.keys(deps),
    logLevel: "silent",
  });
}

/**
 * Re-checks the gate from disk, then stages and zips the shop. Fails closed (409 GATE_BLOCKED)
 * before anything is built if the signed launch record is missing or does not match the policy.
 */
export async function pack(opts: PackOptions): Promise<PackResult> {
  const gate = checkGate(opts.bundleDir, opts.trustedPublicKey);
  const stage = join(opts.outDir, "shop");
  rmSync(opts.outDir, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  const deps = shopDependencies(opts.repoRoot);
  await bundleShop(opts.repoRoot, stage, deps);
  const publicDir = join(opts.repoRoot, "apps/shop/public");
  if (existsSync(publicDir)) cpSync(publicDir, join(stage, "public"), { recursive: true });
  copyBundle(opts.bundleDir, stage);
  writeManifest(stage, deps);
  await (opts.lockfile ?? npmLockfile)(stage);

  const files = listFiles(stage);
  assertAllowed(files);
  assertNoSecrets(stage, files, opts.forbiddenValues ?? []);
  if (opts.validatorPath && existsSync(opts.validatorPath)) {
    await run("node", [opts.validatorPath, stage], { timeout: TOOL_TIMEOUT_MS });
  }
  const artifactId = digestTree(stage, files);
  const zipPath = join(opts.outDir, `shop-${artifactId}.zip`);
  const entries = await zipStage(stage, files, zipPath, []);
  return { zipPath, artifactId, policyHash: gate.policyHash, entries, stageDir: stage };
}

/** Zips the staged files (deleting any old zip first: `zip` would update it) and re-checks the allow-list. */
async function zipStage(stage: string, files: string[], zipPath: string, levelArgs: readonly string[]): Promise<string[]> {
  rmSync(zipPath, { force: true });
  // No -X: the platform's upload filter rejected the -X archive (bytes only; the content is fine).
  await run("zip", ["-r", "-q", ...levelArgs, zipPath, ...files], { cwd: stage, timeout: TOOL_TIMEOUT_MS });
  const { stdout } = await run("unzip", ["-Z1", zipPath], { timeout: TOOL_TIMEOUT_MS });
  const entries = stdout.split("\n").filter(Boolean);
  assertAllowed(entries);
  return entries;
}

/** Same tree, same artifact id, different compressed bytes. */
export async function repack(packed: PackResult, levelArgs: readonly string[]): Promise<PackResult> {
  const entries = await zipStage(packed.stageDir, listFiles(packed.stageDir), packed.zipPath, levelArgs);
  return { ...packed, entries };
}
