import { afterEach, describe, expect, it } from "vitest";
import { ACCESS_MAX_AGE_MS } from "../../src/workspace/access.js";
import { LIMITS } from "../../src/workspace/config.js";
import { EXAMPLES } from "../../src/workspace/views/examples.js";
import { BENGALURU } from "../support/fake-claude.js";
import { CODE, startWorkspaceShop, type Browser, type WsShop } from "./workspace-helpers.js";

let shop: WsShop | null = null;
afterEach(async () => {
  await shop?.close();
  shop = null;
});

const draftCount = async (s: WsShop): Promise<number> => Number(((await s.pool.query("SELECT COUNT(*) AS n FROM ws_drafts"))[0] as { n: number }[])[0]!.n);
const forIp = (n: number) => ({ "x-forwarded-for": `198.51.100.${n}` });

/** A browser that has entered the code once: it holds the early-access cookie. */
async function admitted(s: WsShop, ip = 10): Promise<Browser> {
  const b = s.browser();
  const r = await b.post("/launch/access", { description: BENGALURU, code: CODE }, forIp(ip));
  expect(r.status).toBe(303);
  await s.jobs.idle();
  return b;
}

describe("early access: the landing page", () => {
  it("has no access-code field, no diagnostics or recorded-walkthrough links, and a closed dialog for the code", async () => {
    shop = await startWorkspaceShop();
    const page = (await shop.browser().get("/launch")).text;
    expect(page.match(/<form[^>]*data-composer[\s\S]*?<\/form>/)![0]).not.toContain('name="code"');
    for (const word of ["Diagnostics", "Launch report", "Recorded walk-through", "/launch-report", "/try", "eplay", "recorded"]) expect(page, word).not.toContain(word);
    expect(page).toContain("<dialog");
    expect(page).toContain('action="/launch/access"');
    expect(page).toContain("Built with Claude · Hosted on GoDaddy");
    expect(page).not.toContain("My businesses");
  });

  it("the example pills are plain links that prefill the composer on the server", async () => {
    shop = await startWorkspaceShop();
    const b = shop.browser();
    const page = (await b.get("/launch")).text;
    for (let i = 1; i <= EXAMPLES.length; i += 1) expect(page).toContain(`href="/launch?example=${i}"`);
    const composer = async (path: string): Promise<string> => /<textarea[^>]*>([^<]*)<\/textarea>/.exec((await b.get(path)).text)![1]!;
    expect(await composer("/launch?example=4")).toContain("Main ghar par cakes");
    expect(await composer("/launch?example=99")).toBe("");
    expect((await b.get("/launch?example=abc")).status).toBe(200);
  });

  it("a browser with a valid session gets no dialog, and the quiet My businesses link once it owns drafts", async () => {
    shop = await startWorkspaceShop();
    const b = await admitted(shop);
    const page = (await b.get("/launch")).text;
    expect(page).not.toContain("<dialog");
    expect(page).toContain('data-access="ok"');
    expect(page).toContain("My businesses");
    expect((await b.get("/launch/mine")).text).toContain("My businesses");
  });
});

