import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { OWNER_TOKEN, seriousViolations } from "./shop-helpers.js";
import { BENGALURU, DELHI } from "../apps/shop/test/support/fake-claude.js";

/**
 * The whole workspace journey against a fake Claude (a local server the real SDK talks to), for two
 * different bakeries. Every screen is checked with axe at both widths and saved to docs/screens.
 */
const WS = (): string => process.env.SHOP_WS_URL ?? "";
const CODE = (): string => process.env.SHOP_WS_CODE ?? "";
const OUT = path.resolve("docs/screens");
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 375, height: 812 };
const WORKING_TIMEOUT = 45_000;

test.use({ reducedMotion: "reduce" });

/** Axe at the current width, a sideways-scroll check, then a screenshot at both widths. */
async function shoot(page: Page, name: string, opts: { axe?: boolean } = {}): Promise<void> {
  const original = page.viewportSize() ?? DESKTOP;
  for (const size of [DESKTOP, PHONE]) {
    await page.setViewportSize(size);
    await page.evaluate(async () => {
      const imgs = [...document.images];
      imgs.forEach((i) => (i.loading = "eager"));
      await Promise.all(imgs.map((i) => i.decode().catch(() => undefined)));
    });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const wide = overflow > 0 ? await page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5).slice(0, 4).map((e) => `${e.tagName}.${e.className}`)) : [];
    expect(overflow, `${name} scrolls sideways at ${size.width}px: ${wide.join(" | ")}`).toBeLessThanOrEqual(0);
    if (opts.axe !== false) expect(await seriousViolations(page), `${name} at ${size.width}px`).toEqual([]);
    await page.screenshot({ path: path.join(OUT, `v3-${name}-${size.width}.png`), fullPage: true });
  }
  await page.setViewportSize(original);
}

async function start(page: Page, description: string): Promise<string> {
  await page.goto(`${WS()}/launch`);
  await expect(page.getByRole("heading", { level: 1, name: "What business are you dreaming of?" })).toBeVisible();
  await page.getByLabel("Describe your business").fill(description);
  await page.getByLabel("Access code").fill(CODE());
  await page.getByRole("button", { name: "Create my business" }).click();
  await expect(page).toHaveURL(/\/launch\/w\/[0-9a-f]{32}\/setup$/);
  return page.url().replace(/\/setup$/, "");
}

/** Answers every question (a chip when it has chips, else typed text) until setup is complete. */
async function answerAll(page: Page, typed: Record<string, string>): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    const done = page.getByText("Setup complete");
    const question = page.getByText(/^Question \d+ of \d+$/);
    await expect(done.or(question)).toBeVisible({ timeout: WORKING_TIMEOUT });
    if (await done.isVisible()) return;
    const text = (await page.locator(".question__text").textContent()) ?? "";
    if (await page.locator("input[type=radio]").count()) {
      await page.locator(".chip").first().click();
    } else {
      const key = Object.keys(typed).find((k) => text.includes(k)) ?? "";
      await page.getByLabel("Your answer").fill(typed[key] ?? "none");
      await page.getByRole("button", { name: "Continue" }).click();
    }
  }
  throw new Error("setup did not finish");
}

/** Clears every open item the way an owner would: approve, set a limit, or accept the shop's answer. */
async function resolveEverything(page: Page, base: string): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    await page.goto(`${base}/rehearse`);
    if (await page.getByText("Publishing is unlocked").isVisible()) return;
    const bulk = page.getByRole("button", { name: /^Approve all I stated/ }).first();
    if (await bulk.isVisible()) {
      await bulk.click();
      continue;
    }
    const approve = page.locator(".rules .btn", { hasText: "Approve" }).first();
    if (await approve.isVisible()) {
      await approve.click();
      continue;
    }
    const card = page.locator(".issue").first();
    if (await card.isVisible()) {
      const limit = card.locator("input[name=value]");
      const accept = card.getByRole("button", { name: "Accept the shop's answer" });
      if (await accept.count()) {
        await accept.click();
      } else if (await limit.count()) {
        await limit.fill("3");
        await card.getByRole("button", { name: "Set limit" }).click();
      } else {
        await card.locator(".issue__fix .btn").first().click();
      }
      continue;
    }
    await page.getByRole("button", { name: "Run checks again" }).click();
  }
  throw new Error("could not clear the rehearsal");
}

const cases = [
  { key: "bengaluru", description: BENGALURU, shop: "Cocoa & Co", typed: { "minimum order": "₹500" }, name: "", firstProduct: "Chocolate truffle cake" },
  { key: "delhi", description: DELHI, shop: "Sweet Crumbs", typed: { "minimum order": "₹300" }, name: "-delhi", firstProduct: "Assorted cookie box" },
];

