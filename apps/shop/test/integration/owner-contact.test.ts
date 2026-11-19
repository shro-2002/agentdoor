import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  OWNER_TOKEN,
  PLATFORM_URL,
  PUBLIC_URL,
  NOW_MS,
  json,
  restOrder,
  startShop,
  type TestShop,
} from "./http-helpers.js";

const formPost = (
  shop: TestShop,
  path: string,
  fields: Record<string, string>,
  headers: Record<string, string> = {},
) =>
  fetch(shop.base + path, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  });

async function login(shop: TestShop): Promise<string> {
  const r = await formPost(shop, "/owner/login", { token: OWNER_TOKEN }, { origin: PUBLIC_URL });
  expect(r.status).toBe(303);
  const cookie = r.headers.get("set-cookie")!;
  return cookie.split(";")[0]!;
}

describe("owner auth and dashboard (SEC-3, SEC-4, SEC-5)", () => {
  let shop: TestShop;
  beforeAll(async () => {
    shop = await startShop();
  });
  afterAll(async () => {
    await shop.close();
  });

  it("anonymous /owner redirects to the login page; login page renders", async () => {
    const r = await fetch(shop.base + "/owner", { redirect: "manual" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/owner/login");
    expect((await fetch(shop.base + "/owner/login")).status).toBe(200);
  });

  it("wrong token -> generic 401; correct token -> 303 with a hardened cookie", async () => {
    const bad = await formPost(shop, "/owner/login", { token: "nope" }, { origin: PUBLIC_URL });
    expect(bad.status).toBe(401);
    expect(bad.headers.get("set-cookie")).toBeNull();
    const ok = await formPost(shop, "/owner/login", { token: OWNER_TOKEN }, { origin: PUBLIC_URL });
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("/owner");
    const cookie = ok.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).not.toContain(OWNER_TOKEN);
    const [payload, mac] = cookie.split(";")[0]!.split("=")[1]!.split(".");
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString())).toMatchObject({ iat: expect.any(Number), exp: expect.any(Number) });
    expect(mac).toBeTruthy();
  });

  it("SEC-4: cross-origin or origin-less POSTs are 403; the platform URL is allowed", async () => {
    const evil = await formPost(shop, "/owner/login", { token: OWNER_TOKEN }, { origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    expect(evil.headers.get("set-cookie")).toBeNull();
    const none = await formPost(shop, "/owner/login", { token: OWNER_TOKEN });
    expect(none.status).toBe(403);
    const platform = await formPost(shop, "/owner/login", { token: OWNER_TOKEN }, { origin: PLATFORM_URL });
    expect(platform.status).toBe(303);
  });

  it("R2 #4: the www counterpart of the public host is allowed; a sibling subdomain is not", async () => {
    const www = await formPost(shop, "/owner/login", { token: OWNER_TOKEN }, { origin: "https://www.shop.example.test" });
    expect(www.status).toBe(303);
    const evil = await formPost(shop, "/owner/login", { token: OWNER_TOKEN }, { origin: "https://evil.shop.example.test" });
    expect(evil.status).toBe(403);
  });

  it("tampered or expired cookies do not authenticate", async () => {
    const cookie = await login(shop);
    const [name, value] = cookie.split("=") as [string, string];
    const [payload, mac] = value.split(".") as [string, string];
    const longer = Buffer.from(JSON.stringify({ iat: 1, exp: 9_999_999_999 })).toString("base64url");
    for (const bad of [`${name}=${longer}.${mac}`, `${name}=${payload}.${"A".repeat(mac.length)}`, `${name}=garbage`]) {
      const r = await fetch(shop.base + "/owner", { redirect: "manual", headers: { cookie: bad } });
      expect(r.status).toBe(303);
    }
    shop.clock.now = NOW_MS + 24 * 3_600_000 * 2;
    const expired = await fetch(shop.base + "/owner", { redirect: "manual", headers: { cookie } });
    shop.clock.now = NOW_MS;
    expect(expired.status).toBe(303);
  });

  it("dashboard lists orders with every customer-controlled field escaped (SEC-5)", async () => {
    const o = await restOrder(shop, {
      customer: { name: "<script>alert(1)</script>", phone: "9876543210", address: '"><b>x</b>' },
      notes: "<img src=x onerror=alert(1)>",
    });
    expect(o.status).toBe(201);
    const cookie = await login(shop);
    const dash = await fetch(shop.base + "/owner", { headers: { cookie } });
    const html = await dash.text();
    expect(dash.status).toBe(200);
    expect(html).toContain(o.body.data.orderId);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(dash.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("confirm via POST, status page reflects it; invalid transition is 409; unknown id 404", async () => {
    const o = await restOrder(shop);
    const { orderId, accessToken } = o.body.data;
    const cookie = await login(shop);
    const go = (id: string, to: string, extra: Record<string, string> = { origin: PUBLIC_URL }) =>
      formPost(shop, `/owner/orders/${id}/transition`, { to }, { cookie, ...extra });
    expect((await go(orderId, "CONFIRMED")).status).toBe(303);
    const status = await json(shop, "GET", `/api/orders/${orderId}?t=${accessToken}`);
    expect(status.body.data.status).toBe("CONFIRMED");
    expect((await go(orderId, "DECLINED")).status).toBe(409);
    expect((await go("0".repeat(26), "CONFIRMED")).status).toBe(404);
    expect((await go(orderId, "SHIPPED")).status).toBe(400);
    expect((await go(orderId, "CANCELLED")).status).toBe(303);
  });

  it("transition requires a session and a same-site Origin", async () => {
    const o = await restOrder(shop);
    const id = o.body.data.orderId as string;
    const anon = await formPost(shop, `/owner/orders/${id}/transition`, { to: "DECLINED" }, { origin: PUBLIC_URL });
    expect(anon.status).toBe(303);
    expect(anon.headers.get("location")).toBe("/owner/login");
    const cookie = await login(shop);
    const csrf = await formPost(shop, `/owner/orders/${id}/transition`, { to: "DECLINED" }, { cookie, origin: "https://evil.example" });
    expect(csrf.status).toBe(403);
    const [rows] = await shop.pool.query("SELECT status FROM orders WHERE id = ?", [id]);
    expect((rows as { status: string }[])[0]!.status).toBe("PENDING_OWNER");
  });

  it("logout clears the cookie and ends the session", async () => {
    const cookie = await login(shop);
    const out = await formPost(shop, "/owner/logout", {}, { cookie, origin: PUBLIC_URL });
    expect(out.status).toBe(303);
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });
});

interface Sent {
  to: string[];
  subject: string;
  text?: string;
  replyTo?: string;
}

describe("contact form (I-MAIL-1, SEC-13)", () => {
  let shop: TestShop;
  let gateway: Server;
  let sent: Sent[];
  let gatewayStatus = 200;

  beforeAll(async () => {
    shop = await startShop();
    // the vended helper posts to 127.0.0.1:2525 and does not accept an override
    gateway = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        if (gatewayStatus === 200) sent.push(JSON.parse(raw) as Sent);
        res.writeHead(gatewayStatus, { "content-type": "application/json" });
        res.end(
          gatewayStatus === 200
            ? JSON.stringify({ success: true, messageId: "mock-1" })
            : JSON.stringify({ success: false, error: "smtp exploded at secret-host.internal" }),
        );
      });
    });
    await new Promise<void>((r, j) => {
      gateway.once("error", j);
      gateway.listen(2525, "127.0.0.1", r);
    });
  });
  afterAll(async () => {
    await new Promise<void>((r) => gateway.close(() => r()));
    await shop.close();
  });
  beforeEach(async () => {
    sent = [];
    gatewayStatus = 200;
    await shop.pool.query("DELETE FROM contact_messages");
    shop.logs.length = 0;
  });

  // Every post comes from its own client IP so the 5/min contact bucket stays out of these tests.
  let ipSeq = 0;
  const post = (fields: Record<string, string>, headers: Record<string, string> = { origin: PUBLIC_URL }) => {
    ipSeq += 1;
    return formPost(shop, "/contact", { website: "", ...fields }, { "x-forwarded-for": `10.9.0.${ipSeq}`, ...headers });
  };
  const rows = async () =>
    (await shop.pool.query("SELECT name, email, message, email_status FROM contact_messages"))[0] as {
      name: string;
      email: string;
      message: string;
      email_status: string;
    }[];

  it("R2 #4: the contact form works from the www origin", async () => {
    const r = await post(
      { name: "Priya", email: "priya@example.test", message: "From www" },
      { origin: "https://www.shop.example.test" },
    );
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/contact?sent=1");
  });

  it("GET /contact renders the form with a hidden honeypot field", async () => {
    const r = await fetch(shop.base + "/contact");
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(html).toContain('name="website"');
    expect(html).toContain('action="/contact"');
  });

  it("stores the message, then sends it to the recipient from env; 303 to ?sent=1", async () => {
    const r = await post({ name: "Priya", email: "priya@example.test", message: "Do you do vegan cakes?" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/contact?sent=1");
    expect(await rows()).toEqual([
      { name: "Priya", email: "priya@example.test", message: "Do you do vegan cakes?", email_status: "SENT" },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(["hello@example.test"]);
    expect(sent[0]!.subject).toContain("Priya");
    expect(sent[0]!.subject).toMatch(/Meera's Kitchen|AgentDoor/);
    expect(sent[0]!.replyTo).toBe("priya@example.test");
    expect(sent[0]!.text).toContain("Do you do vegan cakes?");
    const page = await (await fetch(shop.base + "/contact?sent=1")).text();
    expect(page).toMatch(/thank/i);
  });

  it("gateway 500 -> stored FAILED, generic text for the user, raw error only in logs", async () => {
    gatewayStatus = 500;
    const r = await post({ name: "Priya", email: "priya@example.test", message: "hello" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/contact?sent=0");
    expect((await rows())[0]!.email_status).toBe("FAILED");
    const page = await (await fetch(shop.base + "/contact?sent=0")).text();
    expect(page).toMatch(/saved/i);
    expect(page).not.toContain("secret-host");
    expect(JSON.stringify(shop.logs)).toContain("secret-host.internal");
    const cookie = await login(shop);
    const dash = await (await fetch(shop.base + "/owner", { headers: { cookie } })).text();
    expect(dash).toContain("priya@example.test");
  });

  it("SEC-13: CRLF in name or email is rejected; nothing stored or sent", async () => {
    for (const fields of [
      { name: "Evil\r\nBcc: spam@example.test", email: "a@example.test", message: "x" },
      { name: "Evil", email: "a@example.test\r\nBcc: spam@example.test", message: "x" },
      { name: "Evil", email: "not-an-email", message: "x" },
      { name: "Evil", email: "a@example.test", message: "m".repeat(2001) },
      { name: "", email: "a@example.test", message: "x" },
    ]) {
      expect((await post(fields)).status).toBe(400);
    }
    expect(await rows()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("SEC-13: honeypot fills pretend success but store and send nothing; cross-origin is 403", async () => {
    const bot = await post({ name: "Bot", email: "b@example.test", message: "buy now", website: "http://spam" });
    expect(bot.status).toBe(303);
    const evil = await post({ name: "A", email: "a@example.test", message: "x" }, { origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    expect(await rows()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });
});
