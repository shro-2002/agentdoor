import { afterEach, describe, expect, it } from "vitest";
import { verifyLaunchRecord, type SignedLaunchRecord } from "@agentdoor/core";
import { mysqlSpendGuard, BudgetError } from "../../src/workspace/budget.js";
import { createWorkspaceClient } from "../../src/workspace/claude.js";
import { LIMITS, loadWorkspaceConfig } from "../../src/workspace/config.js";
import { createDraft, getDraft, updateState } from "../../src/workspace/store.js";
import { mentionsBakedGoods } from "../../src/workspace/scope.js";
import { emptyState } from "../../src/workspace/state.js";
import { BENGALURU, DELHI } from "../support/fake-claude.js";
import { CODE, clearEverything, settle, startWorkspaceShop, type WsShop } from "./workspace-helpers.js";

let shop: WsShop | null = null;
afterEach(async () => {
  await shop?.close();
  shop = null;
});

const draftCount = async (s: WsShop): Promise<number> => Number(((await s.pool.query("SELECT COUNT(*) AS n FROM ws_drafts"))[0] as { n: number }[])[0]!.n);
const forIp = (n: number) => ({ "x-forwarded-for": `198.51.100.${n}` });

describe("access", () => {
  it("creating a draft needs the access code; a wrong one makes no draft and no model call", async () => {
    shop = await startWorkspaceShop();
    const b = shop.browser();
    const wrong = await b.post("/launch", { description: BENGALURU, code: "nope" });
    expect(wrong.status).toBe(403);
    const none = await b.post("/launch", { description: BENGALURU, code: "" });
    expect(none.status).toBe(403);
    expect(await draftCount(shop)).toBe(0);
    expect(shop.fake.calls).toHaveLength(0);
    const ok = await b.post("/launch", { description: BENGALURU, code: CODE });
    expect(ok.status).toBe(303);
    const cookie = ok.headers.getSetCookie().find((c) => c.startsWith("ad_ws="))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Secure/i);
  });

  it("without WORKSPACE_ACCESS_CODE the workspace is closed and nothing can start", async () => {
    shop = await startWorkspaceShop({ code: null });
    const b = shop.browser();
    expect((await b.get("/launch")).text).toContain("Workspace is closed");
    expect((await b.post("/launch", { description: BENGALURU, code: CODE })).status).toBe(503);
    expect(await draftCount(shop)).toBe(0);
    expect(shop.fake.calls).toHaveLength(0);
  });

  it("wrong codes are rate-limited per address, and the limit holds even for the right code", async () => {
    shop = await startWorkspaceShop();
    const b = shop.browser();
    for (let i = 0; i < LIMITS.wrongCodesPerIpPerHour; i += 1) expect((await b.post("/launch", { description: BENGALURU, code: `x${i}` }, forIp(1))).status).toBe(403);
    expect((await b.post("/launch", { description: BENGALURU, code: "again" }, forIp(1))).status).toBe(429);
    expect((await b.post("/launch", { description: BENGALURU, code: CODE }, forIp(1))).status).toBe(429);
    expect(await draftCount(shop)).toBe(0);
  });

  it("draft creation is limited per address per hour", async () => {
    shop = await startWorkspaceShop();
    const b = shop.browser();
    for (let i = 0; i < LIMITS.draftsPerIpPerHour; i += 1) expect((await b.post("/launch", { description: DELHI, code: CODE }, forIp(2))).status).toBe(303);
    expect((await b.post("/launch", { description: DELHI, code: CODE }, forIp(2))).status).toBe(429);
    await shop.jobs.idle();
  });

  it("the description is length-limited and validated", async () => {
    shop = await startWorkspaceShop();
    const b = shop.browser();
    expect((await b.post("/launch", { description: "x".repeat(LIMITS.maxDescriptionChars + 1), code: CODE })).status).toBe(400);
    expect((await b.post("/launch", { description: "short", code: CODE })).status).toBe(400);
  });

  it("a business that is not a bakery is turned away before any draft or Claude call", async () => {
    shop = await startWorkspaceShop();
    const b = shop.browser();
    const tailor = "I am a tailor in Jaipur. I stitch blouses for Rs 450 a piece and do saree fall for Rs 150. Closed Tuesday.";
    const res = await b.post("/launch", { description: tailor, code: CODE });
    expect(res.status).toBe(422);
    expect(res.text).toContain("early access is for home bakeries");
    expect(res.text).toContain("I am a tailor in Jaipur");
    expect(shop.fake.calls).toHaveLength(0);
    expect((await b.post("/launch", { description: BENGALURU, code: CODE })).status).toBe(303);
    await shop.jobs.idle();
  });
});

