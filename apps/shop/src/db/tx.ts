import type { Pool, PoolConnection } from "mysql2/promise";

/** 03 §5.2: at most 3 attempts, 20-80 ms jitter, then RETRY_LATER. */
export const MAX_ATTEMPTS = 3;
const JITTER_MIN_MS = 20;
const JITTER_MAX_MS = 80;
const ER_LOCK_WAIT_TIMEOUT = 1205;
const ER_LOCK_DEADLOCK = 1213;
const ER_DUP_ENTRY = 1062;

const errno = (err: unknown): number | undefined => (err as { errno?: number }).errno;

export const isLockError = (err: unknown): boolean =>
  errno(err) === ER_LOCK_DEADLOCK || errno(err) === ER_LOCK_WAIT_TIMEOUT;

export const isDuplicateKey = (err: unknown): boolean => errno(err) === ER_DUP_ENTRY;

/** The body decides: `commit: false` rolls back (refusals, duplicates) and still returns `value`. */
export interface TxOutcome<T> {
  commit: boolean;
  value: T;
}

export type TxResult<T> = { ok: true; value: T } | { ok: false; code: "RETRY_LATER" };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = () => JITTER_MIN_MS + Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS);

/**
 * Runs `body` in a transaction with bounded retry on deadlock / lock-wait timeout.
 * Every exit path rolls back before the connection returns to the pool, so a pooled
 * connection never carries an open transaction.
 */
export async function withTransaction<T>(
  pool: Pool,
  body: (conn: PoolConnection) => Promise<TxOutcome<T>>,
): Promise<TxResult<T>> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const conn = await pool.getConnection();
    let committed = false;
    try {
      await conn.beginTransaction();
      const outcome = await body(conn);
      if (outcome.commit) {
        await conn.commit();
        committed = true;
      }
      return { ok: true, value: outcome.value };
    } catch (err) {
      if (!isLockError(err)) throw err;
    } finally {
      if (!committed) await conn.rollback().catch(() => undefined);
      conn.release();
    }
    if (attempt < MAX_ATTEMPTS) await sleep(jitter());
  }
  return { ok: false, code: "RETRY_LATER" };
}
