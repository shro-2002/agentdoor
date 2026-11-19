import { createPool as createMysqlPool, type Pool } from "mysql2/promise";

/** Managed MySQL allows 200 connections (T01); 5 per instance leaves room for PREVIEW + PUBLISH. */
export const POOL_CONNECTION_LIMIT = 5;
const CONNECT_TIMEOUT_MS = 10_000;

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/** Waiters beyond this are rejected at once (mapped to RETRY_LATER) instead of queueing forever. */
export const POOL_QUEUE_LIMIT = 50;

export interface PoolLimits {
  connectionLimit?: number;
  queueLimit?: number;
}

export function createPool(db: DbConfig, limits: PoolLimits = {}): Pool {
  return createMysqlPool({
    ...db,
    connectionLimit: limits.connectionLimit ?? POOL_CONNECTION_LIMIT,
    queueLimit: limits.queueLimit ?? POOL_QUEUE_LIMIT,
    waitForConnections: true,
    connectTimeout: CONNECT_TIMEOUT_MS,
    charset: "utf8mb4",
    // DATE/DATETIME stay strings and instants are written as UTC: no host-timezone surprises.
    dateStrings: true,
    timezone: "Z",
  });
}
