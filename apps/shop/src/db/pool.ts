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

export function createPool(db: DbConfig): Pool {
  return createMysqlPool({
    ...db,
    connectionLimit: POOL_CONNECTION_LIMIT,
    waitForConnections: true,
    connectTimeout: CONNECT_TIMEOUT_MS,
    charset: "utf8mb4",
    // DATE/DATETIME stay strings and instants are written as UTC: no host-timezone surprises.
    dateStrings: true,
    timezone: "Z",
  });
}
