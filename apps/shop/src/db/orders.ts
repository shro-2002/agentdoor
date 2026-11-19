import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  canonicalJson,
  sha256Hex,
  transition,
  type OrderEvent,
  type OrderStatus,
  type QuoteTokenPayload,
} from "@agentdoor/core";
import { newAccessToken, newOrderId } from "./ids.js";
import { isDuplicateKey, withTransaction } from "./tx.js";

export interface CustomerDetails {
  name: string;
  phone: string;
  deliveryAddress: string | null;
  notes: string | null;
}

export interface PlaceOrderInput {
  /** Already verified by the caller (signature, expiry, policy hash, engine re-check). */
  quote: QuoteTokenPayload;
  fulfilDate: string;
  /** `policy.capacity.overrides[date] ?? unitsPerDay` and the rush cap, as parameters. */
  capacity: { unitsCap: number; rushCap: number };
  customer: CustomerDetails;
  idempotencyKey: string;
  channel: "web" | "mcp";
  nowMs: number;
}

export type PlaceOrderErrorCode =
  | "QUOTE_ALREADY_USED"
  | "IDEMPOTENCY_CONFLICT"
  | "CAPACITY_FULL"
  | "RUSH_CAP_REACHED"
  | "RETRY_LATER";

export type PlaceOrderResult =
  | {
      ok: true;
      created: boolean;
      orderId: string;
      status: OrderStatus;
      /** Present only on the response that created the order. */
      accessToken?: string;
    }
  | { ok: false; code: PlaceOrderErrorCode };

type Attempt =
  | { kind: "PLACED"; orderId: string; accessToken: string }
  | { kind: "DUPLICATE" }
  | { kind: "REFUSED"; code: "CAPACITY_FULL" | "RUSH_CAP_REACHED" };

interface ExistingOrder {
  id: string;
  status: OrderStatus;
  requestHash: string;
}

const AUDIT_ORDER_PLACED = "ORDER_PLACED";

/** "Same body" = same quote id, request and customer; channel is transport, not content. */
const requestHashOf = (i: PlaceOrderInput): string =>
  sha256Hex(
    canonicalJson({ qid: i.quote.qid, request: i.quote.request, customer: i.customer }),
  );

async function findByIdempotencyKey(
  db: Pool | PoolConnection,
  key: string,
): Promise<ExistingOrder | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, status, request_hash FROM orders WHERE idempotency_key = ?",
    [key],
  );
  const row = rows[0];
  return row
    ? { id: row.id, status: row.status, requestHash: row.request_hash }
    : null;
}

function replayExisting(existing: ExistingOrder, hash: string): PlaceOrderResult {
  return existing.requestHash === hash
    ? { ok: true, created: false, orderId: existing.id, status: existing.status }
    : { ok: false, code: "IDEMPOTENCY_CONFLICT" };
}

/** Why the single conditional UPDATE matched nothing: read the row it was guarding. */
async function refusalReason(
  conn: PoolConnection,
  i: PlaceOrderInput,
  units: number,
): Promise<"CAPACITY_FULL" | "RUSH_CAP_REACHED"> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT reserved_units FROM capacity_ledger WHERE fulfil_date = ?",
    [i.fulfilDate],
  );
  const reserved = Number(rows[0]?.reserved_units ?? 0);
  return reserved + units > i.capacity.unitsCap ? "CAPACITY_FULL" : "RUSH_CAP_REACHED";
}

