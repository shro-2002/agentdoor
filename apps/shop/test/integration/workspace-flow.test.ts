import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BENGALURU, DELHI } from "../support/fake-claude.js";
import { CODE, settle, startWorkspaceShop, type WsShop } from "./workspace-helpers.js";

let shop: WsShop;
beforeAll(async () => {
  shop = await startWorkspaceShop();
});
afterAll(() => shop.close());

describe("workspace: a whole journey with a fake Claude", () => {
  it("compiles, asks, recompiles, rehearses and unlocks publishing", async () => {
    const b = shop.browser();
    const id = await b.create(BENGALURU);
    const done = await settle(b, shop, id);
    expect(done).toMatchObject({ kind: "compile", status: "done" });

    // Setup shows the first question as answerable chips, and the business so far.
    let page = (await b.get(`/launch/w/${id}/setup`)).text;
    expect(page).toContain("Question 1 of 3");
    expect(page).toContain('type="radio"');
    expect(page).toContain("Cocoa &amp; Co");
    expect(page).toContain("Bengaluru");

    // Answer all three (chip, free text, chip): the last one starts the recompile.
    await b.post(`/launch/w/${id}/setup/answer`, { questionId: "q1", answer: "Refuse custom designs" });
    page = (await b.get(`/launch/w/${id}/setup`)).text;
    expect(page).toContain("Question 2 of 3");
    expect(page).toContain('name="answer"'); // free text: no choices
    await b.post(`/launch/w/${id}/setup/answer`, { questionId: "q2", answer: "₹500" });
    await b.post(`/launch/w/${id}/setup/answer`, { questionId: "q3", answer: "No rush orders" });
    expect(await settle(b, shop, id)).toMatchObject({ kind: "clarify", status: "done" });
    const compileCalls = shop.fake.calls.length;
    expect(compileCalls).toBe(2);

    // The answers reached the rules.
    page = (await b.get(`/launch/w/${id}/rules`)).text;
    expect(page).toContain("₹500");
    expect(page).toContain("Custom requests");

    // Rehearse: Claude writes scenarios once; the engine judges them.
    await b.post(`/launch/w/${id}/rehearse`, { mode: "full" });
    expect(await settle(b, shop, id)).toMatchObject({ kind: "rehearse", status: "done" });
    page = (await b.get(`/launch/w/${id}/rehearse`)).text;
    for (const title of ["Decisions to make", "Rules to confirm", "Customers who got the wrong answer", "Technical checks"]) expect(page).toContain(title);
    expect(page).toContain("Publishing is locked");
    expect(page).toContain("See details");
    expect(page).toContain("Set limit"); // the capacity fix on the bulk-order scenario
  });

  it("a second, different business compiles to its own rules", async () => {
    const b = shop.browser();
    const id = await b.create(DELHI);
    expect(await settle(b, shop, id)).toMatchObject({ kind: "compile", status: "done" });
    const rules = (await b.get(`/launch/w/${id}/rules`)).text;
    for (const area of ["Saket", "Hauz Khas", "Green Park"]) expect(rules).toContain(area);
    expect(rules).toContain("You said:");
    expect(rules).toContain("Suggested by AgentDoor");
    const products = (await b.get(`/launch/w/${id}/products`)).text;
    expect(products).toContain("Assorted cookie box");
    expect(products).toContain("₹650");
  });
});

void CODE;
