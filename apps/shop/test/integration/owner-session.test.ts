import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OWNER_TOKEN, PUBLIC_URL, startShop, type TestShop } from "./http-helpers.js";

const SECOND_MS = 1000;
const GLOBAL_LIMIT = 30;

const form = (shop: TestShop, path: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
  fetch(shop.base + path, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  });

const ip = (n: number) => ({ "x-forwarded-for": "192.0.2." + n });
const loginFrom = (shop: TestShop, token: string, n: number, origin = PUBLIC_URL) =>
  form(shop, "/owner/login", { token }, { origin, ...ip(n) });
const cookieOf = (r: Response) => r.headers.get("set-cookie")!.split(";")[0]!;
const ownerPage = (base: string, cookie: string) => fetch(base + "/owner", { redirect: "manual", headers: { cookie } });

let shop: TestShop;
beforeEach(async () => {
  shop = await startShop();
});
afterEach(async () => {
  await shop.close();
});

describe("owner lockout cannot be forced by an outsider (R2 #6a)", () => {
  it("cross-site POSTs (403) never count against the login buckets", async () => {
    for (let i = 0; i < 8; i += 1) {
      expect((await loginFrom(shop, "x", 1, "https://evil.example")).status).toBe(403);
    }
    const real = await loginFrom(shop, OWNER_TOKEN, 1);
    expect(real.status).toBe(303);
  });

  it("with the global bucket burnt by guesses from many IPs, the correct token still gets in", async () => {
    for (let i = 0; i < GLOBAL_LIMIT; i += 1) expect((await loginFrom(shop, "guess" + i, 10 + i)).status).toBe(401);
    // the 31st wrong guess is limited
    expect((await loginFrom(shop, "guess-31", 100)).status).toBe(429);
    // the owner, from yet another IP, is not
    expect((await loginFrom(shop, OWNER_TOKEN, 101)).status).toBe(303);
  });

  it("the per-IP bucket still applies to the correct token once that IP burnt its 5 failures", async () => {
    for (let i = 0; i < 5; i += 1) expect((await loginFrom(shop, "bad" + i, 50)).status).toBe(401);
    expect((await loginFrom(shop, OWNER_TOKEN, 50)).status).toBe(429);
  });
});

describe("logout revokes sessions server-side (R2 #6b)", () => {
  it("after logout, the old cookie no longer opens the dashboard, even if the browser keeps it", async () => {
    const cookie = cookieOf(await loginFrom(shop, OWNER_TOKEN, 1));
    expect((await ownerPage(shop.base, cookie)).status).toBe(200);
    shop.clock.now += SECOND_MS;
    const out = await form(shop, "/owner/logout", {}, { cookie, origin: PUBLIC_URL });
    expect(out.status).toBe(303);
    expect((await ownerPage(shop.base, cookie)).status).toBe(303);
    // a fresh login afterwards works
    const again = cookieOf(await loginFrom(shop, OWNER_TOKEN, 1));
    expect((await ownerPage(shop.base, again)).status).toBe(200);
  });

  it("logout revokes every earlier session, not just the one that logged out", async () => {
    const phone = cookieOf(await loginFrom(shop, OWNER_TOKEN, 1));
    const laptop = cookieOf(await loginFrom(shop, OWNER_TOKEN, 2));
    shop.clock.now += SECOND_MS;
    await form(shop, "/owner/logout", {}, { cookie: laptop, origin: PUBLIC_URL });
    expect((await ownerPage(shop.base, phone)).status).toBe(303);
  });

  it("logout without a valid session does nothing: it cannot be used to sign the owner out", async () => {
    const cookie = cookieOf(await loginFrom(shop, OWNER_TOKEN, 1));
    shop.clock.now += SECOND_MS;
    const anon = await form(shop, "/owner/logout", {}, { origin: PUBLIC_URL });
    expect(anon.status).toBe(303);
    expect(anon.headers.get("location")).toBe("/owner/login");
    expect((await ownerPage(shop.base, cookie)).status).toBe(200);
  });
});

describe("sessions are bound to the owner token (R2 #6b)", () => {
  it("a cookie stops working after OWNER_TOKEN_HASH changes", async () => {
    const cookie = cookieOf(await loginFrom(shop, OWNER_TOKEN, 1));
    expect((await ownerPage(shop.base, cookie)).status).toBe(200);
    const rotated = await startShop({
      config: { ownerTokenHash: createHash("sha256").update("a-new-owner-token").digest("hex") },
    });
    try {
      expect((await ownerPage(rotated.base, cookie)).status).toBe(303);
    } finally {
      await rotated.close();
    }
  });
});