describe("bakery scope (mentionsBakedGoods)", () => {
  it.each([
    "Main ghar par cakes aur cupcakes banati hoon, Pune mein.",
    "मैं लखनऊ में घर से केक और कुकीज़ बनाती हूँ।",
    "Fresh sourdough loaves and pav buns from my kitchen in Goa.",
    "I bake apple pie and lemon tarts to order.",
    "Home baker in Kochi, plum cake for Christmas.",
  ])("lets a bakery through: %s", (text) => expect(mentionsBakedGoods(text)).toBe(true));

  it.each([
    "I am a tailor. Blouse stitching ₹450 per piece, start date flexible.",
    "Beauty salon in Indore: threading ₹50, facial ₹800.",
    "Maths tuition for class 10, ₹2000 a month.",
  ])("turns away another kind of business: %s", (text) => expect(mentionsBakedGoods(text)).toBe(false));
});

describe("isolation", () => {
  it("only the creating browser can read or edit a draft; a preview is read-only for everyone", async () => {
    shop = await startWorkspaceShop();
    const a = shop.browser();
    const idA = await a.create(BENGALURU);
    await settle(a, shop, idA);
    const other = shop.browser();
    const idB = await other.create(DELHI);
    await settle(other, shop, idB);

    // Browser B cannot see A's draft by its id, nor edit it.
    expect((await other.get(`/launch/w/${idA}/rules`)).status).toBe(404);
    expect((await other.post(`/launch/w/${idA}/approve-stated`, { next: "rules" })).status).toBe(404);
    expect((await shop.browser().get(`/launch/w/${idA}`)).status).toBe(404);
    // A forged or tampered cookie opens nothing.
    const forger = shop.browser();
    forger.setCookie("ad_ws", Buffer.from(JSON.stringify({ ids: [idA], iat: Date.now() })).toString("base64url") + ".AAAA");
    expect((await forger.get(`/launch/w/${idA}`)).status).toBe(404);
    // A's draft is untouched by B's attempts.
    expect((await getDraft(shop.pool, idA))!.version).toBeGreaterThan(0);

    // Preview: a separate random id, readable without any cookie, never editable.
    await a.post(`/launch/w/${idA}/preview`);
    const row = (await getDraft(shop.pool, idA))!;
    expect(row.previewId).toMatch(/^[0-9a-f]{32}$/);
    expect(row.previewId).not.toBe(idA);
    const anon = shop.browser();
    const view = await anon.get(`/launch/p/${row.previewId}`);
    expect(view.status).toBe(200);
    expect(view.text).toContain("Cocoa &amp; Co");
    expect((await anon.post(`/launch/p/${row.previewId}`, { x: "1" })).status).toBe(404);
    expect((await anon.get(`/launch/w/${row.previewId}`)).status).toBe(404);
    expect((await anon.get(`/launch/p/${idA}`)).status).toBe(404);
  });

  it("the preview is the bakery storefront with a Preview banner and ordering switched off", async () => {
    shop = await startWorkspaceShop();
    const a = shop.browser();
    const id = await a.create(DELHI);
    await settle(a, shop, id);
    await a.post(`/launch/w/${id}/preview`);
    const previewId = (await getDraft(shop.pool, id))!.previewId!;
    const page = (await shop.browser().get(`/launch/p/${previewId}`)).text;
    expect(page).toContain("/assets/bakery.css");
    expect(page).toContain("Preview: orders are off");
    expect(page).toContain('class="pvbar"');
    expect(page).not.toMatch(/href="\/order/);
    expect(page).not.toMatch(/href="\/contact/);
    expect(page).not.toMatch(/href="\/#/);
    expect(page).toContain("is-off");
    expect(page).toContain("Assorted cookie box");
    expect(page).toContain("cookie-box.jpg"); // photo mapped by product kind
    expect(page).toContain("brownies.jpg");
    expect(page).toContain('name="robots" content="noindex"');
    expect(page).not.toContain("Illustrative persona");
    expect(page).not.toMatch(/<script(?![^>]*src=)/);
  });
});

describe("budget", () => {
  it("reserves before a call and settles the real cost; the cap refuses further reservations", async () => {
    shop = await startWorkspaceShop();
    const id = "d".repeat(32);
    await createDraft(shop.pool, id, "ip", emptyState("x"));
    const guard = mysqlSpendGuard(shop.pool, { budgetMicro: 1_000_000, draftCapMicro: 600_000 });
    const first = await guard.reserve(id, 0.3);
    const snap = async () => ((await shop!.pool.query("SELECT spent_micro, reserved_micro FROM ws_budget"))[0] as { spent_micro: number; reserved_micro: number }[])[0]!;
    expect(await snap()).toMatchObject({ reserved_micro: 300_000, spent_micro: 0 });
    await first.settle(0.1);
    expect(await snap()).toMatchObject({ reserved_micro: 0, spent_micro: 100_000 });
    await first.settle(5); // settling twice changes nothing
    expect(await snap()).toMatchObject({ spent_micro: 100_000 });
    const second = await guard.reserve(id, 0.45);
    await expect(guard.reserve(id, 0.1)).rejects.toMatchObject({ scope: "draft" }); // 0.1 spent + 0.45 held + 0.1 > 0.6
    await second.settle(0);
  });

  it("two jobs racing for the last dollars cannot both win", async () => {
    shop = await startWorkspaceShop();
    const ids = ["a".repeat(32), "b".repeat(32)];
    for (const id of ids) await createDraft(shop.pool, id, "ip", emptyState("x"));
    const guard = mysqlSpendGuard(shop.pool, { budgetMicro: 1_000_000, draftCapMicro: 900_000 });
    const results = await Promise.allSettled(ids.map((id) => guard.reserve(id, 0.6)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(BudgetError);
    expect((lost.reason as BudgetError).scope).toBe("global");
  });

  it("when the global budget is gone the job fails without a model call, and it is not retryable", async () => {
    shop = await startWorkspaceShop({ budgetUsd: 0.001 });
    const b = shop.browser();
    const id = await b.create(BENGALURU);
    const job = await settle(b, shop, id);
    expect(job.status).toBe("failed");
    expect(job.error).toMatchObject({ code: "BUDGET_GLOBAL", retryable: false });
    expect(shop.fake.calls).toHaveLength(0);
    const page = (await b.get(`/launch/w/${id}/setup`)).text;
    expect(page).toContain("AI limit");
  });

  it("the per-draft cap is enforced on its own", async () => {
    shop = await startWorkspaceShop({ draftCapUsd: 0.001 });
    const b = shop.browser();
    const id = await b.create(BENGALURU);
    expect((await settle(b, shop, id)).error).toMatchObject({ code: "BUDGET_DRAFT", retryable: false });
    expect(shop.fake.calls).toHaveLength(0);
  });
});

/** Puts answers on the draft, as the question screens do. */
async function answer(s: WsShop, id: string): Promise<void> {
  await updateState(s.pool, id, (st) => {
    st.questions = [{ id: "q1", path: "orderRules.customRequests", text: "If a customer asks for a custom design, should the shop refuse or ask you first?", choices: [] }];
    st.answers = { q1: "Ask me first" };
  });
}

describe("rounds", () => {
  it("allows 3 compile or clarify rounds and 2 scenario runs per draft, then says so", async () => {
    shop = await startWorkspaceShop();
    const b = shop.browser();
    const id = await b.create(BENGALURU);
    await settle(b, shop, id);
    for (let round = 2; round <= LIMITS.maxCompileRounds; round += 1) {
      await answer(shop, id);
      const r = await shop.jobs.start(id, "clarify");
      expect(r.ok).toBe(true);
      await shop.jobs.idle();
    }
    await answer(shop, id);
    expect(await shop.jobs.start(id, "clarify")).toMatchObject({ ok: false, reason: "NO_ROUNDS" });
    expect((await getDraft(shop.pool, id))!.compileRounds).toBe(LIMITS.maxCompileRounds);
    // The last round must not ask more questions.
    expect(shop.fake.calls.at(-1)!.user).toContain("Final round");

    for (let i = 0; i < LIMITS.maxScenarioRuns; i += 1) {
      expect((await shop.jobs.start(id, "rehearse", { regenerate: true })).ok).toBe(true);
      await shop.jobs.idle();
    }
    expect(await shop.jobs.start(id, "rehearse", { regenerate: true })).toMatchObject({ ok: false, reason: "NO_ROUNDS" });
    // The free deterministic checks still work with no rounds left.
    expect((await b.post(`/launch/w/${id}/rehearse`, { mode: "recheck" })).status).toBe(303);
    expect((await getDraft(shop.pool, id))!.state.run).not.toBeNull();
  });

  it("only one job runs per draft at a time", async () => {
    shop = await startWorkspaceShop();
    const b = shop.browser();
    const id = await b.create(BENGALURU);
    const again = await shop.jobs.start(id, "compile");
    expect(again.ok).toBe(false);
    await shop.jobs.idle();
  });
});

describe("failures", () => {
  it("an outage is a clear, retryable error; nothing is answered from recorded fixtures; the retry works", async () => {
    let down = true;
    shop = await startWorkspaceShop({ fail: () => (down ? Object.assign(new Error("secret-detail-xyz"), { status: 529 }) : null) });
    const b = shop.browser();
    const id = await b.create(BENGALURU);
    const job = await settle(b, shop, id);
    expect(job.status).toBe("failed");
    expect(job.error).toMatchObject({ code: "CLAUDE_UNAVAILABLE", retryable: true });
    expect(job.error!.message).not.toContain("secret-detail");
    const page = (await b.get(`/launch/w/${id}/setup`)).text;
    expect(page).toContain("Claude could not be reached");
    expect(page).toContain("Retry");
    expect(page).not.toContain("secret-detail");
    const row = (await getDraft(shop.pool, id))!;
    expect(row.state.policy).toBeNull(); // no fallback business was invented
    expect(row.compileRounds).toBe(0); // the failed round was given back

    down = false;
    await b.post(`/launch/w/${id}/retry`, {});
    expect(await settle(b, shop, id)).toMatchObject({ kind: "compile", status: "done" });
    expect((await getDraft(shop.pool, id))!.state.policy).not.toBeNull();
  });

  it("a missing key is reported as retryable and no model is reached", async () => {
    shop = await startWorkspaceShop({ apiKey: null, withSdk: false });
    const b = shop.browser();
    const id = await b.create(BENGALURU);
    expect((await settle(b, shop, id)).error).toMatchObject({ code: "NO_API_KEY", retryable: true });
    expect(shop.fake.calls).toHaveLength(0);
  });

  it("the production client is live-only (it has no replay or fixture mode)", async () => {
    shop = await startWorkspaceShop();
    const client = createWorkspaceClient(shop.pool, loadWorkspaceConfig({ ANTHROPIC_API_KEY: "k", WORKSPACE_ACCESS_CODE: "c" }));
    expect(client.mode).toBe("live");
    process.env.AGENTDOOR_LLM_MODE = "replay";
    try {
      expect(createWorkspaceClient(shop.pool, loadWorkspaceConfig({ ANTHROPIC_API_KEY: "k" })).mode).toBe("live");
    } finally {
      delete process.env.AGENTDOOR_LLM_MODE;
    }
  });

  it("a job stuck past 3 minutes, or one whose process stopped beating, becomes failed and retryable", async () => {
    shop = await startWorkspaceShop();
    const b = shop.browser();
    const id = await b.create(BENGALURU);
    await settle(b, shop, id);
    const old = shop.clock2.now - LIMITS.jobTimeoutMs - 1000;
    const jobId = "c".repeat(32);
    await shop.pool.query("INSERT INTO ws_jobs (id, draft_id, kind, status, created_ms, heartbeat_ms) VALUES (?, ?, 'rehearse', 'running', ?, ?)", [jobId, id, old, shop.clock2.now]);
    let status = (await b.get(`/launch/w/${id}/jobs/${jobId}.json`)).text;
    expect(JSON.parse(status)).toMatchObject({ status: "failed", error: { code: "TIMED_OUT", retryable: true } });

    const jobId2 = "e".repeat(32);
    await shop.pool.query("INSERT INTO ws_jobs (id, draft_id, kind, status, created_ms, heartbeat_ms) VALUES (?, ?, 'rehearse', 'running', ?, ?)", [jobId2, id, shop.clock2.now, shop.clock2.now - LIMITS.heartbeatStaleMs - 1000]);
    status = (await b.get(`/launch/w/${id}/jobs/${jobId2}.json`)).text;
    expect(JSON.parse(status)).toMatchObject({ status: "failed", error: { code: "INTERRUPTED", retryable: true } });
  });
});

describe("publishing", () => {
  async function ready(s: WsShop) {
    const b = s.browser();
    const id = await b.create(DELHI);
    await settle(b, s, id);
    await b.post(`/launch/w/${id}/setup/skip`);
    await b.post(`/launch/w/${id}/rehearse`, { mode: "full" });
    await settle(b, s, id);
    return { b, id };
  }

  it("the gate keeps publishing locked while gaps, approvals or mismatches remain", async () => {
    shop = await startWorkspaceShop();
    const { b, id } = await ready(shop);
    const page = (await b.get(`/launch/w/${id}/rehearse`)).text;
    expect(page).toContain("Publishing is locked");
    const store = (await b.get(`/launch/w/${id}/storefront`)).text;
    expect(store).toContain("Locked.");
    expect(store).not.toContain("Prepare for publishing");
    await b.signInOwner();
    const r = await b.post(`/launch/w/${id}/prepare`);
    expect(r.status).toBe(303);
    const rows = (await shop.pool.query("SELECT COUNT(*) AS n FROM ws_publish"))[0] as { n: number }[];
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it("only the signed-in shop owner can prepare publishing or download the package", async () => {
    shop = await startWorkspaceShop();
    const { b, id } = await ready(shop);
    expect((await b.post(`/launch/w/${id}/prepare`)).status).toBe(403);
    expect((await b.get(`/launch/w/${id}/package.json`)).status).toBe(403);
    const anon = shop.browser();
    expect((await anon.post(`/launch/w/${id}/prepare`)).status).toBe(404); // not even the draft's own browser
    const page = (await b.get(`/launch/w/${id}/storefront`)).text;
    expect(page).not.toContain("Prepare for publishing");
  });

  it("once everything is cleared it unlocks; a non-owner is still refused; the owner gets a signed package", async () => {
    shop = await startWorkspaceShop();
    const { b, id } = await ready(shop);
    await clearEverything(b, id);
    const store = (await b.get(`/launch/w/${id}/storefront`)).text;
    expect(store).toContain("Publishing to your own domain needs the owner");
    expect(store).not.toContain("Prepare for publishing");
    expect((await b.post(`/launch/w/${id}/prepare`)).status).toBe(403);
    expect(Number(((await shop.pool.query("SELECT COUNT(*) AS n FROM ws_publish"))[0] as { n: number }[])[0]!.n)).toBe(0);

    await b.signInOwner();
    expect((await b.get(`/launch/w/${id}/storefront`)).text).toContain("Prepare for publishing");
    expect((await b.post(`/launch/w/${id}/prepare`)).status).toBe(303);
    const pkg = JSON.parse((await b.get(`/launch/w/${id}/package.json`)).text) as { policy: { business: { name: string } }; launchRecord: SignedLaunchRecord };
    expect(pkg.policy.business.name).toBe("Sweet Crumbs");
    expect(pkg.launchRecord.record.shop).toBe("sweet-crumbs");
    expect(pkg.launchRecord.record.rehearsal.criticalOpen).toBe(0);
    expect(pkg.launchRecord.record.approvals.approved).toBe(pkg.launchRecord.record.approvals.required);
    // Signed with the shop's own key, so the existing launch check accepts it.
    expect(verifyLaunchRecord(pkg.launchRecord, pkg.launchRecord.record.publicKey)).toBe(true);
  });
});