async function insertOrderRows(
  conn: PoolConnection,
  i: PlaceOrderInput,
  orderId: string,
  tokenHash: string,
  requestHash: string,
): Promise<void> {
  const q = i.quote;
  const at = new Date(i.nowMs);
  await conn.query(
    `INSERT INTO orders (id, quote_id, policy_hash, status, fulfil_date, capacity_units, is_rush,
       total_paise, request_json, customer_name, customer_phone, delivery_address, notes, channel,
       idempotency_key, request_hash, access_token_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'PENDING_OWNER', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      orderId, q.qid, q.policyHash, i.fulfilDate, q.capacityUnits, q.isRush ? 1 : 0,
      q.totalPaise, JSON.stringify(q.request), i.customer.name, i.customer.phone,
      i.customer.deliveryAddress, i.customer.notes, i.channel,
      i.idempotencyKey, requestHash, tokenHash, at, at,
    ],
  );
  await conn.query(
    "INSERT INTO audit_events (at, actor, event, order_id, detail) VALUES (?, ?, ?, ?, ?)",
    [
      at,
      i.channel === "mcp" ? "agent" : "customer",
      AUDIT_ORDER_PLACED,
      orderId,
      JSON.stringify({ qid: q.qid, units: q.capacityUnits, isRush: q.isRush }),
    ],
  );
}

/** One attempt, in the global lock order: quote_redemptions, capacity_ledger, orders, audit_events. */
async function attemptPlace(
  conn: PoolConnection,
  i: PlaceOrderInput,
  requestHash: string,
): Promise<{ commit: boolean; value: Attempt }> {
  const units = i.quote.capacityUnits;
  const rushUnits = i.quote.isRush ? units : 0;
  const orderId = newOrderId(i.nowMs);
  const access = newAccessToken();
  try {
    await conn.query("INSERT INTO quote_redemptions (quote_id, order_id, redeemed_at) VALUES (?, ?, ?)", [
      i.quote.qid,
      orderId,
      new Date(i.nowMs),
    ]);
    // GREATEST(rushCap, r): the engine already refuses one order larger than the rush cap, and
    // test I-ORD-5 books a 3-unit rush order on a cap of 2. Day totals still stop at the cap.
    const [res] = await conn.query<ResultSetHeader>(
      `UPDATE capacity_ledger
          SET reserved_units = reserved_units + ?, rush_units = rush_units + ?
        WHERE fulfil_date = ? AND reserved_units + ? <= ? AND rush_units + ? <= GREATEST(?, ?)`,
      [units, rushUnits, i.fulfilDate, units, i.capacity.unitsCap, rushUnits, i.capacity.rushCap, rushUnits],
    );
    if (res.affectedRows === 0)
      return { commit: false, value: { kind: "REFUSED", code: await refusalReason(conn, i, units) } };
    await insertOrderRows(conn, i, orderId, access.hash, requestHash);
  } catch (err) {
    if (isDuplicateKey(err)) return { commit: false, value: { kind: "DUPLICATE" } };
    throw err;
  }
  return { commit: true, value: { kind: "PLACED", orderId, accessToken: access.token } };
}

/** Exactly the sequence in 03 §5.2. */
export async function placeOrder(pool: Pool, input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const requestHash = requestHashOf(input);
  // Row must exist before any locking txn, so the txn only ever takes an exclusive row lock.
  await pool.query(
    "INSERT IGNORE INTO capacity_ledger (fulfil_date, reserved_units, rush_units) VALUES (?, 0, 0)",
    [input.fulfilDate],
  );
  const prior = await findByIdempotencyKey(pool, input.idempotencyKey);
  if (prior) return replayExisting(prior, requestHash);

  const tx = await withTransaction(pool, (conn) => attemptPlace(conn, input, requestHash));
  if (!tx.ok) return tx;
  const attempt = tx.value;
  if (attempt.kind === "PLACED")
    return { ok: true, created: true, orderId: attempt.orderId, status: "PENDING_OWNER", accessToken: attempt.accessToken };
  if (attempt.kind === "REFUSED") return { ok: false, code: attempt.code };

  // DUPLICATE: the winner has committed (our insert waited on its lock), so re-read by key.
  const winner = await findByIdempotencyKey(pool, input.idempotencyKey);
  return winner ? replayExisting(winner, requestHash) : { ok: false, code: "QUOTE_ALREADY_USED" };
}

export interface TransitionContext {
  nowMs: number;
}

export type TransitionOrderResult =
  | { ok: true; from: OrderStatus; to: OrderStatus }
  | { ok: false; code: "ORDER_NOT_FOUND" | "INVALID_TRANSITION" | "RETRY_LATER" };

interface OrderRow {
  status: OrderStatus;
  fulfilDate: string;
  units: number;
  rushUnits: number;
}

async function readOrder(pool: Pool, id: string): Promise<OrderRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT status, fulfil_date, capacity_units, is_rush FROM orders WHERE id = ?",
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  const units = Number(r.capacity_units);
  return {
    status: r.status,
    fulfilDate: String(r.fulfil_date),
    units,
    rushUnits: Number(r.is_rush) === 1 ? units : 0,
  };
}

type TransitionAttempt = "DONE" | "STALE";

/** Lock order: capacity_ledger, orders, audit_events (no redemption is touched here). */
async function attemptTransition(
  conn: PoolConnection,
  id: string,
  order: OrderRow,
  event: OrderEvent,
  to: OrderStatus,
  release: boolean,
  nowMs: number,
): Promise<{ commit: boolean; value: TransitionAttempt }> {
  await conn.query("SELECT fulfil_date FROM capacity_ledger WHERE fulfil_date = ? FOR UPDATE", [
    order.fulfilDate,
  ]);
  const at = new Date(nowMs);
  const [res] = await conn.query<ResultSetHeader>(
    "UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?",
    [to, at, id, order.status],
  );
  if (res.affectedRows === 0) return { commit: false, value: "STALE" };
  if (release)
    await conn.query(
      "UPDATE capacity_ledger SET reserved_units = reserved_units - ?, rush_units = rush_units - ? WHERE fulfil_date = ?",
      [order.units, order.rushUnits, order.fulfilDate],
    );
  await conn.query(
    "INSERT INTO audit_events (at, actor, event, order_id, detail) VALUES (?, 'owner', ?, ?, ?)",
    [at, `ORDER_${to}`, id, JSON.stringify({ from: order.status, event })],
  );
  return { commit: true, value: "DONE" };
}

/** 03 §5.2: read the date unlocked, then BEGIN, lock the ledger row, optimistic status update. */
export async function transitionOrder(
  pool: Pool,
  id: string,
  event: OrderEvent,
  ctx: TransitionContext,
): Promise<TransitionOrderResult> {
  const order = await readOrder(pool, id);
  if (!order) return { ok: false, code: "ORDER_NOT_FOUND" };
  const step = transition(order.status, event);
  if (!step.ok) return { ok: false, code: "INVALID_TRANSITION" };
  const tx = await withTransaction(pool, (conn) =>
    attemptTransition(conn, id, order, event, step.to, step.releasesCapacity, ctx.nowMs),
  );
  if (!tx.ok) return tx;
  return tx.value === "DONE"
    ? { ok: true, from: step.from, to: step.to }
    : { ok: false, code: "INVALID_TRANSITION" };
}
