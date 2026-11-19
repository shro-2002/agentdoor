import { expect, type Page } from "@playwright/test";

const FONT_HOSTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

/** Collects CSP violations and page errors so a spec can assert the pages are clean. */
export function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    // A web font that cannot be fetched (offline test machine) is a network failure, not an app error.
    if (m.type() === "error" && !FONT_HOSTS.test(m.location().url)) problems.push(`console: ${m.text()}`);
  });
  return problems;
}

/** Describe -> questions -> Continue, through the real UI, with the demo bakery. Ends on /rules. */
export async function describeDemo(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Use the demo bakery" }).click();
  await expect(page.locator("#story")).not.toHaveValue("");
  await page.getByRole("button", { name: "Read my rules" }).click();
  await expect(page.getByRole("heading", { name: "A few quick questions" })).toBeVisible();
  for (const group of await page.locator("fieldset.question").all()) await group.locator('input[type="radio"]').first().check({ force: true });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/rules$/);
}

/** Skips the UI steps: a compiled demo session through the API, then lands on `path` (for a11y and screenshots). */
export async function seedSession(page: Page, path: string): Promise<string> {
  await page.goto("/");
  const demo = (await (await page.request.get("/api/demo")).json()).data as { language: string; fixtureKey: string; transcript: string };
  const created = await page.request.post("/api/session", { data: { language: demo.language, transcript: demo.transcript, fixtureKey: demo.fixtureKey } });
  const sid = (await created.json()).data.sessionId as string;
  expect((await page.request.post(`/api/session/${sid}/compile`)).ok()).toBe(true);
  await page.evaluate((id) => localStorage.setItem("agentdoor.session", id), sid);
  await page.goto(path);
  return sid;
}

/** Owner behaviour for the rehearsal: apply the first fix of every open critical gap card (scenario gaps: "that is fine"). */
export async function fixOpenGaps(page: Page): Promise<number> {
  let applied = 0;
  for (;;) {
    const card = page.locator("article.gap--critical").first();
    if ((await card.count()) === 0) return applied;
    const radios = card.locator('input[type="radio"]');
    const scenario = (await card.locator("h3").innerText()).startsWith("A customer case");
    const pick = radios.nth(scenario ? (await radios.count()) - 1 : 0);
    await pick.check({ force: true });
    const number = card.locator("input.choice__value:visible");
    if ((await number.count()) > 0) await number.fill("10");
    const id = await card.getAttribute("id");
    await card.getByRole("button", { name: "Apply fix" }).click();
    await expect(page.locator(`[id="${id}"]`)).toHaveCount(0);
    applied++;
    if (applied > 60) throw new Error("too many fixes");
  }
}
