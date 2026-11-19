import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { policyHash } from "@agentdoor/core";
import { BENGALURU } from "../support/fake-claude.js";
import { policy as shopPolicy, startShop, type TestShop } from "./http-helpers.js";
import { clearEverything, settle, startWorkspaceShop, type Browser, type WsShop } from "./workspace-helpers.js";

const text = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/\s+/g, " ");
const section = (html: string): string => {
  const at = html.indexOf('id="busy-day"');
  return text(html.slice(at, html.indexOf("</section>", at)));
};

describe("the live shop's rehearsed badge, rules page and well-known summary", () => {
  let shop: TestShop;
  beforeAll(async () => {
    shop = await startShop();
  });
  afterAll(() => shop.close());
  const get = (path: string) => fetch(shop.base + path).then(async (r) => ({ status: r.status, body: await r.text(), type: r.headers.get("content-type") ?? "" }));

  it("the home page shows the badge with the signed record's 35 checks (30 probes + 5 customer tests) and a footer link", async () => {
    const r = await get("/");
    expect(r.body).toContain("Rehearsed before launch · 35 checks · rules approved by the owner");
    expect(r.body).toContain('href="/how-we-work"');
    expect(r.body).toMatch(/<footer[\s\S]*How we work/);
  });

  it("/how-we-work lists the rules, the owner's words, and the verified fingerprint", async () => {
    const r = await get("/how-we-work");
    expect(r.status).toBe(200);
    expect(r.type).toContain("text/html");
    expect(r.body).toContain("The rules this shop follows");
    expect(r.body).toContain("“chocolate cake is 600 rupees a kg”");
    expect(r.body).toContain(`<code class="mono">${policyHash(shopPolicy).slice(0, 12)}</code>`);
    expect(r.body).toContain("rehearsed with 35 checks");
    expect(r.body).not.toMatch(/<script[^>]*>[^<]/);
  });

  it("/.well-known/agentdoor.json keeps its fields and adds the rehearsal summary", async () => {
    const r = await get("/.well-known/agentdoor.json");
    const doc = JSON.parse(r.body) as Record<string, unknown>;
    expect(Object.keys(doc)).toEqual(expect.arrayContaining(["shop", "policyHash", "publicKey", "mcp", "launchRecord"]));
    expect(doc.policyHash).toBe(policyHash(shopPolicy));
    expect(doc.rehearsal).toMatchObject({ rehearsedBeforeLaunch: true, checks: 35, rulesApproved: 10, rulesRequired: 10, policyHashPrefix: policyHash(shopPolicy).slice(0, 12), signatureVerifiedAtStartup: true, rulesUrl: "/how-we-work" });
  });
});

