/**
 * A small live check of the /launch workspace against the real Claude API: two drafts, each through
 * compile, one clarify round and one rehearsal. The key is loaded into the environment by the
 * launcher's own loader (never read into a variable, printed or logged). Run: npx tsx scripts/workspace-smoke.ts
 */
import { loadRuntimeEnv } from "../apps/launcher/src/claude/env.js";
import { loadWorkspaceConfig } from "../apps/shop/src/workspace/config.js";
import { getDraft } from "../apps/shop/src/workspace/store.js";
import { Browser, settle } from "../apps/shop/test/integration/workspace-helpers.js";
import { startShop } from "../apps/shop/test/integration/http-helpers.js";
import type { WorkspaceJobs } from "../apps/shop/src/workspace/jobs.js";

const CODE = "smoke-code";
const BUDGET_USD = 1.4;

const DESCRIPTIONS = [
  "I make millet and jaggery laddoos and sugar-free energy bars at home in Jaipur. A laddoo box of 12 is ₹420 and an energy bar pack of 6 is ₹300. I deliver to Malviya Nagar and Vaishali Nagar for ₹40, and pickup is fine too. I need 2 days notice, can do about 15 boxes a day, and I am closed on Sundays.",
  "Main ghar se Pune mein cupcakes aur tea-time cakes banati hoon. Vanilla cupcake box (6 ka) ₹360 ka hai, banana walnut loaf ₹450 ek. Delivery sirf Kothrud aur Karve Nagar mein hoti hai, ₹50 charge. 2 din pehle bata dena padta hai, ek din mein 8 orders tak kar sakti hoon. Mangalwar ko chutti rehti hai.",
];

async function main(): Promise<void> {
  if (!loadRuntimeEnv()) throw new Error("no ANTHROPIC_API_KEY available (put it in .env.local)");
  const workspace = loadWorkspaceConfig({ ...process.env, WORKSPACE_ACCESS_CODE: CODE, WORKSPACE_BUDGET_USD: String(BUDGET_USD) });
  const shop = await startShop({ workspace, now: () => Date.now() });
  const jobs = shop.app.locals.workspaceJobs as WorkspaceJobs;
  const fake = { jobs, pool: shop.pool } as never;
  try {
    for (const [i, description] of DESCRIPTIONS.entries()) {
      if (process.argv[2] && Number(process.argv[2]) !== i + 1) continue;
      const b = new Browser(shop.base);
      const t0 = Date.now();
      const id = await b.create(description, CODE);
      const compile = await settle(b, fake, id);
      const tCompile = Date.now() - t0;
      let row = (await getDraft(shop.pool, id))!;
      console.log(`draft ${i + 1}: compile ${compile.status} in ${(tCompile / 1000).toFixed(1)}s${compile.error ? ` (${compile.error.code})` : ""}; questions ${row.state.questions.length}`);
      if (compile.status !== "done") continue;

      const t1 = Date.now();
      for (const q of row.state.questions) {
        await b.post(`/launch/w/${id}/setup/answer`, { questionId: q.id, answer: q.choices[0] ?? "Not sure, please suggest something sensible" });
      }
      const clarify = await settle(b, fake, id);
      console.log(`draft ${i + 1}: clarify ${clarify.status} in ${((Date.now() - t1) / 1000).toFixed(1)}s${clarify.error ? ` (${clarify.error.code})` : ""}`);

      const t2 = Date.now();
      await b.post(`/launch/w/${id}/rehearse`, { mode: "full" });
      const rehearse = await settle(b, fake, id);
      row = (await getDraft(shop.pool, id))!;
      const tiles = [...(await b.get(`/launch/w/${id}/rehearse`)).text.matchAll(/tile__n">([^<]*)</g)].map((m) => m[1]);
      console.log(`draft ${i + 1}: rehearse ${rehearse.status} in ${((Date.now() - t2) / 1000).toFixed(1)}s${rehearse.error ? ` (${rehearse.error.code})` : ""}`);
      console.log(`draft ${i + 1}: categories policy=${tiles[0]} approvals=${tiles[1]} scenarios=${tiles[2]} engine=${tiles[3]}; compile rounds ${row.compileRounds}, scenario runs ${row.scenarioRuns}; spent $${(row.spentMicro / 1e6).toFixed(4)}`);
      for (const c of row.state.calls) console.log(`  ${c.kind}: ${(c.ms / 1000).toFixed(1)}s, in ${c.inputTokens} out ${c.outputTokens} tokens, $${c.costUsd.toFixed(4)}`);
    }
    const [[total]] = (await shop.pool.query("SELECT spent_micro FROM ws_budget")) as unknown as [{ spent_micro: number }[]];
    console.log(`total spent $${(Number(total?.spent_micro ?? 0) / 1e6).toFixed(4)}`);
  } finally {
    await shop.close();
  }
}

main().catch((e: unknown) => {
  console.error("smoke failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
