import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { createPool } from "../apps/shop/src/db/pool.js";
import { dbConfig, OWNER_TOKEN } from "./support/shop.js";

export { OWNER_TOKEN };

/** The in-process shop started by global setup (see e2e/support/global-setup.ts). */
export const SHOP = (): string => process.env.SHOP_URL ?? "";
export const SHOP_NO_SESSION = (): string => process.env.SHOP_NOSESSION_URL ?? "";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export interface Violation {
  id: string;
  impact: string | null | undefined;
  nodes: string[];
}

/** Serious and critical axe violations on the current page (A11Y-2, A11Y-3 need zero). */
export async function seriousViolations(page: Page, exclude: string[] = []): Promise<Violation[]> {
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  for (const selector of exclude) builder.exclude(selector);
  const results = await builder.analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} :: ${n.failureSummary?.split("\n")[1] ?? ""}`) }));
}

/** Row counts of the tables a visitor could write to, to prove a page did not write. */
export async function tableCounts(): Promise<Record<string, number>> {
  const pool = createPool(dbConfig);
  try {
    const out: Record<string, number> = {};
    for (const t of ["orders", "quote_redemptions", "capacity_ledger", "contact_messages", "audit_events"]) {
      const [rows] = await pool.query(`SELECT COUNT(*) AS n FROM ${t}`);
      out[t] = Number((rows as { n: number }[])[0]!.n);
    }
    return out;
  } finally {
    await pool.end();
  }
}

let orderSeq = 0;
const DAYS_PER_WEEK = 7;
const ORDERS_PER_DAY = 2;

/**
 * A date a week or more after the earliest one, spread over several weeks: the earliest day is a rush
 * day with a tiny rush cap, and one day only has room for a few cakes, so tests must not pile onto it.
 * Counted from the picker's `min` (the first day the engine quotes), not its default value, which is
 * the first standard day and can sit several days later.
 */
async function laterDate(page: Page): Promise<string> {
  const earliest = (await page.locator("#date").getAttribute("min")) ?? (await page.locator("#date").inputValue());
  const weeks = 1 + Math.floor(orderSeq++ / ORDERS_PER_DAY);
  const d = new Date(`${earliest}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + DAYS_PER_WEEK * weeks);
  return d.toISOString().slice(0, 10);
}

/** The whole human order flow through the real pages. Returns the private status-page URL. */
export async function placeOrderViaPages(page: Page, who = "Asha Test"): Promise<string> {
  await page.goto(`${SHOP()}/`);
  await page.getByRole("link", { name: /^Order a cake/ }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Order from");
  await page.locator("input.qty__input").first().fill("1");
  await page.locator("#date").fill(await laterDate(page));
  await page.getByRole("button", { name: "Get my quote" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your quote" })).toBeVisible();
  await page.getByLabel("Name").fill(who);
  await page.getByLabel(/^Phone/).fill("9876543210");
  await page.getByRole("button", { name: "Request order" }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9A-Z]{26}\?t=/);
  return page.url();
}

export async function ownerLogin(page: Page): Promise<void> {
  await page.goto(`${SHOP()}/owner/login`);
  await page.getByLabel("Owner token").fill(OWNER_TOKEN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/owner$/);
}
