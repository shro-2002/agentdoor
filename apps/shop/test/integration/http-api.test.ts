import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signQuoteToken, type QuoteTokenPayload } from "@agentdoor/core";
import { createPool } from "../../src/db/pool.js";
import { keys, testDbConfig } from "./helpers.js";
import {
  FAR_DATE,
  NOW_MS,
  customerBody,
  getQuoteToken,
  json,
  newKey,
  policy,
  quoteBody,
  restOrder,
  startShop,
  type TestShop,
} from "./http-helpers.js";
import { policyHash } from "@agentdoor/core";

const stripRequestId = (text: string) => text.replace(/"requestId":"[^"]+"/, '"requestId":"-"');

describe("REST API (I-API-1..3, 5, 6, SEC-1, SEC-2, SEC-6)", () => {
  let shop: TestShop;
  beforeAll(async () => {
    shop = await startShop();
  });
  afterAll(async () => {
    await shop.close();
  });

  it("I-API-1: valid quote -> 201 with a token; envelope shape", async () => {
    const r = await json(shop, "POST", "/api/quotes", quoteBody({ notes: "please be generous" }));
    expect(r.status).toBe(201);
    expect(r.body.error).toBeNull();
    expect(r.body.data.quote.totalPaise).toBe(70_000);
    expect(r.body.data.quote.isRush).toBe(false);
    expect(r.body.data.quote.token).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(r.body.data.quote.expiresAt).toBe(
      new Date(NOW_MS + policy.orderRules.quoteValidityMinutes * 60_000).toISOString(),
    );
    expect(r.body.meta.requestId).toBeTruthy();
  });

  it("I-API-1: invalid JSON -> 400 envelope, no stack", async () => {
    const r = await json(shop, "POST", "/api/quotes", "{not json");
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_FAILED");
    expect(r.text).not.toMatch(/at .*\.(ts|js):\d+/);
  });

  it("I-API-1: schema-invalid body -> 400; refused -> 422 with reasons", async () => {
    const bad = await json(shop, "POST", "/api/quotes", { lines: [] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_FAILED");
    const closed = await json(shop, "POST", "/api/quotes", quoteBody({ date: "2026-11-30" }));
    expect(closed.status).toBe(422);
    expect(closed.body.error.code).toBe("CLOSED_DAY");
    expect(closed.body.data.outcome).toBe("REFUSED");
    expect(closed.body.data.reasons[0].code).toBe("CLOSED_DAY");
    expect(closed.body.data.quote).toBeUndefined();
  });

  it("I-API-1: an area the shop does not serve is refused, not silently quoted", async () => {
    const r = await json(
      shop,
      "POST",
      "/api/quotes",
      quoteBody({ fulfilment: { kind: "delivery", area: "Kothrud" } }),
    );
    expect(r.status).toBe(422);
    expect(r.body.data.reasons[0].code).toBe("AREA_NOT_SERVED");
  });

  it("I-API-2: body over 16 KB -> 413; notes over 500 chars -> 400", async () => {
    const big = await json(shop, "POST", "/api/quotes", quoteBody({ notes: "x".repeat(20_000) }));
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe("VALIDATION_FAILED");
    const long = await json(shop, "POST", "/api/quotes", quoteBody({ notes: "x".repeat(501) }));
    expect(long.status).toBe(400);
  });

  it("I-API-5: security headers and requestId on every kind of response", async () => {
    for (const [method, path, body] of [
      ["GET", "/healthz"],
      ["GET", "/api/business"],
      ["GET", "/no-such-page"],
      ["POST", "/api/quotes", "{bad"],
    ] as const) {
      const r = await json(shop, method, path, body);
      const csp = r.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("form-action 'self'");
      expect(csp).not.toContain("unsafe-inline'; script"); // no inline scripts
      expect(csp).not.toContain("frame-src");
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(r.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
      expect(r.headers.get("x-request-id")).toBeTruthy();
      if (r.body) expect(r.body.meta.requestId).toBe(r.headers.get("x-request-id"));
    }
  });

  it("healthz and business view expose the policy hash and no secrets", async () => {
    const h = await json(shop, "GET", "/healthz");
    expect(h.body.data).toMatchObject({ ok: true, launched: true, policyHash: policyHash(policy) });
    const b = await json(shop, "GET", "/api/business");
    expect(b.status).toBe(200);
    expect(b.body.data.name).toBe("Meera's Kitchen");
    expect(b.body.data.catalog).toHaveLength(4);
    expect(b.text).not.toContain("provenance");
  });

  it("order happy path, idempotent replay, conflicts and status lookup", async () => {
    const token = await getQuoteToken(shop);
    const key = newKey();
    const body = { quoteToken: token, customer: customerBody, idempotencyKey: key };
    const first = await json(shop, "POST", "/api/orders", body);
    expect(first.status).toBe(201);
    expect(first.body.data.status).toBe("PENDING_OWNER");
    const { orderId, accessToken } = first.body.data;
    const replay = await json(shop, "POST", "/api/orders", body);
    expect(replay.status).toBe(200);
    expect(replay.body.data.orderId).toBe(orderId);
    expect(replay.body.data.accessToken).toBe(accessToken);
    const conflict = await json(shop, "POST", "/api/orders", {
      ...body,
      customer: { ...customerBody, name: "Someone else" },
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    // SEC-2: the same quote cannot buy twice
    const reuse = await json(shop, "POST", "/api/orders", { ...body, idempotencyKey: newKey() });
    expect(reuse.status).toBe(409);
    expect(reuse.body.error.code).toBe("QUOTE_ALREADY_USED");
    const status = await json(shop, "GET", `/api/orders/${orderId}?t=${accessToken}`);
    expect(status.status).toBe(200);
    expect(status.body.data).toMatchObject({ orderId, status: "PENDING_OWNER" });
    expect(status.body.data.summary.totalPaise).toBe(70_000);
    expect(JSON.stringify(status.body)).not.toContain("9876543210");
  });

  it("capacity exhaustion maps to 422 CAPACITY_FULL", async () => {
    const big = { lines: [{ itemId: "cookie-box", qty: 10, optionIds: [] }], date: "2026-11-27" };
    const t1 = await getQuoteToken(shop, big);
    const ok = await json(shop, "POST", "/api/orders", {
      quoteToken: t1,
      customer: customerBody,
      idempotencyKey: newKey(),
    });
    expect(ok.status).toBe(201);
    const t2 = await getQuoteToken(shop, big);
    const full = await json(shop, "POST", "/api/orders", {
      quoteToken: t2,
      customer: customerBody,
      idempotencyKey: newKey(),
    });
    expect(full.status).toBe(422);
    expect(full.body.error.code).toBe("CAPACITY_FULL");
  });

  it("I-API-3 / SEC-6: wrong token and unknown id give identical 404 bodies", async () => {
    const o = await restOrder(shop);
    const id = o.body.data.orderId as string;
    const wrong = await json(shop, "GET", `/api/orders/${id}?t=${"a".repeat(43)}`);
    const missing = await json(shop, "GET", `/api/orders/${"0".repeat(26)}?t=${"a".repeat(43)}`);
    const noToken = await json(shop, "GET", `/api/orders/${id}`);
    expect(wrong.status).toBe(404);
    expect(stripRequestId(wrong.text)).toBe(stripRequestId(missing.text));
    expect(stripRequestId(noToken.text)).toBe(stripRequestId(missing.text));
  });

  it("I-API-6: expired quote -> 410 QUOTE_EXPIRED; stale policy -> 410 QUOTE_STALE_POLICY", async () => {
    const token = await getQuoteToken(shop, { date: "2026-11-28" });
    shop.clock.now = NOW_MS + (policy.orderRules.quoteValidityMinutes + 1) * 60_000;
    const expired = await json(shop, "POST", "/api/orders", {
      quoteToken: token,
      customer: customerBody,
      idempotencyKey: newKey(),
    });
    shop.clock.now = NOW_MS;
    expect(expired.status).toBe(410);
    expect(expired.body.error.code).toBe("QUOTE_EXPIRED");

    const payload: QuoteTokenPayload = {
      v: 1,
      qid: "22222222-2222-4222-8222-222222222222",
      shop: policy.business.slug,
      policyHash: "f".repeat(64),
      request: { lines: [{ itemId: "cookie-box", qty: 2, optionIds: [] }], fulfilment: { kind: "pickup" }, date: FAR_DATE },
      totalPaise: 70_000,
      capacityUnits: 2,
      isRush: false,
      iat: NOW_MS / 1000,
      exp: NOW_MS / 1000 + 600,
    };
    const stale = await json(shop, "POST", "/api/orders", {
      quoteToken: signQuoteToken(payload, keys.privateKey),
      customer: customerBody,
      idempotencyKey: newKey(),
    });
    expect(stale.status).toBe(410);
    expect(stale.body.error.code).toBe("QUOTE_STALE_POLICY");
  });

  it("SEC-1: tampered token and a validly signed but mispriced token are both rejected", async () => {
    const token = await getQuoteToken(shop, { date: "2026-11-28" });
    const [body, sig] = token.split(".") as [string, string];
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as QuoteTokenPayload;
    payload.totalPaise -= 1;
    const forged = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${sig}`;
    const r1 = await json(shop, "POST", "/api/orders", {
      quoteToken: forged,
      customer: customerBody,
      idempotencyKey: newKey(),
    });
    expect(r1.status).toBe(400);
    expect(r1.body.error.code).toBe("QUOTE_INVALID");
    // Even a holder of the signing key cannot get a price the engine disagrees with accepted.
    payload.qid = "33333333-3333-4333-8333-333333333333";
    const r2 = await json(shop, "POST", "/api/orders", {
      quoteToken: signQuoteToken(payload, keys.privateKey),
      customer: customerBody,
      idempotencyKey: newKey(),
    });
    expect(r2.status).toBe(400);
    expect(r2.body.error.code).toBe("QUOTE_INVALID");
  });

  it("order body validation: bad phone, bad idempotency key, extra field", async () => {
    const token = await getQuoteToken(shop, { date: "2026-11-28" });
    const base = { quoteToken: token, customer: customerBody, idempotencyKey: newKey() };
    for (const bad of [
      { ...base, customer: { ...customerBody, phone: "12345" } },
      { ...base, idempotencyKey: "not-a-uuid" },
      { ...base, surprise: 1 },
      { ...base, customer: { ...customerBody, name: "n".repeat(61) } },
    ]) {
      const r = await json(shop, "POST", "/api/orders", bad);
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe("VALIDATION_FAILED");
    }
  });

  it("JSON 404 for oauth / openid discovery, never HTML", async () => {
    for (const p of [
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource",
      "/.well-known/openid-configuration",
    ]) {
      const r = await json(shop, "GET", p);
      expect(r.status).toBe(404);
      expect(r.headers.get("content-type")).toContain("application/json");
      expect(r.body.error.code).toBe("NOT_FOUND");
    }
  });

  it("serves GET / (publish health probe), the launch report and agentdoor.json", async () => {
    const home = await json(shop, "GET", "/");
    expect(home.status).toBe(200);
    expect(home.text).toContain("Meera&#39;s Kitchen");
    expect(home.text).not.toContain("Not launched");
    expect((await json(shop, "GET", "/launch-report")).status).toBe(200);
    const wk = await json(shop, "GET", "/.well-known/agentdoor.json");
    expect(wk.body).toMatchObject({ shop: "meeras-kitchen", mcp: "/mcp", publicKey: keys.publicKey });
    expect(wk.body.launchRecord.record.policyHash).toBe(policyHash(policy));
  });

  it("logs are JSON lines with requestId and no phone numbers or query tokens", async () => {
    const o = await restOrder(shop);
    await json(shop, "GET", `/api/orders/${o.body.data.orderId}?t=${o.body.data.accessToken}`);
    const text = JSON.stringify(shop.logs);
    expect(shop.logs.some((l) => l.event === "request" && typeof l.requestId === "string")).toBe(true);
    expect(text).not.toContain("9876543210");
    expect(text).not.toContain(o.body.data.accessToken);
    expect(text).toContain("******3210");
  });
});

describe("boot guard and database failure", () => {
  it("U-GATE-4 over HTTP: edited policy -> SHOP_NOT_LAUNCHED 503, banner on /", async () => {
    const shop = await startShop({ editPrice: true });
    try {
      const q = await json(shop, "POST", "/api/quotes", quoteBody());
      expect(q.status).toBe(503);
      expect(q.body.error.code).toBe("SHOP_NOT_LAUNCHED");
      const h = await json(shop, "GET", "/healthz");
      expect(h.body.data.launched).toBe(false);
      const home = await json(shop, "GET", "/");
      expect(home.status).toBe(200);
      expect(home.text).toContain("Not launched");
    } finally {
      await shop.close();
    }
  });

  it("DB down -> 503 RETRY_LATER with Retry-After; quotes need no DB", async () => {
    const dead = createPool({ ...testDbConfig, port: 1 });
    const shop = await startShop({ appPool: dead });
    try {
      const token = await getQuoteToken(shop);
      expect(token).toBeTruthy();
      const r = await json(shop, "POST", "/api/orders", {
        quoteToken: token,
        customer: customerBody,
        idempotencyKey: newKey(),
      });
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe("RETRY_LATER");
      expect(r.headers.get("retry-after")).toBeTruthy();
      expect(r.text).not.toContain("ECONNREFUSED");
    } finally {
      await dead.end();
      await shop.close();
    }
  });

  it("pool exhaustion (queue limit reached) -> 503 RETRY_LATER", async () => {
    const tiny = createPool(testDbConfig, { connectionLimit: 1, queueLimit: 1 });
    const shop = await startShop({ appPool: tiny });
    const held = await tiny.getConnection();
    try {
      const tokens = await Promise.all([getQuoteToken(shop), getQuoteToken(shop, { date: "2026-11-28" })]);
      const fire = (t: string) =>
        json(shop, "POST", "/api/orders", { quoteToken: t, customer: customerBody, idempotencyKey: newKey() });
      const first = fire(tokens[0]!); // takes the one queue slot and waits
      await new Promise((r) => setTimeout(r, 200));
      const second = await fire(tokens[1]!); // queue full: rejected immediately
      expect(second.status).toBe(503);
      expect(second.body.error.code).toBe("RETRY_LATER");
      held.release();
      expect([201, 503]).toContain((await first).status);
    } finally {
      await tiny.end();
      await shop.close();
    }
  });
});
