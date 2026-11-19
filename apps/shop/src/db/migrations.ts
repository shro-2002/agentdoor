import type { Pool } from "mysql2/promise";

const MIGRATE_LOCK = "agentdoor_migrate";
const LOCK_WAIT_SECONDS = 10;

/** 04 §6. Additive only: PREVIEW and PUBLISH share one database. */
export const MIGRATION_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS orders (
    id CHAR(26) PRIMARY KEY,
    quote_id CHAR(36) NOT NULL,
    policy_hash CHAR(64) NOT NULL,
    status ENUM('PENDING_OWNER','CONFIRMED','DECLINED','CANCELLED') NOT NULL,
    fulfil_date DATE NOT NULL,
    capacity_units INT NOT NULL,
    is_rush TINYINT(1) NOT NULL,
    total_paise INT NOT NULL,
    request_json JSON NOT NULL,
    customer_name VARCHAR(60) NOT NULL,
    customer_phone VARCHAR(20) NOT NULL,
    delivery_address VARCHAR(200) NULL,
    notes VARCHAR(500) NULL,
    channel ENUM('web','mcp') NOT NULL,
    idempotency_key CHAR(36) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    access_token_hash CHAR(64) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_orders_idem (idempotency_key),
    KEY idx_orders_status_date (status, fulfil_date)
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS quote_redemptions (
    quote_id CHAR(36) PRIMARY KEY,
    order_id CHAR(26) NOT NULL,
    redeemed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS capacity_ledger (
    fulfil_date DATE PRIMARY KEY,
    reserved_units INT NOT NULL DEFAULT 0,
    rush_units INT NOT NULL DEFAULT 0,
    CHECK (reserved_units >= 0),
    CHECK (rush_units >= 0)
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS contact_messages (
    id CHAR(26) PRIMARY KEY,
    name VARCHAR(60) NOT NULL,
    email VARCHAR(120) NOT NULL,
    message VARCHAR(2000) NOT NULL,
    email_status ENUM('SENT','FAILED') NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    actor ENUM('customer','agent','owner','system') NOT NULL,
    event VARCHAR(40) NOT NULL,
    order_id CHAR(26) NULL,
    detail JSON NULL,
    KEY idx_audit_order (order_id)
  ) DEFAULT CHARSET=utf8mb4`,
  // The workspace at /launch (apps/shop/src/workspace). Nothing here is read by the storefront,
  // orders, quotes or MCP; money is in millionths of a dollar so reserve/settle stay integer maths.
  `CREATE TABLE IF NOT EXISTS ws_drafts (
    id CHAR(32) PRIMARY KEY,
    preview_id CHAR(32) NULL,
    ip_hash CHAR(16) NOT NULL,
    state MEDIUMTEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    compile_rounds TINYINT NOT NULL DEFAULT 0,
    scenario_runs TINYINT NOT NULL DEFAULT 0,
    spent_micro BIGINT NOT NULL DEFAULT 0,
    reserved_micro BIGINT NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_ws_preview (preview_id)
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ws_jobs (
    id CHAR(32) PRIMARY KEY,
    draft_id CHAR(32) NOT NULL,
    kind VARCHAR(12) NOT NULL,
    status VARCHAR(10) NOT NULL,
    payload TEXT NULL,
    error_code VARCHAR(40) NULL,
    error_message VARCHAR(300) NULL,
    retryable TINYINT(1) NOT NULL DEFAULT 0,
    created_ms BIGINT NOT NULL,
    heartbeat_ms BIGINT NOT NULL,
    finished_ms BIGINT NULL,
    KEY idx_ws_jobs_draft (draft_id, created_ms)
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ws_budget (
    id TINYINT PRIMARY KEY,
    spent_micro BIGINT NOT NULL DEFAULT 0,
    reserved_micro BIGINT NOT NULL DEFAULT 0
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ws_hits (
    kind VARCHAR(16) NOT NULL,
    subject CHAR(32) NOT NULL,
    bucket BIGINT NOT NULL,
    hits INT NOT NULL DEFAULT 0,
    PRIMARY KEY (kind, subject, bucket)
  ) DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS ws_publish (
    draft_id CHAR(32) PRIMARY KEY,
    policy_json MEDIUMTEXT NOT NULL,
    policy_hash CHAR(64) NOT NULL,
    record_json TEXT NOT NULL,
    prepared_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) DEFAULT CHARSET=utf8mb4`,
];

/** Throws on failure. The lock is session-scoped, so it needs one dedicated connection. */
export async function runMigrations(pool: Pool): Promise<void> {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query("SELECT GET_LOCK(?, ?) AS got", [
      MIGRATE_LOCK,
      LOCK_WAIT_SECONDS,
    ]);
    if ((rows as { got: number | null }[])[0]?.got !== 1)
      throw new Error("could not acquire migration lock");
    try {
      for (const sql of MIGRATION_STATEMENTS) await conn.query(sql);
    } finally {
      await conn.query("SELECT RELEASE_LOCK(?)", [MIGRATE_LOCK]);
    }
  } finally {
    conn.release();
  }
}

/** Boot wrapper (03 §5.4): a shop with a broken schema must not serve. */
export async function migrateOrExit(pool: Pool): Promise<void> {
  try {
    await runMigrations(pool);
  } catch (err) {
    console.error(
      JSON.stringify({ event: "migration_failed", message: (err as Error).message }),
    );
    process.exit(1);
  }
}
