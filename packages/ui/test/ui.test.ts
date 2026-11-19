import { describe, expect, it } from "vitest";
import {
  doorGate,
  esc,
  gapAnchor,
  gapCard,
  html,
  raw,
  receiptGroups,
  receiptSlip,
  ruleCard,
  statusChip,
  stepTimeline,
  type RunLike,
} from "../src/index.js";

const EVIL = `<img src=x onerror="alert(1)"> & "q" 'a'`;
/** No raw tag from the payload may survive: the only `<img` allowed would be ours (we render none). */
const clean = (markup: string): void => {
  expect(markup).not.toContain("<img");
  expect(markup).not.toContain('onerror="');
  expect(markup).toContain("&lt;img");
};

describe("html tag", () => {
  it("escapes interpolations, keeps SafeHtml, flattens arrays", () => {
    expect(esc(EVIL)).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &quot;q&quot; &#39;a&#39;");
    expect(String(html`<p>${EVIL}</p>`)).not.toContain("<img");
    expect(String(html`<b>${raw("<i>x</i>")}</b>`)).toBe("<b><i>x</i></b>");
    expect(String(html`<ul>${["a", "<b>"].map((x) => html`<li>${x}</li>`)}</ul>`)).toBe("<ul><li>a</li><li>&lt;b&gt;</li></ul>");
    expect(String(html`${null}${undefined}${false}${0}`)).toBe("0");
  });
  it("makes ids safe", () => {
    expect(gapAnchor("NO_CAPACITY_LIMIT:a[b]")).toBe("gap-NO_CAPACITY_LIMIT-a-b");
  });
});

describe("components escape everything", () => {
  it("StatusChip", () => {
    clean(String(statusChip("gap", EVIL)));
  });
  it("RuleCard", () => {
    const md = String(
      ruleCard({ path: EVIL, title: EVIL, value: EVIL, quote: EVIL, readback: EVIL, state: "proposed", edit: { label: EVIL, unit: EVIL, value: EVIL, min: 0, max: 9 }, labels: { approve: EVIL } }),
    );
    clean(md);
    expect(md).toContain("<article");
    expect(md).toContain("You said:");
  });
  it("RuleCard: approved has no Approve button; a suggested rule shows the note not a quote", () => {
    const approved = String(ruleCard({ path: "a.b", title: "T", value: "1", quote: "q", readback: "r", state: "approved" }));
    expect(approved).not.toContain('data-action="approve"');
    const suggested = String(ruleCard({ path: "a.b", title: "T", value: "1", quote: null, sourceNote: "You did not say this", readback: "r", state: "suggested" }));
    expect(suggested).toContain("You did not say this");
    expect(suggested).not.toContain("You said:");
  });
  it("ReceiptSlip", () => {
    const md = String(
      receiptSlip({ title: EVIL, subtitle: EVIL, groups: [{ id: EVIL, title: EVIL, lines: [{ status: "gap", text: EVIL, gapId: EVIL }, { status: "pass", text: "ok" }] }], labels: { seeFix: EVIL } }),
    );
    clean(md);
    expect(md).toContain("line--gap");
  });
  it("GapCard", () => {
    const md = String(
      gapCard({ gapId: EVIL, severity: "critical", title: EVIL, body: EVIL, example: EVIL, fixes: [{ choice: EVIL, label: EVIL, needsValue: true }], labels: { apply: EVIL } }),
    );
    clean(md);
    expect(md).toContain('type="radio"');
    expect(md).toContain('type="number"');
  });
  it("DoorGate", () => {
    const md = String(doorGate({ open: false, title: EVIL, badge: EVIL, checklist: [{ ok: false, label: EVIL, detail: EVIL }] }));
    clean(md);
    expect(md).toContain("is-locked");
    expect(String(doorGate({ open: true, title: "t", badge: "b", checklist: [] }))).toContain("is-open");
  });
  it("StepTimeline", () => {
    const md = String(stepTimeline({ steps: [{ id: EVIL, label: EVIL, state: "failed", error: EVIL, elapsed: EVIL }, { id: "b", label: "B", state: "running" }] }));
    clean(md);
    expect(md).toContain("Retry from here");
    expect(md).toContain("step--running");
  });
  it("no component emits inline styles or handlers (strict CSP)", () => {
    const all = [
      statusChip("pass"),
      ruleCard({ path: "p", title: "t", value: "v", quote: "q", readback: "r", state: "check", edit: { label: "l", unit: "₹", value: "1", min: 0, max: 2 } }),
      receiptSlip({ title: "t", groups: [{ id: "g", title: "G", lines: [{ status: "pass", text: "x" }] }] }),
      gapCard({ gapId: "g", severity: "warning", title: "t", body: "b", example: null, fixes: [{ choice: "a", label: "A", needsValue: false }] }),
      doorGate({ open: true, title: "t", badge: "b", checklist: [{ ok: true, label: "l" }] }),
      stepTimeline({ steps: [{ id: "a", label: "A", state: "done" }] }),
    ].map(String).join("");
    expect(all).not.toMatch(/\sstyle=|\son[a-z]+=|<script/i);
  });
});

describe("receiptGroups", () => {
  const run: RunLike = {
    probes: [
      ...Array.from({ length: 6 }, (_, i) => ({ probeId: `l${i}`, family: "LEAD_BOUNDARY", status: "PASS" as const, detail: `lead ${i}` })),
      { probeId: "c1", family: "CAPACITY", status: "GAP" as const, detail: "cap gap" },
    ],
    scenarios: [{ id: "s1", customerMessage: "30 cakes!", matched: false, outcome: "QUOTED" }],
    gaps: [
      { id: "PROBE_NEEDS_OWNER:c1", code: "PROBE_NEEDS_OWNER", severity: "warning", dismissed: false, example: "cap gap" },
      { id: "SCENARIO_UNHANDLED:s1", code: "SCENARIO_UNHANDLED", severity: "critical", dismissed: false, example: "30 cakes!" },
      { id: "NO_CAPACITY_LIMIT", code: "NO_CAPACITY_LIMIT", severity: "critical", dismissed: false, example: null },
    ],
  };
  const text = {
    groupTitles: { timing: "Timing", capacity: "Capacity", delivery: "Delivery", prices: "Prices", tricky: "Tricky customers", rules: "Your rules" },
    morePass: (n: number) => `and ${n} more`,
    scenarioOutcome: (o: string) => o.toLowerCase(),
  };
  const groups = receiptGroups(run, [{ gapId: "NO_CAPACITY_LIMIT", code: "NO_CAPACITY_LIMIT", title: "No limit" }], text);
  it("groups by family, folds long PASS runs, links gaps", () => {
    expect(groups.map((g) => g.id)).toEqual(["timing", "capacity", "tricky", "rules"]);
    const timing = groups[0]!.lines;
    expect(timing).toHaveLength(4);
    expect(timing.at(-1)!.text).toBe("and 3 more");
    expect(groups[1]!.lines[0]).toMatchObject({ status: "gap", gapId: "PROBE_NEEDS_OWNER:c1" });
    expect(groups[2]!.lines[0]).toMatchObject({ status: "gap", gapId: "SCENARIO_UNHANDLED:s1" });
    expect(groups[3]!.lines[0]).toMatchObject({ status: "gap", text: "No limit", gapId: "NO_CAPACITY_LIMIT" });
  });
});
