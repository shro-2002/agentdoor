import { describe, expect, it } from "vitest";
import {
  PUBLIC_URL,
  callTool,
  customerBody,
  getQuoteToken,
  json,
  newKey,
  quoteBody,
  rpc,
  startShop,
} from "./http-helpers.js";

const REAL_IP = "203.0.113.5";
const form = (shopBase: string, path: string, fields: Record<string, string>, headers = {}) =>
  fetch(shopBase + path, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: PUBLIC_URL, ...headers },
    body: new URLSearchParams(fields).toString(),
  });

describe("rate limits (I-API-4, I-API-7, I-API-8)", () => {
  it("I-API-4: quote-rest allows 60/min/IP, then 429 + Retry-After (04 section 4)", async () => {
    const shop = await startShop();
    try {
      for (let i = 0; i < 60; i += 1) {
        expect((await json(shop, "POST", "/api/quotes", quoteBody())).status).toBe(201);
      }
      const r = await json(shop, "POST", "/api/quotes", quoteBody());
      expect(r.status).toBe(429);
      expect(r.body.error.code).toBe("RATE_LIMITED");
      expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    } finally {
      await shop.close();
    }
  });

  it("I-API-7: the forged leftmost X-Forwarded-For entry does not change the bucket key", async () => {
    const shop = await startShop(); // trust proxy = 1, the T01 topology
    try {
      for (let i = 0; i < 60; i += 1) {
        const r = await json(shop, "POST", "/api/quotes", quoteBody(), {
          "x-forwarded-for": `10.0.0.${i}, ${REAL_IP}`, // client-forged prefix, edge-appended real IP
        });
        expect(r.status).toBe(201);
      }
      const forged = await json(shop, "POST", "/api/quotes", quoteBody(), {
        "x-forwarded-for": `198.51.100.77, ${REAL_IP}`,
      });
      expect(forged.status).toBe(429);
      const other = await json(shop, "POST", "/api/quotes", quoteBody(), {
        "x-forwarded-for": `198.51.100.77, 203.0.113.6`,
      });
      expect(other.status).toBe(201); // a different real client has its own bucket
    } finally {
      await shop.close();
    }
  });

  it("trust proxy is never `true`: the app setting is the recorded hop count", async () => {
    const { createApp } = await import("../../src/app.js");
    const { config, bundle } = await import("./http-helpers.js");
    const { loadLaunchState } = await import("../../src/db/launch-state.js");
    const { keys, freshPool } = await import("./helpers.js");
    const pool = await freshPool();
    try {
      const app = createApp({ config, pool, launch: loadLaunchState(bundle(), keys.publicKey) });
      expect(app.get("trust proxy")).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it("I-API-8: exhausting mcp-read does not block place_order on the order bucket", async () => {
    const shop = await startShop();
    try {
      const token = await getQuoteToken(shop);
      for (let i = 0; i < 120; i += 1) {
        const r = await callTool(shop, "get_quote", quoteBody());
        expect(r.status).toBe(200);
      }
      const blocked = await callTool(shop, "get_quote", quoteBody());
      expect(blocked.status).toBe(429);
      expect((await rpc(shop, "tools/list", {})).status).toBe(429); // same bucket
      expect((await json(shop, "GET", "/api/business")).status).toBe(429); // REST read shares it
      const order = await callTool(shop, "place_order", {
        quoteToken: token,
        customerName: "Asha",
        customerPhone: "9876543210",
        idempotencyKey: newKey(),
      });
      expect(order.status).toBe(200);
      expect(order.body.result.isError).toBeFalsy();
      expect((await json(shop, "POST", "/api/quotes", quoteBody())).status).toBe(201); // quote-rest too
    } finally {
      await shop.close();
    }
  });

  it("I-API-8: order-create (MCP + REST combined, 20/min) does not block get_quote, contact or owner login", async () => {
    const shop = await startShop();
    try {
      const junk = { quoteToken: "x.y", customerName: "A", customerPhone: "9876543210", idempotencyKey: newKey() };
      for (let i = 0; i < 10; i += 1) {
        expect((await callTool(shop, "place_order", { ...junk, idempotencyKey: newKey() })).status).toBe(200);
        const rest = await json(shop, "POST", "/api/orders", {
          quoteToken: "x.y",
          customer: customerBody,
          idempotencyKey: newKey(),
        });
        expect(rest.status).toBe(400);
      }
      expect((await callTool(shop, "place_order", junk)).status).toBe(429);
      expect(
        (await json(shop, "POST", "/api/orders", { quoteToken: "x.y", customer: customerBody, idempotencyKey: newKey() }))
          .status,
      ).toBe(429);
      expect((await callTool(shop, "get_quote", quoteBody())).status).toBe(200);
      expect((await json(shop, "POST", "/api/quotes", quoteBody())).status).toBe(201);
      const contact = await form(shop.base, "/contact", { name: "A", email: "a@example.test", message: "hi", website: "" });
      expect(contact.status).toBe(303);
      const login = await form(shop.base, "/owner/login", { token: "wrong" });
      expect(login.status).toBe(401);
    } finally {
      await shop.close();
    }
  });

  it("contact: 5/min; owner login: 5 failures per IP, then 429, independent of the other buckets", async () => {
    const shop = await startShop();
    try {
      for (let i = 0; i < 5; i += 1) {
        const r = await form(shop.base, "/contact", { name: "A", email: "a@example.test", message: "hi", website: "bot" });
        expect(r.status).toBe(303); // honeypot: pretend success, charge the bucket
      }
      expect((await form(shop.base, "/contact", { name: "A", email: "a@example.test", message: "hi", website: "" })).status).toBe(429);
      for (let i = 0; i < 5; i += 1) expect((await form(shop.base, "/owner/login", { token: `bad${i}` })).status).toBe(401);
      const locked = await form(shop.base, "/owner/login", { token: "bad-again" });
      expect(locked.status).toBe(429);
      expect(locked.headers.get("retry-after")).toBeTruthy();
      expect((await callTool(shop, "get_quote", quoteBody())).status).toBe(200);
    } finally {
      await shop.close();
    }
  });

  it("owner login also has a global cap of 30 failures per 15 min across IPs", async () => {
    const shop = await startShop();
    try {
      for (let i = 0; i < 30; i += 1) {
        const r = await form(shop.base, "/owner/login", { token: "bad" }, { "x-forwarded-for": `192.0.2.${i}` });
        expect(r.status).toBe(401);
      }
      const r = await form(shop.base, "/owner/login", { token: "bad" }, { "x-forwarded-for": "192.0.2.200" });
      expect(r.status).toBe(429);
    } finally {
      await shop.close();
    }
  });
});
