import { request } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RPC_HEADERS, json, quoteBody, startShop, type TestShop } from "./http-helpers.js";

const MCP_COARSE_LIMIT = 300;
const GARBAGE = "{not json";

function rawGet(shop: TestShop, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = request(shop.base + path, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("malformed client input is a 4xx, never a logged 500 (R2 #7)", () => {
  let shop: TestShop;
  beforeAll(async () => {
    shop = await startShop();
  });
  afterAll(async () => {
    await shop.close();
  });

  const expectClientError = (status: number, body: any, expected: number) => {
    expect(status).toBe(expected);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(shop.logs.filter((l) => l.level === "error")).toEqual([]);
  };

  it("unsupported charset -> 415 VALIDATION_FAILED", async () => {
    const r = await json(shop, "POST", "/api/quotes", quoteBody(), {
      "content-type": "application/json; charset=no-such-charset",
    });
    expectClientError(r.status, r.body, 415);
  });

  it("unsupported content-encoding -> 415 VALIDATION_FAILED", async () => {
    const r = await json(shop, "POST", "/api/quotes", quoteBody(), { "content-encoding": "x-unknown" });
    expectClientError(r.status, r.body, 415);
  });

  it("bad percent-escape in a route parameter -> 400 VALIDATION_FAILED", async () => {
    const r = await rawGet(shop, "/orders/%ZZ?t=abc");
    expectClientError(r.status, r.body, 400);
  });

});

describe("/mcp has a coarse limiter before the body is parsed (R2 #7)", () => {
  it("garbage bodies are throttled per IP too", async () => {
    const shop = await startShop();
    try {
      for (let i = 0; i < MCP_COARSE_LIMIT; i += 1) {
        expect((await json(shop, "POST", "/mcp", GARBAGE, RPC_HEADERS)).status).toBe(400);
      }
      const r = await json(shop, "POST", "/mcp", GARBAGE, RPC_HEADERS);
      expect(r.status).toBe(429);
      expect(r.body.error.code).toBe("RATE_LIMITED");
    } finally {
      await shop.close();
    }
  });
});
