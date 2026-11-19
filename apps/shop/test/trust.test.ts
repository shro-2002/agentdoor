import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BusinessPolicySchema, generateKeyPair, policyHash, signLaunchRecord, type BusinessPolicy, type LaunchRecord } from "@agentdoor/core";
import { loadLaunchState, type LaunchState } from "../src/db/launch-state.js";
import { howWeWorkPage, previewHowWeWorkPage, previewStorefrontPage, storefrontPage } from "../src/views/storefront.js";
import { trustOfLaunch, wellKnownTrust, type Trust } from "../src/views/trust.js";
import { recordRun, rehearseNow } from "../src/workspace/flows.js";
import { previewTrust, readiness } from "../src/workspace/readiness.js";
import { emptyState } from "../src/workspace/state.js";

const fixture = new URL("../../../packages/core/test/fixtures/policy.bakery.json", import.meta.url);
const parsePolicy = (): BusinessPolicy => BusinessPolicySchema.parse(JSON.parse(readFileSync(fixture, "utf8")));
const keys = generateKeyPair();

function launchWith(probes: number, scenarios: number, edit: (p: BusinessPolicy) => void = () => undefined): LaunchState {
  const policy = parsePolicy();
  edit(policy);
  const record: LaunchRecord = {
    v: 1,
    shop: policy.business.slug,
    policyVersion: 7,
    policyHash: policyHash(policy),
    rehearsal: { runId: "r1", ranAt: "2026-11-19T00:00:00Z", probes, scenarios, passed: probes + scenarios - 2, gapsFound: [], criticalOpen: 0, resultsHash: "c".repeat(64) },
    approvals: { required: 12, approved: 12 },
    publicKey: keys.publicKey,
    signedAt: "2026-11-19T08:30:00Z",
  };
  const dir = mkdtempSync(join(tmpdir(), "trust-"));
  writeFileSync(join(dir, "policy.json"), JSON.stringify(policy));
  writeFileSync(join(dir, "launch-record.json"), JSON.stringify(signLaunchRecord(record, keys.privateKey)));
  return loadLaunchState(dir, keys.publicKey);
}

describe("the Rehearsed badge on the live storefront", () => {
  it("quotes its numbers from the signed record, never from the page", () => {
    for (const [probes, scenarios] of [[39, 10], [31, 9]] as const) {
      const html = storefrontPage(launchWith(probes, scenarios));
      expect(html).toContain(`Rehearsed before launch · ${probes + scenarios} checks · rules approved by the owner`);
    }
    expect(storefrontPage(launchWith(31, 9))).not.toContain("49 checks");
  });

  it("links to /how-we-work from the badge and from the footer", () => {
    const html = storefrontPage(launchWith(39, 10));
    expect(html).toMatch(/<a class="trust-badge" href="\/how-we-work">/);
    expect(html).toMatch(/<footer[\s\S]*<a href="\/how-we-work">How we work<\/a>/);
  });

  it("is absent when the shop is not launched", () => {
    const html = storefrontPage({ launched: false, reason: "BAD_SIGNATURE" });
    expect(html).not.toContain("trust-badge");
    expect(html).not.toContain("How we work");
    expect(howWeWorkPage({ launched: false, reason: "BAD_SIGNATURE" })).toBeNull();
  });
});

