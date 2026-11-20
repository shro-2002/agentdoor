import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { OWNER_TOKEN, seriousViolations } from "./shop-helpers.js";
import { BENGALURU, DELHI } from "../apps/shop/test/support/fake-claude.js";

/**
 * The whole workspace journey against a fake Claude (a local server the real SDK talks to), for two
 * different bakeries, starting at the early-access dialog. Every screen is checked with axe at both
 * widths and for sideways scrolling; the first bakery's screens are saved to docs/screens (v4-*).
 */
const WS = (): string => process.env.SHOP_WS_URL ?? "";
const CODE = (): string => process.env.SHOP_WS_CODE ?? "";
const OUT = path.resolve("docs/screens");
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const WORKING_TIMEOUT = 45_000;
const HEADING = "Turn the bakery in your head into a shop that's ready for its first customer.";

test.use({ reducedMotion: "reduce" });

interface Shot {
  /** Saved as docs/screens/<prefix>-<name>-<width>.png; no name means check only. */
  name?: string;
  /** "v4" for the original journey, "v5" for the busy-day and money screens. */
  prefix?: string;
  /** Grow the window to the page's height first, so the sticky header does not cover the content in a full-page photo. */
  tall?: boolean;
  /** The visible part only (an open dialog) instead of the whole page. */
  viewportOnly?: boolean;
}

/** Elements that poke out of the page and are not inside a clipping (scrolling) container: the real cause of sideways scroll. */
function wideElements(): string[] {
  const limit = document.documentElement.clientWidth + 0.5;
  const clipped = (el: Element): boolean => {
    for (let p = el.parentElement; p; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") return true;
    return false;
  };
  return [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > limit && !clipped(e)).slice(0, 4).map((e) => `${e.tagName}.${e.className} ${Math.round(e.getBoundingClientRect().left)}-${Math.round(e.getBoundingClientRect().right)}`);
}

/** Axe at both widths, a sideways-scroll check, and a screenshot when asked for. */
async function check(page: Page, label: string, shot: Shot = {}): Promise<void> {
  const original = page.viewportSize() ?? DESKTOP;
  for (const size of [DESKTOP, PHONE]) {
    await page.setViewportSize(size);
    await page.evaluate(async () => {
      const imgs = [...document.images];
      imgs.forEach((i) => (i.loading = "eager"));
      await Promise.all(imgs.map((i) => i.decode().catch(() => undefined)));
    });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const wide = overflow > 0 ? await page.evaluate(wideElements) : [];
    expect(overflow, `${label} scrolls sideways at ${size.width}px: ${wide.join(" | ")}`).toBeLessThanOrEqual(0);
    // A framed storefront has no scripts (sandboxed), so axe cannot enter it: it is checked on its own page.
    expect(await seriousViolations(page, ["iframe"]), `${label} at ${size.width}px`).toEqual([]);
    if (shot.tall) await page.setViewportSize({ width: size.width, height: await page.evaluate(() => document.documentElement.scrollHeight) });
    if (shot.name) await page.screenshot({ path: path.join(OUT, `${shot.prefix ?? "v4"}-${shot.name}-${size.width}.png`), fullPage: !shot.viewportOnly });
  }
  await page.setViewportSize(original);
}

/** Types the description, presses Build and enters the early-access code in the dialog. */
async function start(page: Page, description: string, shots: boolean): Promise<string> {
  await page.goto(`${WS()}/launch`);
  await expect(page.getByRole("heading", { level: 1, name: HEADING })).toBeVisible();
  for (const gone of ["Diagnostics", "Launch report", "Recorded walk-through"]) await expect(page.getByText(gone)).toHaveCount(0);
  await expect(page.getByLabel("Access code")).toBeHidden();
  await expect(page.getByText("Built with Claude · Hosted on GoDaddy")).toBeVisible();
  if (shots) {
    await page.getByRole("link", { name: "Hinglish: Pune home baker" }).click();
    await expect(page.getByLabel("Describe your business")).toHaveValue(/Main ghar par cakes/);
    await check(page, "landing", { name: "landing" });
  }
  await page.getByLabel("Describe your business").fill(description);
  await page.getByLabel("Describe your business").press("Control+Enter");
  const dialog = page.getByRole("dialog", { name: "Early access" });
  await expect(dialog).toBeVisible();
  if (shots) await check(page, "access dialog", { name: "access", viewportOnly: true });
  await dialog.getByLabel("Access code").fill("not-the-code");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("That access code is not right.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Early access" })).toBeVisible();
  await page.getByLabel("Access code").fill(CODE());
  await page.getByRole("button", { name: "Continue" }).click();
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

