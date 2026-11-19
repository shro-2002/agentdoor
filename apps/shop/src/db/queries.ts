import type { Pool, RowDataPacket } from "mysql2/promise";
import { sha256Hex, type OrderStatus } from "@agentdoor/core";

const ORDER_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ACCESS_TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
const DASHBOARD_ORDER_LIMIT = 100;
const DASHBOARD_CONTACT_LIMIT = 50;

export const isOrderId = (id: string): boolean => ORDER_ID_RE.test(id);

export interface OrderSummary {
  orderId: string;
  status: OrderStatus;
  fulfilDate: string;
  totalPaise: number;
  isRush: boolean;
  channel: "web" | "mcp";
  request: unknown;
  createdAt: string;
}

/**
 * Customer-facing read. Wrong token and unknown id are indistinguishable (null): no existence
 * oracle (SEC-6). Only the token's hash is stored, and it is matched in SQL.
 */
export async function findOrderForAccess(pool: Pool, id: string, token: string): Promise<OrderSummary | null> {
  if (!ORDER_ID_RE.test(id) || !ACCESS_TOKEN_RE.test(token)) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, status, fulfil_date, total_paise, is_rush, channel, request_json, created_at
       FROM orders WHERE id = ? AND access_token_hash = ?`,
    [id, sha256Hex(token)],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    orderId: r.id,
    status: r.status,
    fulfilDate: String(r.fulfil_date),
    totalPaise: Number(r.total_paise),
    isRush: Number(r.is_rush) === 1,
    channel: r.channel,
    request: typeof r.request_json === "string" ? JSON.parse(r.request_json) : r.request_json,
    createdAt: String(r.created_at),
  };
}

export interface DashboardOrder {
  id: string;
  status: OrderStatus;
  fulfilDate: string;
  totalPaise: number;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string | null;
  notes: string | null;
  channel: "web" | "mcp";
  createdAt: string;
}

export async function listOrders(pool: Pool): Promise<DashboardOrder[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, status, fulfil_date, total_paise, customer_name, customer_phone, delivery_address,
            notes, channel, created_at
       FROM orders ORDER BY created_at DESC, id DESC LIMIT ?`,
    [DASHBOARD_ORDER_LIMIT],
  );
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    fulfilDate: String(r.fulfil_date),
    totalPaise: Number(r.total_paise),
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    deliveryAddress: r.delivery_address,
    notes: r.notes,
    channel: r.channel,
    createdAt: String(r.created_at),
  }));
}

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  message: string;
  emailStatus: "SENT" | "FAILED";
  createdAt: string;
}

/** 04 §6: store first, email outside the txn, then update. FAILED until the email succeeds. */
export async function insertContact(
  pool: Pool,
  m: { id: string; name: string; email: string; message: string; at: Date },
): Promise<void> {
  await pool.query(
    `INSERT INTO contact_messages (id, name, email, message, email_status, created_at)
     VALUES (?, ?, ?, ?, 'FAILED', ?)`,
    [m.id, m.name, m.email, m.message, m.at],
  );
}

export async function markContactSent(pool: Pool, id: string): Promise<void> {
  await pool.query("UPDATE contact_messages SET email_status = 'SENT' WHERE id = ?", [id]);
}

export async function listContacts(pool: Pool): Promise<ContactMessage[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, email, message, email_status, created_at
       FROM contact_messages ORDER BY created_at DESC, id DESC LIMIT ?`,
    [DASHBOARD_CONTACT_LIMIT],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    message: r.message,
    emailStatus: r.email_status,
    createdAt: String(r.created_at),
  }));
}
