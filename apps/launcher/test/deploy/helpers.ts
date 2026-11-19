import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BusinessPolicySchema,
  generateKeyPair,
  policyHash,
  requiredPaths,
  signLaunchRecord,
  type LaunchRecord,
} from "@agentdoor/core";
import type { FetchFn } from "../../src/deploy/smoke.js";

const here = dirname(fileURLToPath(import.meta.url));
export const REAL_ROOT = resolve(here, "../../../..");
const FIXTURE = join(REAL_ROOT, "packages/core/test/fixtures/policy.bakery.json");

export const SECRET_RECIPIENT = "owner-test@example.invalid";
export const NOW_MS = Date.parse("2026-11-19T06:30:00Z");

export interface Env {
  root: string;
  bundleDir: string;
  fakeBin: string;
  statePath: string;
  hash: string;
  keys: { privateKey: string; publicKey: string };
  readState: () => FakeState;
  writeState: (patch: Partial<FakeState>) => void;
}

export interface FakeState {
  apps: { id: string; name: string }[];
  calls: string[][];
  failOnce: string[];
  created: number;
  subscription: boolean;
  imports: { importId: string; fileName: string; status: string }[];
  secrets: Record<string, string[]>;
  secretBodies: { variant: string; mode: number; file: string; patch: { op: string; path: string; value: string }[]; contentType: boolean }[];
  restarts: string[];
  previewBoot: boolean;
  published: boolean;
  domains: { domain: string; status: string }[];
  hash: string;
}

export function makeBundle(bundleDir: string, keys: { privateKey: string; publicKey: string }, mutate?: (p: Record<string, unknown>) => void): string {
  const policy = BusinessPolicySchema.parse(JSON.parse(readFileSync(FIXTURE, "utf8")));
  const hash = policyHash(policy);
  const required = requiredPaths(policy).length;
  const record: LaunchRecord = {
    v: 1,
    shop: policy.business.slug,
    policyVersion: 1,
    policyHash: hash,
    rehearsal: { runId: "r1", ranAt: "2026-11-19T06:00:00Z", probes: 10, scenarios: 3, passed: 13, gapsFound: [], criticalOpen: 0, resultsHash: "0".repeat(64) },
    approvals: { required, approved: required },
    publicKey: keys.publicKey,
    signedAt: "2026-11-19T06:10:00Z",
  };
  mkdirSync(bundleDir, { recursive: true });
  const raw = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;
  writeFileSync(join(bundleDir, "launch-record.json"), JSON.stringify(signLaunchRecord(record, keys.privateKey)));
  mutate?.(raw);
  writeFileSync(join(bundleDir, "policy.json"), JSON.stringify(raw));
  return hash;
}

/** A throwaway repo root: symlinks to the real sources, its own .agentdoor, out and bundle. */
export function makeEnv(): Env {
  const root = mkdtempSync(join(tmpdir(), "agentdoor-deploy-"));
  for (const d of ["apps", "scripts", "node_modules", "packages"]) symlinkSync(join(REAL_ROOT, d), join(root, d));
  const keys = generateKeyPair();
  const secrets = join(root, ".agentdoor", "secrets");
  mkdirSync(secrets, { recursive: true });
  writeFileSync(join(secrets, "quote-signing-private.key"), keys.privateKey);
  writeFileSync(join(secrets, "quote-signing-public.key"), keys.publicKey);
  const bundleDir = join(root, "bundle");
  const hash = makeBundle(bundleDir, keys);

  const fakeDir = join(root, "fakebin");
  mkdirSync(fakeDir);
  const fakeBin = join(fakeDir, "gddy");
  copyFileSync(join(here, "fake-gddy.mjs"), fakeBin);
  chmodSync(fakeBin, 0o755);
  const statePath = join(root, "fake-state.json");
  const initial: FakeState = {
    apps: [], calls: [], failOnce: [], created: 0, subscription: true, imports: [],
    secrets: { PREVIEW: [], PUBLISH: [] }, secretBodies: [], restarts: [], previewBoot: false,
    published: false, domains: [{ domain: "shop.test", status: "ACTIVE" }], hash,
  };
  writeFileSync(statePath, JSON.stringify(initial));
  process.env.FAKE_GDDY_STATE = statePath;
  const readState = (): FakeState => JSON.parse(readFileSync(statePath, "utf8")) as FakeState;
  return {
    root, bundleDir, fakeBin, statePath, hash, keys, readState,
    writeState: (patch) => writeFileSync(statePath, JSON.stringify({ ...readState(), ...patch })),
  };
}

/** Public HTTP as the live shop would answer: healthz carries the new hash only once published. */
export function fakeFetch(env: Env): FetchFn {
  return async (url, init) => {
    const { pathname } = new URL(url);
    const json = (status: number, data: unknown): Response => new Response(JSON.stringify({ data }), { status });
    if (pathname === "/healthz") return json(200, { ok: true, launched: true, policyHash: env.readState().published ? env.hash : "old-hash" });
    if (pathname === "/api/business") return json(200, { name: "x" });
    if (pathname === "/api/quotes" && init?.method === "POST") return json(201, { quote: { token: "tok" } });
    return json(404, null);
  };
}

export const calls = (env: Env): string[] => env.readState().calls.map((c) => c.slice(0, 3).join(" "));
