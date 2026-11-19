import { Router, type Request, type RequestHandler, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { sendError } from "../http/envelope.js";
import { jsonBody } from "../http/body.js";
import { charge, type Limiters } from "../security/rate-limits.js";
import type { ServiceContext } from "../services/context.js";
import { TOOL_INPUT_SCHEMAS, createMcpServer, isToolName, toolError } from "./mcp-tools.js";

interface RpcMessage {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: { name?: unknown; arguments?: unknown };
}

const isRpcObject = (body: unknown): body is RpcMessage =>
  typeof body === "object" && body !== null && !Array.isArray(body);

/**
 * 04 §4: charge the bucket for what the call does. `place_order` rides on `order-create`
 * (shared with REST orders); everything else, including unknown methods, on `mcp-read`.
 */
export function bucketFor(msg: RpcMessage, limiters: Limiters): RequestHandler {
  return msg.method === "tools/call" && msg.params?.name === "place_order"
    ? limiters.orderCreate
    : limiters.mcpRead;
}

/** Bad tool arguments are a tool result (`isError`, VALIDATION_FAILED), not a protocol error. */
function invalidToolCall(msg: RpcMessage): boolean {
  if (msg.method !== "tools/call" || !isToolName(msg.params?.name)) return false;
  return !TOOL_INPUT_SCHEMAS[msg.params.name].safeParse(msg.params.arguments ?? {}).success;
}

async function dispatch(ctx: ServiceContext, req: Request, res: Response): Promise<void> {
  const server = createMcpServer(ctx);
  // Stateless: no session id, plain JSON responses (no SSE stream to buffer at the CDN).
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

export function mcpRouter(ctx: ServiceContext, limiters: Limiters): Router {
  const router = Router();

  router.post("/mcp", jsonBody, async (req, res) => {
    const msg: unknown = req.body;
    // Batches are refused: each message must be charged to its own bucket, and MCP 2025-06 dropped them.
    if (!isRpcObject(msg)) return sendError(req, res, "VALIDATION_FAILED", { message: "Send one JSON-RPC message per request." });
    if (!(await charge(bucketFor(msg, limiters), req, res))) return;
    if (invalidToolCall(msg)) {
      const result = toolError("VALIDATION_FAILED", "The tool arguments are not valid. Check the input schema from tools/list.");
      res.json({ jsonrpc: "2.0", id: msg.id ?? null, result });
      return;
    }
    await dispatch(ctx, req, res);
  });

  // Stateless server: there is no stream to open and no session to close.
  const notAllowed: RequestHandler = (req, res) => {
    res.setHeader("Allow", "POST");
    sendError(req, res, "METHOD_NOT_ALLOWED");
  };
  router.get("/mcp", notAllowed);
  router.delete("/mcp", notAllowed);
  return router;
}
