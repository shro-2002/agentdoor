import type { Pool } from "mysql2/promise";
import {
  generateKeyPair,
  type QuoteTokenPayload,
} from "@agentdoor/core";
import { createPool } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrations.js";
import type { PlaceOrderInput } from "../../src/db/orders.js";

/** Local docker-compose values (public, throwaway); CI/host may override via DB_*. */
export const testDbConfig = {
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3307),
  database: process.env.DB_NAME ?? "agentdoor",
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "agentdoor-local-only",
};

export const keys = generateKeyPair();
export const POLICY_HASH = "b".repeat(64);
export const NOW_MS = 1_800_000_000_000;
export const DATE = "2027-01-20";

export async function freshPool(): Promise<Pool> {
  const pool = createPool(testDbConfig);
  await runMigrations(pool);
  for (const t of [
    "audit_events",
    "orders",
    "quote_redemptions",
    "capacity_ledger",
  ])
    await pool.query(`DELETE FROM ${t}`);
  return pool;
}

let seq = 0;
export const uuid = (): string => {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
};

export const quote = (over: Partial<QuoteTokenPayload> = {}): QuoteTokenPayload => ({
  v: 1,
  qid: uuid(),
  shop: "demo",
  policyHash: POLICY_HASH,
  request: { items: [{ id: "choco-cake", qty: 1 }] },
  totalPaise: 60_000,
  capacityUnits: 1,
  isRush: false,
  iat: NOW_MS / 1000,
  exp: NOW_MS / 1000 + 900,
  ...over,
});

export const customer = {
  name: "Asha",
  phone: "9876543210",
  deliveryAddress: "Baner, Pune",
  notes: null,
};

export const orderInput = (
  over: Partial<PlaceOrderInput> = {},
): PlaceOrderInput => ({
  quote: quote(),
  fulfilDate: DATE,
  capacity: { unitsCap: 5, rushCap: 2 },
  customer,
  idempotencyKey: uuid(),
  channel: "web",
  nowMs: NOW_MS,
  ...over,
});

export async function ledger(pool: Pool, date = DATE) {
  const [rows] = await pool.query(
    "SELECT reserved_units AS r, rush_units AS u FROM capacity_ledger WHERE fulfil_date=?",
    [date],
  );
  const row = (rows as { r: number; u: number }[])[0];
  return { reserved: row?.r ?? 0, rush: row?.u ?? 0 };
}

export async function count(pool: Pool, table: string): Promise<number> {
  const [rows] = await pool.query(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number((rows as { n: number }[])[0]!.n);
}
