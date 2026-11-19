import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeQuoteToken, fulfilmentInstantMs, signQuoteToken } from "@agentdoor/core";
import { keys } from "./helpers.js";
import {
  FAR_DATE,
  customerBody,
  getQuoteToken,
  json,
  newKey,
  startShop,
  type TestShop,
} from "./http-helpers.js";

const MINUTE_MS = 60_000;
const SECONDS_PER_DAY = 86_400;

let shop: TestShop;
beforeEach(async () => {
  shop = await startShop();
});
afterEach(async () => {
  await shop.close();
});

/** A genuine quote re-signed with a long expiry, to isolate the pickup-time check from `exp`. */
async function longLivedToken(): Promise<string> {
  const decoded = decodeQuoteToken(await getQuoteToken(shop), keys.publicKey);
  if (!decoded.ok) throw new Error("setup: quote did not decode");
  const { payload } = decoded;
  return signQuoteToken({ ...payload, exp: payload.iat + 30 * SECONDS_PER_DAY }, keys.privateKey);
}

const order = (quoteToken: string) =>
  json(shop, "POST", "/api/orders", { quoteToken, customer: customerBody, idempotencyKey: newKey() });

describe("a quote cannot be redeemed once its pickup time has passed (R2 #5)", () => {
  it("at or after 10:00 IST on the fulfilment date -> 410 QUOTE_EXPIRED, nothing stored", async () => {
    const token = await longLivedToken();
    shop.clock.now = fulfilmentInstantMs(FAR_DATE);
    const atInstant = await order(token);
    expect(atInstant.status).toBe(410);
    expect(atInstant.body.error.code).toBe("QUOTE_EXPIRED");
    shop.clock.now = fulfilmentInstantMs(FAR_DATE) + 30 * MINUTE_MS;
    const after = await order(token);
    expect(after.status).toBe(410);
    expect(after.body.error.code).toBe("QUOTE_EXPIRED");
    const [rows] = await shop.pool.query("SELECT COUNT(*) AS n FROM orders");
    expect((rows as { n: number }[])[0]!.n).toBe(0);
  });

  it("one minute before pickup the same token still works (only the passed-pickup case is refused)", async () => {
    const token = await longLivedToken();
    shop.clock.now = fulfilmentInstantMs(FAR_DATE) - MINUTE_MS;
    expect((await order(token)).status).toBe(201);
  });
});
