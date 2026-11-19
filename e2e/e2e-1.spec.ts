import { expect, test } from "@playwright/test";
import { describeDemo, fixOpenGaps, watchConsole } from "./helpers.js";

/** E2E-1 (fixture mode, real server): describe -> questions -> rules -> rehearsal -> fixes -> gate unlocked -> launch. */
test("E2E-1: from the owner's words to an unlocked door", async ({ page }) => {
  const problems = watchConsole(page);

  // L1 -> questions -> L2
  await describeDemo(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Your rules, in your words/);
  await expect(page.locator("article.rule").first()).toBeVisible();
  await expect(page.getByText("You said:").first()).toBeVisible();
  await page.getByRole("button", { name: "Approve all high-confidence" }).click();
  await expect(page.locator("#approved-count")).toContainText("approved");
  await page.getByRole("link", { name: "Rehearse my shop" }).click();

  // L3: the leaky policy prints GAP lines and the door stays locked
  await expect(page).toHaveURL(/\/rehearsal$/);
  await expect(page.locator("#receipt")).toBeVisible();
  expect(await page.locator("#receipt .line--gap").count()).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole("heading", { name: "Orders have no real daily limit" })).toBeVisible();
  await expect(page.locator(".door.is-locked")).toBeVisible();
  await expect(page.locator("#go-launch")).toHaveCount(0);

  // fixes -> run again, until the gate opens
  for (let round = 0; round < 6; round++) {
    await fixOpenGaps(page);
    await page.locator("#run-again").click();
    await expect(page.locator("#receipt")).toBeVisible();
    if ((await page.locator("#go-launch").count()) > 0 || (await page.locator(".door.is-open").count()) > 0) break;
    await page.waitForTimeout(300);
  }
  await expect(page.locator(".door.is-open")).toBeVisible();
  await expect(page.locator(".banner--clean")).toBeVisible();
  await expect(page.locator("#receipt .line--gap")).toHaveCount(0);

  // L4: the door is open, the stubbed launch emits every step
  await page.getByRole("link", { name: "Go to launch" }).click();
  await expect(page).toHaveURL(/\/launch$/);
  await expect(page.locator(".door.is-open")).toBeVisible();
  await page.getByRole("button", { name: "Launch my shop" }).click();
  await expect(page.locator(".banner--clean")).toContainText("every step is done");
  for (const step of ["pack", "upload", "secrets", "publish", "domain", "smoke"]) await expect(page.locator(`li[data-step="${step}"].step--done`)).toBeVisible();

  expect(problems).toEqual([]);
});

test("the launcher only answers on loopback and sends a strict CSP", async ({ page, request }) => {
  const res = await page.goto("/");
  expect(res!.headers()["content-security-policy"]).toContain("script-src 'self'");
  expect((await request.get("/api/status", { headers: { host: "evil.example:80" } })).status()).toBe(421);
  expect(((await (await request.get("/api/status")).json()).data as { mode: string }).mode).toBe("replay");
});
