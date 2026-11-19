const TRANSIENT_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "PROTOCOL_CONNECTION_LOST",
  "ER_CON_COUNT_ERROR",
  "ER_SERVER_SHUTDOWN",
  // Managed MySQL caps connections per user: a busy moment, not a bug.
  "ER_TOO_MANY_USER_CONNECTIONS",
  "ER_USER_LIMIT_REACHED",
  "POOL_CLOSED",
]);
/** mysql2 raises a plain Error (no code) when the pool's wait queue is full. */
const POOL_QUEUE_FULL = "Queue limit reached";

/**
 * DB down, connection dropped or pool exhausted: the caller should say RETRY_LATER (503),
 * not 500. Anything else is a bug and must stay loud.
 */
export function isTransientDbError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as Error & { code?: string; errors?: unknown[] };
  if (e.code && TRANSIENT_CODES.has(e.code)) return true;
  if (e.message.startsWith(POOL_QUEUE_FULL)) return true;
  return Array.isArray(e.errors) && e.errors.length > 0 && e.errors.every(isTransientDbError);
}