for (const c of cases) {
  test(`workspace journey: ${c.key}`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(DESKTOP);

    // 1. Start
    await page.goto(`${WS()}/launch`);
    await expect(page.getByRole("link", { name: "Launch report" })).toHaveAttribute("href", "/launch-report");
    await expect(page.getByRole("link", { name: "Recorded walk-through" })).toHaveAttribute("href", "/try");
    if (c.name === "") await shoot(page, "start");

    // 2. Setup: live compile (working state), questions, answers
    const base = await start(page, c.description);
    await expect(page.getByText("Reading your description")).toBeVisible();
    if (c.name === "") await shoot(page, "working");
    await expect(page.getByText(/^Question 1 of \d$/)).toBeVisible({ timeout: WORKING_TIMEOUT });
    await expect(page.getByText("Your business so far")).toBeVisible();
    await expect(page.locator(".summary")).toContainText(c.shop);
    await shoot(page, `setup-question${c.name}`);
    await answerAll(page, c.typed);
    await expect(page.getByText("Setup complete")).toBeVisible();
    await shoot(page, `setup-done${c.name}`);

    // 3. Products: edit a price, it is validated and saved as exact paise
    await page.goto(`${base}/products`);
    await expect(page.getByRole("heading", { name: c.firstProduct })).toBeVisible();
    await page.locator("details.edit summary", { hasText: "Edit product" }).first().click();
    await page.locator("input[name=price]").first().fill("999.50");
    await page.getByRole("button", { name: "Save" }).first().click();
    await expect(page.getByText("Product saved.")).toBeVisible();
    await expect(page.locator(".product").first()).toContainText("₹999.50");
    await page.locator("details.edit summary", { hasText: "Edit product" }).first().click();
    await page.locator("input[name=price]").first().fill("-4");
    await page.getByRole("button", { name: "Save" }).first().click();
    await expect(page.getByText(/price must be an amount in rupees/i)).toBeVisible();
    await shoot(page, `products${c.name}`);

    // 4. Rules: owner's own words and suggestions, then approve what was stated
    await page.goto(`${base}/rules`);
    await expect(page.getByText("You said:").first()).toBeVisible();
    await expect(page.getByText("Suggested by AgentDoor").first()).toBeVisible();
    await shoot(page, `rules${c.name}`);
    await page.getByRole("button", { name: /^Approve all I stated/ }).click();
    await expect(page.getByText(/Approved \d+ rules? you stated/)).toBeVisible();

    // 5. Rehearse: four separate categories, issue cards with controls and evidence
    await page.goto(`${base}/rehearse`);
    await page.getByRole("button", { name: "Run rehearsal" }).click();
    await expect(page.getByText("Rehearsing with customers")).toBeVisible();
    await expect(page.getByText("Business-policy gaps").first()).toBeVisible({ timeout: WORKING_TIMEOUT });
    for (const label of ["Business-policy gaps", "Pending approvals", "Scenario mismatches", "Engine failures"]) await expect(page.locator(".tiles")).toContainText(label);
    await expect(page.getByText("Publishing is locked")).toBeVisible();
    await expect(page.locator(".issue").first()).toBeVisible();
    await expect(page.locator(".issue summary", { hasText: "Show evidence" }).first()).toBeVisible();
    await shoot(page, `rehearse${c.name}`);

    // 6. Storefront: publishing is locked until everything is cleared
    await page.goto(`${base}/storefront`);
    await expect(page.getByText("Locked.")).toBeVisible();
    await resolveEverything(page, base);
    await shoot(page, `rehearse-clear${c.name}`);

    // 7. Preview: the same bakery storefront, a banner, ordering off
    await page.goto(`${base}/storefront`);
    await expect(page.getByText("Publishing needs the owner's authorization")).toBeVisible();
    await page.getByRole("button", { name: "Preview your storefront" }).click();
    await expect(page.getByLabel("Preview link")).toHaveValue(/\/launch\/p\/[0-9a-f]{32}$/);
    await shoot(page, `storefront${c.name}`);
    await page.getByRole("link", { name: "Open preview" }).first().click();
    await expect(page.getByRole("status").filter({ hasText: "Preview: orders are off" })).toBeVisible();
    await expect(page.locator(".hero__title")).toBeVisible();
    await expect(page.locator('a[href^="/order"]')).toHaveCount(0);
    await expect(page.locator(".pcard").first()).toBeVisible();
    await shoot(page, `preview${c.name}`);

    // 8. Publishing: only the signed-in owner may prepare it
    await page.goto(`${base}/storefront`);
    await expect(page.getByRole("button", { name: "Prepare for publishing" })).toHaveCount(0);
    await page.goto(`${WS()}/owner/login`);
    await page.getByLabel("Owner token").fill(OWNER_TOKEN);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.goto(`${base}/storefront`);
    await page.getByRole("button", { name: "Prepare for publishing" }).click();
    await expect(page.getByText("Package prepared.").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Download package" })).toBeVisible();
    await shoot(page, `publish${c.name}`);
  });
}