describe("/how-we-work", () => {
  const launch = launchWith(39, 10);
  const page = howWeWorkPage(launch)!;

  it("lists the rules in plain words with the shop's own numbers", () => {
    const p = parsePolicy();
    expect(page).toContain(`${p.catalog[0]!.name.en}: ₹600 per kg.`);
    expect(page).toContain("Delivery to Aundh: ₹80.");
    expect(page).toContain("Orders need at least 2 days of notice, and can be placed up to 30 days ahead.");
    expect(page).toContain("a rush charge of ₹200, and at most 2 rush units a day");
    expect(page).toContain("At most 10 units are baked a day.");
    expect(page).toContain("Closed on Mondays.");
    expect(page).toContain("Free cancellation up to 24 hours before delivery.");
    expect(page).toContain("Areas that are not listed are not served.");
  });

  it("shows the owner's quoted words where the rule was stated, and says so where it was not", () => {
    expect(page).toContain("“chocolate cake is 600 rupees a kg”");
    expect(page).toContain("“I need 2 days notice”");
    expect(page).toContain("“I do not deliver anywhere else”");
    expect(page).toContain("Approved by the owner. No spoken quote is on record for this rule.");
  });

  it("escapes a quote that contains markup", () => {
    const html = howWeWorkPage(launchWith(39, 10, (p) => {
      const prov = p.provenance["schedule.minLeadHours"]!;
      if (prov.source.kind === "transcript") prov.source.quote = "<script>alert(1)</script> two days";
    }))!;
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; two days");
  });

  it("says what was verified: the first 12 hex characters of the policy hash, the signature, the checks", () => {
    expect(page).toContain(`<code class="mono">${launch.launched ? launch.policyHash.slice(0, 12) : ""}</code>`);
    expect(page).toContain("signed with this shop's own key");
    expect(page).toContain("The signature was checked when the shop started");
    expect(page).toContain("rehearsed with 49 checks");
    expect(page).toContain("approved 12 of 12 required rules");
  });
});

describe("the summary shared with AI shoppers", () => {
  it("carries the signed record's figures and the rules address", () => {
    const launch = launchWith(39, 10);
    expect(wellKnownTrust(launch)).toEqual({
      rehearsedBeforeLaunch: true,
      checks: 49,
      checksPassed: 47,
      rulesApproved: 12,
      rulesRequired: 12,
      policyHashPrefix: (launch.launched ? launch.policyHash : "").slice(0, 12),
      signedAt: "2026-11-19T08:30:00Z",
      signatureVerifiedAtStartup: true,
      rulesUrl: "/how-we-work",
    });
    expect(trustOfLaunch({ launched: false, reason: "BAD_SIGNATURE" })).toBeNull();
    expect(wellKnownTrust({ launched: false, reason: "BAD_SIGNATURE" })).toBeNull();
  });
});

describe("workspace previews", () => {
  const policy = parsePolicy();
  const path = "/launch/p/abc123";
  const rehearsed: Trust = { kind: "preview", rehearsed: true, checks: 44 };
  const not: Trust = { kind: "preview", rehearsed: false, checks: 0 };

  it("shows the badge only when the draft's gate passes", () => {
    const yes = previewStorefrontPage(policy, path, rehearsed);
    expect(yes).toContain("Rehearsed · 44 checks");
    expect(yes).toContain(`href="${path}/how-we-work"`);
    expect(yes).not.toContain("Not yet rehearsed");
    const no = previewStorefrontPage(policy, path, not);
    expect(no).not.toContain("trust-badge");
    expect(no).toContain('<span class="pvbar__chip">Not yet rehearsed</span>');
  });

  it("keeps every link on the preview, never the live shop's rules page", () => {
    const html = previewHowWeWorkPage(policy, path, rehearsed);
    expect(html).not.toContain('href="/how-we-work"');
    expect(html).toContain(`href="${path}#menu"`);
    expect(html).toContain("This is a preview of a draft. Its rules passed 44 checks");
    expect(html).toContain("Nothing here is signed.");
    expect(previewHowWeWorkPage(policy, path, not)).toContain("has not been rehearsed yet");
  });

  it("derives the trust from the same gate that unlocks publishing", () => {
    const state = emptyState("a bakery");
    state.policy = parsePolicy();
    state.policyVersion = 1;
    expect(previewTrust(state)).toEqual({ kind: "preview", rehearsed: false, checks: 0 });
    state.scenarios = { vocabHash: "x", items: [] };
    recordRun(state, rehearseNow(state, Date.parse("2026-11-19T06:00:00Z")));
    const trust = previewTrust(state);
    expect(trust).toMatchObject({ rehearsed: readiness(state).canPublish });
    expect(trust.kind === "preview" && trust.checks).toBe(state.run!.summary.probes + state.run!.summary.scenarios);
    state.policy.provenance["capacity.unitsPerDay"]!.status = "proposed";
    expect(previewTrust(state)).toMatchObject({ rehearsed: false });
  });
});
