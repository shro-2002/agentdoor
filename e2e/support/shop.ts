import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Pool } from "mysql2/promise";
import { createApp } from "../../apps/shop/src/app.js";
import type { ShopConfig } from "../../apps/shop/src/config.js";
import { loadLaunchState } from "../../apps/shop/src/db/launch-state.js";
import { runMigrations } from "../../apps/shop/src/db/migrations.js";
import { createPool } from "../../apps/shop/src/db/pool.js";
import type { WorkspaceConfig } from "../../apps/shop/src/workspace/config.js";
import type { DemoWorld } from "./demo-world.js";

/** Local docker-compose MySQL (public, throwaway values; the same ones the shop's integration tests use). */
export const dbConfig = {
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3307),
  database: process.env.DB_NAME ?? "agentdoor",
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "agentdoor-local-only",
};

export const OWNER_TOKEN = "e2e-owner-token-not-a-secret";
const TABLES = ["audit_events", "orders", "quote_redemptions", "capacity_ledger", "contact_messages", "ws_jobs", "ws_drafts", "ws_hits", "ws_budget", "ws_publish"];

export interface RunningShop {
  baseUrl: string;
  pool: Pool;
  emails: { subject?: string; text?: string }[];
  close: () => Promise<void>;
}

/** An in-process shop on a free local port, with a clean database and the world's signed bundle. */
export async function startShop(world: DemoWorld, opts: { bundleDir?: string; workspace?: WorkspaceConfig } = {}): Promise<RunningShop> {
  const pool = createPool(dbConfig);
  await runMigrations(pool);
  for (const t of TABLES) await pool.query(`DELETE FROM ${t}`);
  const server: Server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const config: ShopConfig = {
    port,
    nodeEnv: "test",
    db: dbConfig,
    signingPrivateKey: world.privateKey,
    signingPublicKey: world.publicKey,
    sessionSecret: Buffer.alloc(32, 5),
    ownerTokenHash: createHash("sha256").update(OWNER_TOKEN).digest("hex"),
    contactRecipient: "hello@example.test",
    publicBaseUrl: baseUrl,
    platformBaseUrl: null,
  };
  const emails: RunningShop["emails"] = [];
  const bundleDir = opts.bundleDir ?? world.bundleDir;
  const launch = loadLaunchState(bundleDir, world.publicKey);
  // /try reads BUNDLE_DIR when the app is built; two shops in one process need it set per app.
  process.env.BUNDLE_DIR = bundleDir;
  const app = createApp({
    config,
    pool,
    launch,
    log: () => undefined,
    workspace: opts.workspace,
    sendEmail: async (m) => {
      emails.push({ subject: m.subject, text: m.text });
      return { messageId: "e2e" };
    },
  });
  server.on("request", app);
  return {
    baseUrl,
    pool,
    emails,
    close: async () => {
      await new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      });
      await pool.end();
    },
  };
}
