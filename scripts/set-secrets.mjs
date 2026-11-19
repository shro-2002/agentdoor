#!/usr/bin/env node
// Sets hosting secrets for ONE variant via the official updateSecrets operation.
// Values travel only in a JSON Patch body (mode-600 temp file); never in argv or logs.
// Usage: node scripts/set-secrets.mjs <PREVIEW|PUBLISH>
// Input: .agentdoor/secrets/<variant>.json  ({"NAME":"value", ...}); app id from .agentdoor/deploy.json
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import path from "node:path";

const run = promisify(execFile);
const STATE_DIR = ".agentdoor";
const VARIANTS = ["PREVIEW", "PUBLISH"];
const SECRET_NAME_RE = /^[A-Za-z][A-Za-z0-9/_+=.@-]*$/;
const MAX_OPS = 50;
const MAX_VALUE_BYTES = 8 * 1024;
const FILE_MODE = 0o600;
const PATCH_CONTENT_TYPE = "Content-Type: application/json-patch+json";

const variant = (process.argv[2] ?? "").toUpperCase();
if (!VARIANTS.includes(variant)) {
  console.error("usage: set-secrets.mjs <PREVIEW|PUBLISH>");
  process.exit(2);
}

const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));

function buildPatch(secrets) {
  const names = Object.keys(secrets);
  if (names.length === 0 || names.length > MAX_OPS)
    throw new Error(`need 1..${MAX_OPS} secrets`);
  return names.map((name) => {
    const value = secrets[name];
    if (!SECRET_NAME_RE.test(name))
      throw new Error(`invalid secret name: ${name}`);
    if (
      typeof value !== "string" ||
      Buffer.byteLength(value) > MAX_VALUE_BYTES
    ) {
      throw new Error(`invalid value for ${name}`);
    }
    // RFC 6902 "add" on an existing member replaces it, so one op covers create and update.
    return {
      op: "add",
      path: `/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`,
      value,
    };
  });
}

async function main() {
  const { appId } = await readJson(path.join(STATE_DIR, "deploy.json"));
  const secrets = await readJson(
    path.join(STATE_DIR, "secrets", `${variant.toLowerCase()}.json`),
  );
  const patch = buildPatch(secrets);
  const tmpDir = path.join(STATE_DIR, "tmp");
  await mkdir(tmpDir, { recursive: true, mode: 0o700 });
  const tmp = path.join(tmpDir, `patch-${randomBytes(6).toString("hex")}.json`);
  try {
    await writeFile(tmp, JSON.stringify(patch), { mode: FILE_MODE });
    const args = [
      "api",
      "call",
      "-X",
      "PATCH",
      "updateSecrets",
      "--param",
      `appId=${appId}`,
      "--param",
      `variant=${variant}`,
      "-H",
      PATCH_CONTENT_TYPE, // API rejects plain application/json for JSON Patch
      "--file",
      tmp,
    ];
    const { stdout } = await run("gddy", args, { maxBuffer: 1 << 20 });
    console.log(`${variant}: set ${Object.keys(secrets).join(", ")}`);
    console.log(stdout.trim().slice(0, 2000)); // metadata only; gddy never returns values
  } finally {
    await rm(tmp, { force: true });
  }
}

main().catch((err) => {
  // Message only: execFile errors can echo argv, which holds no secrets by design.
  console.error(`set-secrets failed: ${String(err.message).split("\n")[0]}`);
  process.exit(1);
});
