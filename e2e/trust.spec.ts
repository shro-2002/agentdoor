import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { SHOP, seriousViolations } from "./shop-helpers.js";

/**
 * The Rehearsed badge on the live storefront and the plain-language rules page. The numbers are read back
 * from the signed launch record the shop was started with, so nothing here is typed in by hand.
 */
test.use({ reducedMotion: "reduce" });

const OUT = path.resolve("docs/screens");
const SIZES = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];

function signedChecks(): { checks: number; hash: string } {
  const file = JSON.parse(readFileSync(path.join(process.env.SHOP_BUNDLE_DIR ?? "", "launch-record.json"), "utf8")) as { record: { policyHash: string; rehearsal: { probes: number; scenarios: number } } };
  return { checks: file.record.rehearsal.probes + file.record.rehearsal.scenarios, hash: file.record.policyHash };
}

for (const size of SIZES) {
  test.describe(`at ${size.width}px`, () => {
    test.use({ viewport: size });

    test("the badge sits in the hero and leads to the rules page", async ({ page }) => {
      const { checks } = signedChecks();
      await page.goto(`${SHOP()}/`);
      const badge = page.getByRole("link", { name: `Rehearsed before launch · ${checks} checks · rules approved by the owner` });
      await expect(badge).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
      await page.screenshot({ path: path.join(OUT, `v5-storefront-badge-${size.width}.png`) });
      await badge.click();
      await expect(page).toHaveURL(/\/how-we-work$/);
      await expect(page.getByRole("heading", { level: 1, name: "The rules this shop follows" })).toBeVisible();
    });

    test("/how-we-work shows the rules, the owner's words and the verified fingerprint", async ({ page }) => {
      const { checks, hash } = signedChecks();
      await page.goto(`${SHOP()}/how-we-work`);
      for (const heading of ["Prices", "Delivery and pickup", "Notice and rush orders", "Daily limit, closed days and cancellation", "Verified"]) await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expect(page.locator(".rule-line__quote").first()).toContainText("“");
      await expect(page.locator(".verified")).toContainText(hash.slice(0, 12));
      await expect(page.locator(".verified")).toContainText(`rehearsed with ${checks} checks`);
      await expect(page.getByRole("link", { name: "How we work" })).toBeVisible(); // the footer link
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      expect(await seriousViolations(page)).toEqual([]);
      await page.screenshot({ path: path.join(OUT, `v5-how-we-work-${size.width}.png`), fullPage: true });
    });
  });
}

test("/.well-known/agentdoor.json says the rules are rehearsed and signed", async ({ request }) => {
  const { checks, hash } = signedChecks();
  const doc = (await (await request.get(`${SHOP()}/.well-known/agentdoor.json`)).json()) as { policyHash: string; rehearsal: Record<string, unknown> };
  expect(doc.policyHash).toBe(hash);
  expect(doc.rehearsal).toMatchObject({ rehearsedBeforeLaunch: true, checks, signatureVerifiedAtStartup: true, rulesUrl: "/how-we-work" });
});
