import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Pool } from "mysql2/promise";
import {
  BusinessPolicySchema,
  fulfilmentInstantMs,
  policyHash,
  signLaunchRecord,
  type LaunchRecord,
} from "@agentdoor/core";
import { createApp } from "../../src/app.js";
import { loadLaunchState } from "../../src/db/launch-state.js";
import type { ShopConfig } from "../../src/config.js";
import { freshPool, keys, testDbConfig } from "./helpers.js";

const HOUR_MS = 3_600_000;
export const FAR_DATE = "2026-11-26"; // a Thursday
/** 168 h before 10:00 IST on FAR_DATE: lead and rush windows are clear. */
export const NOW_MS = fulfilmentInstantMs(FAR_DATE) - 168 * HOUR_MS;
export const OWNER_TOKEN = "owner-token-for-tests-only";
export const PUBLIC_URL = "https://shop.example.test";
export const PLATFORM_URL = "https://abc123.airoapp.ai";
const SESSION_SECRET = Buffer.alloc(32, 9).toString("base64");

const policyPath = new URL(
  "../../../../packages/core/test/fixtures/policy.bakery.json",
  import.meta.url,
);
export const policy = BusinessPolicySchema.parse(JSON.parse(readFileSync(policyPath, "utf8")));

export const config: ShopConfig = {
  port: 0,
  nodeEnv: "test",
  db: testDbConfig,
  signingPrivateKey: keys.privateKey,
  signingPublicKey: keys.publicKey,
  sessionSecret: Buffer.from(SESSION_SECRET, "base64"),
  ownerTokenHash: createHash("sha256").update(OWNER_TOKEN).digest("hex"),
  contactRecipient: "hello@example.test",
  publicBaseUrl: PUBLIC_URL,
  platformBaseUrl: PLATFORM_URL,
};

export function bundle(opts: { editPrice?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "shop-bundle-"));
  const record: LaunchRecord = {
    v: 1,
    shop: policy.business.slug,
    policyVersion: 1,
    policyHash: policyHash(policy),
    rehearsal: {
      runId: "r1",
      ranAt: "2026-11-19T00:00:00Z",
      probes: 30,
      scenarios: 5,
      passed: 35,
      gapsFound: [],
      criticalOpen: 0,
      resultsHash: "c".repeat(64),
    },
    approvals: { required: 10, approved: 10 },
    publicKey: keys.publicKey,
    signedAt: "2026-11-19T00:00:00Z",
  };
  const shipped = structuredClone(policy);
  if (opts.editPrice) shipped.catalog[0]!.unitPricePaise += 100;
  writeFileSync(join(dir, "policy.json"), JSON.stringify(shipped));
  writeFileSync(join(dir, "launch-record.json"), JSON.stringify(signLaunchRecord(record, keys.privateKey)));
  return dir;
}

export interface TestShop {
  base: string;
  pool: Pool;
  logs: Record<string, unknown>[];
  clock: { now: number };
  close: () => Promise<void>;
}

export interface StartOptions {
  editPrice?: boolean;
  trustProxyHops?: number;
  /** Replaces the DB pool the app uses, e.g. one that points at a dead port. */
  appPool?: Pool;
  /** Overrides on top of the default test config, e.g. a different owner token hash. */
  config?: Partial<ShopConfig>;
}

export async function startShop(opts: StartOptions = {}): Promise<TestShop> {
  const pool = await freshPool();
  await pool.query("DELETE FROM contact_messages");
  const logs: Record<string, unknown>[] = [];
  const clock = { now: NOW_MS };
  const launch = loadLaunchState(bundle(opts), keys.publicKey);
  const app = createApp({
    config: { ...config, ...opts.config },
    pool: opts.appPool ?? pool,
    launch,
    now: () => clock.now,
    log: (line) => logs.push(line),
    trustProxyHops: opts.trustProxyHops,
  });
  const server: Server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    pool,
    logs,
    clock,
    close: async () => {
      await new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      });
      await pool.end();
    },
  };
}

export const quoteBody = (over: Record<string, unknown> = {}) => ({
  lines: [{ itemId: "cookie-box", qty: 2, optionIds: [] }],
  fulfilment: { kind: "pickup" },
  date: FAR_DATE,
  ...over,
});

let seq = 0;
export const newKey = (): string => {
  seq += 1;
  return `11111111-1111-4111-8111-${String(seq).padStart(12, "0")}`;
};

export const customerBody = {
  name: "Asha",
  phone: "9876543210",
  address: "Baner, Pune",
};

export async function json(
  shop: TestShop,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await fetch(shop.base + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* non-JSON body: tests inspect `text` */
  }
  return { status: res.status, headers: res.headers, body: parsed, text };
}

export async function getQuoteToken(
  shop: TestShop,
  over: Record<string, unknown> = {},
): Promise<string> {
  const q = await json(shop, "POST", "/api/quotes", quoteBody(over));
  return q.body.data.quote.token as string;
}

/** Quote then order over REST; returns the order response. */
export async function restOrder(
  shop: TestShop,
  over: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const token = await getQuoteToken(shop);
  return json(
    shop,
    "POST",
    "/api/orders",
    { quoteToken: token, customer: customerBody, idempotencyKey: newKey(), ...over },
    headers,
  );
}

export const RPC_HEADERS = { accept: "application/json, text/event-stream" };
let rpcId = 0;

export async function rpc(
  shop: TestShop,
  method: string,
  params: unknown,
  headers: Record<string, string> = {},
) {
  rpcId += 1;
  return json(
    shop,
    "POST",
    "/mcp",
    { jsonrpc: "2.0", id: rpcId, method, params },
    { ...RPC_HEADERS, ...headers },
  );
}

export const callTool = (shop: TestShop, name: string, args: unknown) =>
  rpc(shop, "tools/call", { name, arguments: args });