describe("the workspace: your busiest day, money at stake, protected, previews", () => {
  let shop: WsShop;
  beforeAll(async () => {
    shop = await startWorkspaceShop();
  });
  afterAll(() => shop.close());

  async function rehearsedDraft(): Promise<{ b: Browser; id: string }> {
    const b = shop.browser();
    const id = await b.create(BENGALURU);
    await settle(b, shop, id);
    await b.post(`/launch/w/${id}/setup/answer`, { questionId: "q1", answer: "Refuse custom designs" });
    await b.post(`/launch/w/${id}/setup/answer`, { questionId: "q2", answer: "₹500" });
    await b.post(`/launch/w/${id}/setup/answer`, { questionId: "q3", answer: "No rush orders" });
    await settle(b, shop, id);
    await b.post(`/launch/w/${id}/rehearse`, { mode: "full" });
    await settle(b, shop, id);
    return { b, id };
  }

  const version = async (id: string): Promise<number> => Number(((await shop.pool.query("SELECT version FROM ws_drafts WHERE id = ?", [id]))[0] as { version: number }[])[0]!.version);

  it("offers the simulation, runs it on request, never writes, and gives the same answer twice", async () => {
    const { b, id } = await rehearsedDraft();
    const idle = (await b.get(`/launch/w/${id}/rehearse`)).text;
    expect(idle).toContain("Your busiest day");
    expect(idle).toContain("Simulate a festival rush");
    expect(idle).toContain("A simulation using your rules. No real orders were placed.");
    expect(idle).not.toContain("Oversold");

    const before = await version(id);
    const first = section((await b.get(`/launch/w/${id}/rehearse?simulate=1`)).text);
    const second = section((await b.get(`/launch/w/${id}/rehearse?simulate=1`)).text);
    expect(await version(id)).toBe(before);
    expect(first).toBe(second);
    expect(first).toContain("Oversold: 0");
    expect(first).toContain("Orders are booked one at a time against your limit, exactly like the live shop");
    for (const reason of ["Daily limit reached", "Too soon", "Closed that day", "Over the per-order limit"]) expect(first).toContain(reason);
    expect(first).toContain("See every order (50)");
    expect(first).toContain("4 of 4 units booked");
  });

  it("with no daily limit it says so, offers 'Set a daily limit', and the limit re-runs the simulation", async () => {
    const { b, id } = await rehearsedDraft();
    const saved = await b.post(`/launch/w/${id}/busy-day/limit`, { unitsPerDay: "500" });
    expect(saved.status).toBe(303);
    expect(saved.location).toBe(`/launch/w/${id}/rehearse?simulate=1#busy-day`);
    const warn = section((await b.follow(saved)).text);
    expect(warn).toMatch(/\d+ of 50 accepted: \d+ units booked for .+\. Is that possible for you\?/);
    expect(warn).toContain("Set a daily limit");
    expect(warn).toContain("no daily limit set");

    const fixed = await b.post(`/launch/w/${id}/busy-day/limit`, { unitsPerDay: "6" });
    const after = section((await b.follow(fixed)).text);
    expect(after).not.toContain("Is that possible for you?");
    expect(after).toContain("of 6 units booked");
    expect(after).toContain("Oversold: 0");
    expect((await b.post(`/launch/w/${id}/busy-day/limit`, { unitsPerDay: "0" })).status).toBe(400);
  });

  it("issue cards show the money at stake with the working, and a fix shows what it protected", async () => {
    const { b, id } = await rehearsedDraft();
    const page = (await b.get(`/launch/w/${id}/rehearse`)).text;
    expect(page).toContain("Money at stake: ₹3,600");
    expect(page).toContain("Order in this case: 3 kg Chocolate truffle cake at ₹1,200/kg = ₹3,600 quoted automatically");
    expect(page).not.toContain("Protected so far");

    const forms = page.split("<form").slice(1).map((f) => f.split("</form>")[0]!);
    const bulk = forms.find((f) => f.includes("SCENARIO_UNHANDLED:office-bulk") && f.includes('name="value"'))!;
    const choice = /name="choice" value="([^"]*)"/.exec(bulk)![1]!;
    await b.post(`/launch/w/${id}/fix`, { gapId: "SCENARIO_UNHANDLED:office-bulk", choice, value: "2" });
    const after = (await b.get(`/launch/w/${id}/rehearse`)).text;
    expect(text(after)).toContain("Protected so far: ₹3,600");
    expect(after).not.toContain("Money at stake: ₹3,600");
  });

  it("previews say 'Not yet rehearsed' until the gate passes, then show the badge", async () => {
    const { b, id } = await rehearsedDraft();
    await b.post(`/launch/w/${id}/preview`);
    const previewId = /\/launch\/p\/([0-9a-f]{32})/.exec((await b.get(`/launch/w/${id}/storefront`)).text)![1]!;
    const early = (await b.get(`/launch/p/${previewId}`)).text;
    expect(early).toContain("Not yet rehearsed");
    expect(early).not.toContain("trust-badge");
    const rules = await b.get(`/launch/p/${previewId}/how-we-work`);
    expect(rules.status).toBe(200);
    expect(rules.text).toContain("has not been rehearsed yet");
    expect(rules.text).not.toContain('href="/how-we-work"');

    await clearEverything(b, id);
    const run = (await b.get(`/launch/w/${id}/rehearse`)).text;
    const checks = /(\d+) technical checks and (\d+) customer tests were run/.exec(run)!;
    const done = (await b.get(`/launch/p/${previewId}`)).text;
    expect(done).toContain(`Rehearsed · ${Number(checks[1]) + Number(checks[2])} checks`);
    expect(done).not.toContain("Not yet rehearsed");
    expect((await b.get(`/launch/p/${previewId}/how-we-work`)).text).toContain("Its rules passed");
    expect((await b.get(`/launch/p/${"0".repeat(32)}/how-we-work`)).status).toBe(404);
  });
});
