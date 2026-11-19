import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { provenanceBadge } from "@agentdoor/ui";
import { introPage, videoIdFrom } from "../src/views/try.js";
import { layout } from "../src/views/layout.js";
import { html } from "../src/views/html.js";
import { PERSONA_NOTE } from "../src/views/persona.js";

const read = (p: string): string => readFileSync(new URL(p, import.meta.url), "utf8");

describe("shop public assets", () => {
  it("tokens.css and ui.css are exact copies of packages/ui (the pack ships apps/shop/public only)", () => {
    for (const f of ["tokens.css", "ui.css"]) expect(read(`../public/${f}`)).toBe(read(`../../../packages/ui/src/${f}`));
  });
});

describe("/try video", () => {
  it("accepts only a plain 11-character id", () => {
    expect(videoIdFrom("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(videoIdFrom(undefined)).toBeNull();
    expect(videoIdFrom('x"><script>')).toBeNull();
  });
  it("unavailable replay still shows the video area and links, never an iframe without an id", () => {
    const page = introPage(null, null);
    expect(page).toContain("Replay unavailable");
    expect(page).toContain("demo video link is added at submission");
    expect(page).not.toContain("<iframe");
  });
});

describe("layout and badges", () => {
  it.each(["bakery", "agentdoor", "owner"] as const)("the %s look has no inline script, inline style or handler", (chrome) => {
    const page = layout({ title: "T", body: html`<h1>x</h1>`, chrome });
    expect(page).not.toMatch(/<script(?![^>]*src=)/);
    expect(page).not.toMatch(/\son[a-z]+=/);
    expect(page).not.toMatch(/\sstyle=/);
  });
  it("each look loads only its own stylesheets", () => {
    expect(layout({ title: "T", body: html`` })).toContain("/assets/bakery.css");
    expect(layout({ title: "T", body: html`` })).not.toContain("/assets/agentdoor");
    const platform = layout({ title: "T", body: html``, chrome: "agentdoor", styles: ["agentdoor-try.css"] });
    expect(platform).toContain("/assets/agentdoor.css");
    expect(platform).toContain("/assets/agentdoor-try.css");
    expect(platform).not.toContain("/assets/bakery.css");
    expect(layout({ title: "T", body: html``, chrome: "owner" })).toContain("/assets/shop.css");
  });
  it("the illustrative-persona note is the exact sentence, in every shop footer and on /try", () => {
    expect(PERSONA_NOTE).toBe("Illustrative persona based on common home-bakery practices.");
    const shop = layout({ title: "T", body: html`<h1>x</h1>` });
    expect(shop).toMatch(/<footer[\s\S]*Illustrative persona based on common home-bakery practices\.[\s\S]*<\/footer>/);
    expect(layout({ title: "T", body: html`<h1>x</h1>`, chrome: "agentdoor", nav: html`<nav></nav>` })).toContain(PERSONA_NOTE);
    expect(introPage(null, null)).toContain(PERSONA_NOTE);
  });
  it("badges are text, not colour alone", () => {
    expect(String(provenanceBadge({ kind: "claude" }))).toContain("RECORDED · Claude");
    expect(String(provenanceBadge({ kind: "live" }))).toContain("LIVE · deterministic");
    expect(String(provenanceBadge({ kind: "deploy" }))).toContain("RECORDED · deployment evidence");
  });
});
