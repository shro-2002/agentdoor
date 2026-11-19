import type { ReceiptGroup, ReceiptLine } from "./components.js";

/** The parts of a rehearsal run the receipt needs (structural, so the shop's `/try` can feed recorded runs). */
export interface RunLike {
  probes: { probeId: string; family: string; status: "PASS" | "FAIL" | "GAP"; detail: string }[];
  scenarios: { id: string; customerMessage: string; matched: boolean; outcome: string }[];
  gaps: { id: string; code: string; severity: string; dismissed: boolean; example: string | null }[];
}
export interface CardLike {
  gapId: string;
  code: string;
  title: string;
}

export type GroupId = "timing" | "capacity" | "delivery" | "prices" | "tricky" | "rules";
export const GROUP_ORDER: GroupId[] = ["timing", "capacity", "delivery", "prices", "tricky", "rules"];

const FAMILY_GROUP: Record<string, GroupId> = {
  LEAD_BOUNDARY: "timing",
  RUSH_WINDOW: "timing",
  CLOSED_DAY: "timing",
  CAPACITY: "capacity",
  RUSH_CAP: "capacity",
  QTY_BOUNDS: "capacity",
  AREAS: "delivery",
  MIN_ORDER: "prices",
  PRICE_ARITHMETIC: "prices",
  UNKNOWN_ITEM: "prices",
  HAGGLING: "tricky",
};

/** PASS lines shown per group before the rest are folded into one line, so a 60-probe run still reads as a receipt. */
const PASS_LINES_SHOWN = 3;

export interface ReceiptText {
  groupTitles: Record<GroupId, string>;
  morePass: (n: number) => string;
  scenarioOutcome: (outcome: string) => string;
}

const toLine = (status: ReceiptLine["status"], text: string, gapId?: string): ReceiptLine =>
  gapId ? { status, text, gapId } : { status, text };

/** Collapses the tail of a long PASS run while keeping every GAP/FAILED line. */
function fold(lines: ReceiptLine[], morePass: (n: number) => string): ReceiptLine[] {
  const passes = lines.filter((l) => l.status === "pass");
  if (passes.length <= PASS_LINES_SHOWN + 1) return lines;
  const keep = new Set(passes.slice(0, PASS_LINES_SHOWN));
  const out = lines.filter((l) => l.status !== "pass" || keep.has(l));
  out.push({ status: "pass", text: morePass(passes.length - PASS_LINES_SHOWN) });
  return out;
}

/** Run + gap-card titles -> receipt groups: problems print first inside a group, then passes. */
export function receiptGroups(run: RunLike, cards: CardLike[], text: ReceiptText): ReceiptGroup[] {
  const lines = new Map<GroupId, ReceiptLine[]>(GROUP_ORDER.map((g) => [g, []]));
  const gapFor = (id: string): string | undefined => run.gaps.find((g) => g.id === id && !g.dismissed)?.id;
  const push = (g: GroupId, line: ReceiptLine): void => void lines.get(g)!.push(line);

  for (const p of run.probes) {
    const code = p.status === "FAIL" ? "ENGINE_PROBE_FAILED" : "PROBE_NEEDS_OWNER";
    const gapId = p.status === "PASS" ? undefined : gapFor(`${code}:${p.probeId}`);
    push(FAMILY_GROUP[p.family] ?? "rules", toLine(p.status === "PASS" ? "pass" : p.status === "FAIL" ? "failed" : "gap", p.detail, gapId));
  }
  const scenarioGapIds = new Set<string>();
  for (const s of run.scenarios) {
    const gap = s.matched ? undefined : run.gaps.find((g) => g.code === "SCENARIO_UNHANDLED" && g.example === s.customerMessage && !g.dismissed);
    if (gap) scenarioGapIds.add(gap.id);
    push("tricky", toLine(s.matched || !gap ? "pass" : "gap", `“${s.customerMessage}” → ${text.scenarioOutcome(s.outcome)}`, gap?.id));
  }
  const titles = new Map(cards.map((c) => [c.gapId, c.title]));
  const probeGap = (id: string): boolean => id.startsWith("ENGINE_PROBE_FAILED:") || id.startsWith("PROBE_NEEDS_OWNER:");
  // Rule gaps with the same wording (25 "a rule is waiting for your OK") print as one line with a count.
  const ruleGaps = new Map<string, { first: string; n: number }>();
  for (const g of run.gaps) {
    if (g.dismissed || scenarioGapIds.has(g.id) || probeGap(g.id) || g.code === "SCENARIO_UNHANDLED") continue;
    const title = titles.get(g.id) ?? g.code;
    const seen = ruleGaps.get(title);
    if (seen) seen.n++;
    else ruleGaps.set(title, { first: g.id, n: 1 });
  }
  for (const [title, { first, n }] of ruleGaps) push("rules", toLine("gap", n > 1 ? `${title} ×${n}` : title, first));
  const rank = { gap: 0, failed: 0, pass: 1 } as const;
  return GROUP_ORDER.flatMap((id) => {
    const sorted = [...lines.get(id)!].sort((a, b) => rank[a.status] - rank[b.status]);
    return sorted.length ? [{ id, title: text.groupTitles[id], lines: fold(sorted, text.morePass) }] : [];
  });
}