/** Clears every open item the way an owner would: approve, pick a fix, set a limit, or accept the shop's answer. */
async function resolveEverything(page: Page, base: string): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    await page.goto(`${base}/rehearse`);
    if (await page.getByText("Publishing is unlocked").isVisible()) return;
    const bulk = page.getByRole("button", { name: /^Approve everything I said/ }).first();
    const approve = page.locator(".rule .btn", { hasText: "Approve" }).first();
    const card = page.locator(".issue").first();
    if (await bulk.isVisible()) await bulk.click();
    else if (await approve.isVisible()) await approve.click();
    else if (await card.isVisible()) await resolveCard(card);
    else {
      await page.getByRole("button", { name: "Run checks again" }).click();
      continue;
    }
    await expect(page.locator(".is-resolved").first()).toBeVisible();
    await expect(page.locator(".is-resolved")).toHaveCount(0); // the page refreshed itself with the new state
  }
  throw new Error("could not clear the rehearsal");
}

/** Photographs one element at both widths into docs/screens/v5-<name>-<width>.png. */
async function elementShots(page: Page, target: ReturnType<Page["locator"]>, name: string): Promise<void> {
  for (const size of [DESKTOP, PHONE]) {
    await page.setViewportSize(size);
    // A window as tall as the page never scrolls, so the sticky header cannot cover the element.
    await page.setViewportSize({ width: size.width, height: await page.evaluate(() => document.documentElement.scrollHeight) });
    await target.screenshot({ path: path.join(OUT, `v5-${name}-${size.width}.png`) });
  }
  await page.setViewportSize(DESKTOP);
}

/** Your busiest day, the money at stake on the issue cards, and what a fix protected. */
async function busyDayAndMoney(page: Page, base: string, shots: boolean): Promise<void> {
  const name = (n: string): Shot => ({ name: shots ? n : undefined, prefix: "v5", tall: true });
  await page.getByRole("button", { name: "Simulate a festival rush" }).click();
  await expect(page.getByText("Oversold: 0")).toBeVisible();
  await expect(page.getByText("A simulation using your rules. No real orders were placed.")).toBeVisible();
  await expect(page.locator(".busy__stat")).toHaveCount(3);
  await page.locator(".busy__all summary").click();
  await expect(page.locator(".busy__order")).toHaveCount(50);
  await check(page, "busy day, every order");
  await page.locator(".busy__all summary").click();
  await check(page, "busy day", name("rehearse-busyday"));

  const stake = page.locator(".issue__stake").first();
  await expect(stake).toContainText("Money at stake: ₹");
  await expect(stake).toContainText("Order in this case:");
  const card = page.locator(".issue", { has: stake }).first();
  if (shots) await elementShots(page, card, "issue-stake");
  await card.evaluate((el) => el.classList.add("is-resolved"));
  await expect(card.locator(".issue__protected")).toContainText("Protected: ₹");
  if (shots) await elementShots(page, card, "resolved-protected");
  await page.goto(`${base}/rehearse`);

  // No daily limit: the result says so in plain words and offers the fix right there.
  await page.goto(`${base}/rules`);
  await page.locator("#capacity-rules details.edit summary").click();
  await page.locator("#cap").fill("500");
  await page.locator("#capacity-rules").getByRole("button", { name: "Save" }).click();
  await page.goto(`${base}/rehearse`);
  await page.getByRole("button", { name: "Simulate a festival rush" }).click();
  await expect(page.getByText("Is that possible for you?")).toBeVisible();
  await check(page, "busy day without a limit", name("busyday-nocapacity"));
  await page.locator("#busy-limit").fill("3");
  await page.getByRole("button", { name: "Set a daily limit" }).click();
  await expect(page.getByText("of 3 units booked")).toBeVisible();
  await expect(page.getByText("Is that possible for you?")).toHaveCount(0);
  await expect(page.getByText("Oversold: 0")).toBeVisible();
  await expect(page.getByText(/Protected so far: ₹/)).toBeVisible();
  await page.locator(".protected__list summary").click();
  if (shots) await elementShots(page, page.locator(".hero-card"), "protected-total");
  await check(page, "protected so far");
}

async function resolveCard(card: ReturnType<Page["locator"]>): Promise<void> {
  const accept = card.getByRole("button", { name: "Accept", exact: true });
  const limit = card.locator("input[name=value]");
  if (await accept.count()) await accept.click();
  else if (await limit.count()) {
    await limit.fill("3");
    await card.getByRole("button", { name: "Set limit" }).click();
  } else await card.locator(".fix-seg button, .fix-quick button").first().click();
}

const cases = [
  { key: "bengaluru", description: BENGALURU, shop: "Cocoa & Co", typed: { "minimum order": "₹500" }, shots: true, firstProduct: "Chocolate truffle cake" },
  { key: "delhi", description: DELHI, shop: "Sweet Crumbs", typed: { "minimum order": "₹300" }, shots: false, firstProduct: "Assorted cookie box" },
];

