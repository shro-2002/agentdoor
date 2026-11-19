import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  NOW_MS,
  PUBLIC_URL,
  callTool,
  customerBody,
  getQuoteToken,
  json,
  newKey,
  policy,
  startShop,
  type TestShop,
} from "./http-helpers.js";

const MINUTE_MS = 60_000;
const afterExpiry = () => NOW_MS + (policy.orderRules.quoteValidityMinutes + 5) * MINUTE_MS;

let shop: TestShop;
beforeEach(async () => {
  shop = await startShop();
});
afterEach(async () => {
  await shop.close();
});

const restBody = (quoteToken: string, idempotencyKey = newKey()) => ({
  quoteToken,
  customer: customerBody,
  idempotencyKey,
});
const mcpArgs = (quoteToken: string, idempotencyKey = newKey()) => ({
  quoteToken,
  customerName: customerBody.name,
  customerPhone: customerBody.phone,
  deliveryAddress: customerBody.address,
  idempotencyKey,
});
const statusUrl = (orderId: string, token: string) => PUBLIC_URL + "/orders/" + orderId + "?t=" + token;
const localPath = (url: string) => url.replace(/^https?:\/\/[^/]+/, shop.base);

describe("replay of an order whose first response was lost (R2 #1, #2)", () => {
  it("REST: same key + body after the quote expired -> 200, same order, same token and statusUrl", async () => {
    const body = restBody(await getQuoteToken(shop));
    const first = await json(shop, "POST", "/api/orders", body);
    expect(first.status).toBe(201);
    shop.clock.now = afterExpiry();
    const replay = await json(shop, "POST", "/api/orders", body);
    expect(replay.status).toBe(200);
    expect(replay.body.data.orderId).toBe(first.body.data.orderId);
    expect(replay.body.data.accessToken).toBe(first.body.data.accessToken);
    expect(replay.body.data.statusUrl).toBe(first.body.data.statusUrl);
    expect(first.body.data.statusUrl).toBe(statusUrl(first.body.data.orderId, first.body.data.accessToken));
    shop.clock.now = NOW_MS;
    const page = await json(shop, "GET", "/api/orders/" + replay.body.data.orderId + "?t=" + replay.body.data.accessToken);
    expect(page.status).toBe(200);
    const [rows] = await shop.pool.query("SELECT COUNT(*) AS n FROM orders");
    expect((rows as { n: number }[])[0]!.n).toBe(1);
  });

  it("REST: an expired quote with a NEW key is still refused, and the same key with other details conflicts", async () => {
    const token = await getQuoteToken(shop);
    const body = restBody(token);
    await json(shop, "POST", "/api/orders", body);
    shop.clock.now = afterExpiry();
    const other = await json(shop, "POST", "/api/orders", restBody(token));
    expect(other.status).toBe(410);
    expect(other.body.error.code).toBe("QUOTE_EXPIRED");
    const changed = await json(shop, "POST", "/api/orders", {
      ...body,
      customer: { ...customerBody, name: "Someone else" },
    });
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("REST: a tampered token never reaches the replay lookup", async () => {
    const token = await getQuoteToken(shop);
    const body = restBody(token);
    await json(shop, "POST", "/api/orders", body);
    const forged = token.slice(0, -4) + "AAAA";
    const r = await json(shop, "POST", "/api/orders", { ...body, quoteToken: forged });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("QUOTE_INVALID");
  });

  it("MCP: place_order retry after expiry returns the original order and status link", async () => {
    const args = mcpArgs(await getQuoteToken(shop));
    const first = await callTool(shop, "place_order", args);
    const sc = first.body.result.structuredContent;
    expect(sc.statusUrl).toBe(statusUrl(sc.orderId, sc.statusUrl.split("?t=")[1]));
    shop.clock.now = afterExpiry();
    const again = await callTool(shop, "place_order", args);
    expect(again.body.result.isError).toBeFalsy();
    expect(again.body.result.structuredContent.orderId).toBe(sc.orderId);
    expect(again.body.result.structuredContent.statusUrl).toBe(sc.statusUrl);
    shop.clock.now = NOW_MS;
    expect((await fetch(localPath(sc.statusUrl))).status).toBe(200);
  });
});
