import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fakeOutput } from "../../apps/shop/test/support/fake-claude.js";

const BODY_LIMIT = 2_000_000;

export interface FakeClaude {
  baseUrl: string;
  /** Requests answered so far. */
  calls: () => number;
  close: () => Promise<void>;
}

/**
 * A local stand-in for the Anthropic API: POST /v1/messages answers with schema-valid compile,
 * clarify and scenario output for two bakeries. The shop under test is pointed at it through
 * ANTHROPIC_BASE_URL, so the real SDK and the real ClaudeClient run end to end. `delayMs` lets the
 * page show its working state long enough to be seen.
 */
export async function startFakeClaude(delayMs = 0): Promise<FakeClaude> {
  let calls = 0;
  const server: Server = createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size <= BODY_LIMIT) chunks.push(c);
    });
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { system: { text: string }[] | string; messages: { content: string }[] };
      const system = typeof body.system === "string" ? body.system : body.system.map((s) => s.text).join("\n");
      const user = body.messages.at(-1)?.content ?? "";
      calls += 1;
      const text = JSON.stringify(fakeOutput(system, user));
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "msg_fake",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-5-5",
            content: [{ type: "text", text }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 6000, output_tokens: 1800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          }),
        );
      }, delayMs);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    calls: () => calls,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
}