for (const c of cases) {
  test(`workspace journey: ${c.key}`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize(DESKTOP);
    // Hold the job in "running" while the loading screen is photographed and checked.
    let hold = true;
    await page.route("**/jobs/*.json", (route) => (hold ? route.fulfill({ json: { status: "running", kind: "compile", error: null } }) : route.continue()));

    // 1. Landing, early access, then the loading screen driven by the job
    const base = await start(page, c.description, c.shots);
    await expect(page.getByText("Reading your description")).toBeVisible();
    await expect(page.getByText("Writing your business rules")).toBeVisible();
    await check(page, "loading", { name: c.shots ? "loading" : undefined });
    hold = false;

    // 2. Setup: a conversation, with the business so far beside it
    await expect(page.getByText(/^Question 1 of \d$/)).toBeVisible({ timeout: WORKING_TIMEOUT });
    await expect(page.locator(".summary")).toContainText(c.shop);
    await check(page, "setup question", { name: c.shots ? "setup-question" : undefined });
    await answerAll(page, c.typed);
    await expect(page.locator(".summary")).toContainText(c.shop);
    await check(page, "setup done", { name: c.shots ? "setup-done" : undefined });

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
    await page.goto(`${base}/products`);
    await check(page, "products", { name: c.shots ? "products" : undefined });

    // 4. Rules: the owner's own words and suggestions, then approve what was stated
    await page.goto(`${base}/rules`);
    await expect(page.getByText("You said:").first()).toBeVisible();
    await expect(page.getByText("Suggested by AgentDoor").first()).toBeVisible();
    await check(page, "rules", { name: c.shots ? "rules" : undefined });
    await page.getByRole("button", { name: /^Approve everything I said/ }).click();
    await expect(page.getByText(/Approved \d+ rules? you stated/)).toBeVisible();

    // 5. Rehearse: a summary, four separate categories, issues with their fixes right there
    await page.goto(`${base}/rehearse`);
    await page.getByRole("button", { name: "Run rehearsal" }).click();
    await expect(page.getByText("Claude is rehearsing with customers")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Decisions to make" })).toBeVisible({ timeout: WORKING_TIMEOUT });
    for (const title of ["Decisions to make", "Rules to confirm", "Customers who got the wrong answer", "Technical checks"]) await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.locator(".stat")).toHaveCount(4);
    await expect(page.getByText("Publishing is locked")).toBeVisible();
    await expect(page.locator(".issue .bubble").first()).toBeVisible();
    await expect(page.locator(".issue summary", { hasText: "See details" }).first()).toBeVisible();
    await check(page, "rehearse", { name: c.shots ? "rehearse" : undefined });
    await busyDayAndMoney(page, base, c.shots);

    // 6. Storefront is locked in effect until everything is cleared; clear it in place
    await resolveEverything(page, base);
    await expect(page.getByText("Ready for its first customer")).toBeVisible();
    await check(page, "rehearse all clear", { name: c.shots ? "rehearse-clear" : undefined });

    // 7. Storefront: a device-framed live preview, a phone toggle, an honest publish panel
    await page.goto(`${base}/storefront`);
    await expect(page.getByText("Publishing to your own domain needs the owner's authorization.")).toBeVisible();
    await page.getByRole("button", { name: "Preview your storefront" }).click();
    const shop = page.frameLocator("iframe[title='Preview of your storefront']");
    await expect(shop.locator(".hero__title")).toBeVisible();
    await expect(shop.getByText(/^Rehearsed · \d+ checks$/)).toBeVisible(); // the gate passed, so the badge shows
    await expect(shop.getByRole("status").filter({ hasText: "Preview: orders are off" })).toBeVisible();
    await page.getByRole("link", { name: "Phone" }).click();
    await expect(page.locator(".device--phone")).toBeVisible();
    await page.getByRole("link", { name: "Desktop" }).click();
    await expect(page.locator(".device--desktop")).toBeVisible();
    await expect(page.getByLabel("Preview link")).toHaveValue(/\/launch\/p\/[0-9a-f]{32}$/);
    await check(page, "storefront", { name: c.shots ? "storefront" : undefined });

    await page.goto(`${WS()}${new URL(await page.getByLabel("Preview link").inputValue()).pathname}`);
    await expect(page.locator(".hero__title")).toBeVisible();
    await check(page, "preview");
    await page.goto(`${base}/storefront`);

    // 8. Publishing: only the signed-in owner may prepare it
    await expect(page.getByRole("button", { name: "Prepare for publishing" })).toHaveCount(0);
    await page.goto(`${WS()}/owner/login`);
    await page.getByLabel("Owner token").fill(OWNER_TOKEN);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.goto(`${base}/storefront`);
    await page.getByRole("button", { name: "Prepare for publishing" }).click();
    await expect(page.getByText("Package prepared.").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Download package" })).toBeVisible();
  });
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the examples prefill on the server and the early-access step is a page", async ({ page }) => {
    await page.goto(`${WS()}/launch`);
    await page.getByRole("link", { name: "Cookie boxes in Delhi" }).click();
    await expect(page).toHaveURL(/\/launch\?example=2$/);
    await expect(page.getByLabel("Describe your business")).toHaveValue(/assorted cookie boxes/);
    await page.getByRole("button", { name: "Build my business" }).click();
    await expect(page.getByRole("heading", { name: "Early access" })).toBeVisible();
    expect(page.url()).not.toContain("cookie");
    await page.getByLabel("Access code").fill(CODE());
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/launch\/w\/[0-9a-f]{32}\/setup$/);
    await expect(page.getByText("Reading your description").or(page.getByText(/^Question 1 of \d$/))).toBeVisible({ timeout: WORKING_TIMEOUT });
  });
});