describe("early access: who may create a draft", () => {
  it("no session and no code: refused with the access step, nothing is created", async () => {
    shop = await startWorkspaceShop();
    const r = await shop.browser().post("/launch", { description: BENGALURU });
    expect(r.status).toBe(403);
    expect(r.text).toContain("Early access");
    expect(r.text).toContain('action="/launch/access"');
    expect(await draftCount(shop)).toBe(0);
    expect(shop.fake.calls).toHaveLength(0);
  });

  it("a wrong code is refused, counted, and rate-limited per address (even for the right code afterwards)", async () => {
    shop = await startWorkspaceShop();
    const b = shop.browser();
    for (let i = 0; i < LIMITS.wrongCodesPerIpPerHour; i += 1) expect((await b.post("/launch/access", { description: BENGALURU, code: `x${i}` }, forIp(3))).status).toBe(403);
    const blocked = await b.post("/launch/access", { description: BENGALURU, code: "again" }, forIp(3));
    expect(blocked.status).toBe(429);
    expect((await b.post("/launch/access", { description: BENGALURU, code: CODE }, forIp(3))).status).toBe(429);
    expect(b.cookieHeader()).not.toContain("ad_early");
    expect(await draftCount(shop)).toBe(0);
  });

  it("the right code sets a signed, HttpOnly, Secure, SameSite=Lax 12-hour cookie and builds the draft; the description is never in a URL", async () => {
    shop = await startWorkspaceShop();
    const b = shop.browser();
    const r = await b.post("/launch/access", { description: BENGALURU, code: CODE });
    expect(r.status).toBe(303);
    expect(r.location).toMatch(/^\/launch\/w\/[0-9a-f]{32}\/setup$/);
    const cookie = r.headers.getSetCookie().find((c) => c.startsWith("ad_early="))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toContain(`Max-Age=${ACCESS_MAX_AGE_MS / 1000}`);
    expect(cookie).not.toContain(CODE);
    await shop.jobs.idle();
    expect(await draftCount(shop)).toBe(1);
  });

  it("a valid session builds drafts without a code; every other limit still applies", async () => {
    shop = await startWorkspaceShop();
    const b = await admitted(shop, 11);
    for (let i = 1; i < LIMITS.draftsPerIpPerHour; i += 1) expect((await b.post("/launch", { description: BENGALURU }, forIp(11))).status).toBe(303);
    expect((await b.post("/launch", { description: BENGALURU }, forIp(11))).status).toBe(429);
    await shop.jobs.idle();
    expect(await draftCount(shop)).toBe(LIMITS.draftsPerIpPerHour);
  });

  it("a tampered session is no session", async () => {
    shop = await startWorkspaceShop();
    const b = await admitted(shop, 12);
    const [body, sig] = b.cookieHeader().split("; ").find((c) => c.startsWith("ad_early="))!.slice("ad_early=".length).split(".");
    const forged = shop.browser();
    forged.setCookie("ad_early", `${body}.${sig!.slice(0, -2)}AA`);
    expect((await forged.post("/launch", { description: BENGALURU })).status).toBe(403);
    const other = shop.browser();
    other.setCookie("ad_early", `${Buffer.from(JSON.stringify({ iat: Date.now() * 2, c: "x" })).toString("base64url")}.${sig}`);
    expect((await other.post("/launch", { description: BENGALURU })).status).toBe(403);
    expect(await draftCount(shop)).toBe(1); // only the admitting request made one
  });

  it("an expired session is no session", async () => {
    shop = await startWorkspaceShop();
    const b = await admitted(shop, 13);
    shop.clock2.now += ACCESS_MAX_AGE_MS + 1000;
    const r = await b.post("/launch", { description: BENGALURU });
    expect(r.status).toBe(403);
    expect(r.text).toContain("Early access");
    expect(await draftCount(shop)).toBe(1);
  });

  it("while the workspace is closed nothing can be made, session or not", async () => {
    shop = await startWorkspaceShop({ code: null });
    const b = shop.browser();
    expect((await b.post("/launch/access", { description: BENGALURU, code: CODE })).status).toBe(503);
    expect(await draftCount(shop)).toBe(0);
  });

  it("an open workspace needs no code: no dialog, a draft is made, and the per-address limit still holds", async () => {
    shop = await startWorkspaceShop({ code: null, open: true });
    const page = (await shop.browser().get("/launch")).text;
    expect(page).not.toContain("<dialog");
    expect(page).toContain('data-access="ok"');
    const r = await shop.browser().post("/launch", { description: BENGALURU }, forIp(40));
    expect(r.status).toBe(303);
    await shop.jobs.idle();
    expect(await draftCount(shop)).toBe(1);
    for (let i = 0; i < LIMITS.draftsPerIpPerHour; i++) await shop.browser().post("/launch", { description: BENGALURU }, forIp(41));
    await shop.jobs.idle();
    expect((await shop.browser().post("/launch", { description: BENGALURU }, forIp(41))).status).toBe(429);
  });
});
