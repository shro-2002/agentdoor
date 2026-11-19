// T01 throwaway spike. Never merged into apps/shop.
import express from "express";
import mysql from "mysql2/promise";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { sendEmail } from "./email.js";

const PORT = Number(process.env.PORT) || 3000;
const SSE_EVENTS = 5;
const SSE_INTERVAL_MS = 1000;
const DB_VARS = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"];
// Secret NAMES we expect to see; only booleans are ever returned.
const CUSTOM_VARS = ["CONTACT_FORM_RECIPIENT_EMAIL", "SPIKE_SECRET"];

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

let pool;
function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 3306,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      connectionLimit: 4,
    });
  }
  return pool;
}

const dbConfigured = () => DB_VARS.every((n) => Boolean(process.env[n]));
const fail = (res, code, err) =>
  res.status(code).json({ ok: false, error: String(err?.message ?? err).slice(0, 200) });

// Platform health probe may hit "/" (observed: deploy failed with 404 there).
app.get("/", (_req, res) => res.json({ ok: true, service: "agentdoor-spike" }));
app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.get("/spike/ip", (req, res) => {
  res.json({
    remoteAddress: req.socket.remoteAddress,
    xForwardedFor: req.get("x-forwarded-for") ?? null,
    xRealIp: req.get("x-real-ip") ?? null,
    forwarded: req.get("forwarded") ?? null,
    via: req.get("via") ?? null,
    cfConnectingIp: req.get("cf-connecting-ip") ?? null,
    trueClientIp: req.get("true-client-ip") ?? null,
    host: req.get("host") ?? null,
  });
});

app.get("/spike/env", async (_req, res) => {
  const present = (names) => Object.fromEntries(names.map((n) => [n, Boolean(process.env[n])]));
  const out = { node: process.version, db: present(DB_VARS), custom: present(CUSTOM_VARS) };
  if (dbConfigured()) {
    try {
      const [v] = await getPool().query("SELECT VERSION() AS version");
      const [m] = await getPool().query("SHOW VARIABLES LIKE 'max_connections'");
      out.mysql = { version: v[0].version, maxConnections: Number(m[0]?.Value) };
    } catch (err) {
      out.mysqlError = String(err.message).slice(0, 200);
    }
  }
  res.json(out);
});

// Persistence probe: each call appends a row; `rows` shows survival across restart/redeploy.
app.get("/spike/db", async (_req, res) => {
  if (!dbConfigured()) return fail(res, 503, "DB_* not configured");
  let conn;
  try {
    conn = await getPool().getConnection();
    await conn.query(
      "CREATE TABLE IF NOT EXISTS spike_rows (id INT AUTO_INCREMENT PRIMARY KEY, note VARCHAR(64) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
    );
    await conn.query("CREATE TABLE IF NOT EXISTS spike_counter (id INT PRIMARY KEY, n INT NOT NULL)");
    await conn.query("INSERT IGNORE INTO spike_counter (id, n) VALUES (1, 0)");
    const [one] = await conn.query("SELECT 1 AS one");
    await conn.beginTransaction();
    const [locked] = await conn.query("SELECT n FROM spike_counter WHERE id = 1 FOR UPDATE");
    await conn.query("UPDATE spike_counter SET n = n + 1 WHERE id = 1");
    await conn.query("INSERT INTO spike_rows (note) VALUES (?)", [`probe-n${locked[0].n + 1}`]);
    await conn.commit();
    const [rows] = await conn.query("SELECT id, note, created_at FROM spike_rows ORDER BY id DESC LIMIT 20");
    const [total] = await conn.query("SELECT COUNT(*) AS c FROM spike_rows");
    res.json({ ok: true, select1: one[0].one, forUpdateTxn: true, totalRows: total[0].c, rows });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    fail(res, 500, err);
  } finally {
    conn?.release();
  }
});

app.post("/spike/mail", async (_req, res) => {
  const to = process.env.CONTACT_FORM_RECIPIENT_EMAIL;
  if (!to) return fail(res, 503, "CONTACT_FORM_RECIPIENT_EMAIL not set");
  try {
    const { messageId } = await sendEmail({ to, subject: "spike", text: "ok" });
    res.json({ ok: true, messageId });
  } catch (err) {
    fail(res, 502, err);
  }
});

app.get("/spike/sse", async (req, res) => {
  res.set({ "content-type": "text/event-stream", "cache-control": "no-cache" });
  res.flushHeaders();
  const t0 = Date.now();
  for (let i = 1; i <= SSE_EVENTS && !req.destroyed; i++) {
    res.write(`data: ${JSON.stringify({ i, tMs: Date.now() - t0 })}\n\n`);
    await new Promise((r) => setTimeout(r, SSE_INTERVAL_MS));
  }
  res.end();
});

// Stateless MCP: fresh server + transport per request, JSON responses.
app.post("/mcp", async (req, res) => {
  const server = new McpServer({ name: "agentdoor-spike", version: "0.0.1" });
  server.registerTool("ping", { description: "Returns pong" }, async () => ({
    content: [{ type: "text", text: "pong" }],
  }));
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "internal error" }, id: null });
    }
  }
});

const methodNotAllowed = (_req, res) =>
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

app.listen(PORT, () => console.log(`spike listening on ${PORT}`));
