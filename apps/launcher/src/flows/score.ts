import type { BusinessPolicy } from "@agentdoor/core";

/** Shape of `fixtures/expected/*.json`: the required-path values a transcript should compile to. */
export interface Expected {
  language: "en" | "hi" | "hinglish";
  minAccuracy: number;
  items: {
    match: string[];
    unitPricePaise: number;
    maxQtyPerOrder: number;
    prepHours: number;
  }[];
  areas: { match: string[]; feePaise: number }[];
  fixed: Record<string, unknown>;
  mustAsk: string[];
  afterAnswers?: Record<string, unknown>;
}

/** Reads a value at a dotted policy path (`a.b`); returns undefined if absent. */
export function valueAt(policy: BusinessPolicy, dotted: string): unknown {
  let cur: unknown = policy;
  for (const key of dotted.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const norm = (s: string) => s.normalize("NFC").toLowerCase();
const hits = (names: string[], match: string[]) =>
  match.some((m) => names.some((n) => norm(n).includes(norm(m))));

/** Compile accuracy: share of expected required-path values the compiled policy got right. */
export function scoreCompile(policy: BusinessPolicy, exp: Expected) {
  const wrong: string[] = [];
  let total = 0;
  const check = (label: string, ok: boolean) => {
    total += 1;
    if (!ok) wrong.push(label);
  };
  for (const e of exp.items) {
    const item = policy.catalog.find((c) => hits([c.id, c.name.en, c.name.hi ?? ""], e.match));
    for (const f of ["unitPricePaise", "maxQtyPerOrder", "prepHours"] as const)
      check(`${e.match[0]}.${f}`, item?.[f] === e[f]);
  }
  for (const e of exp.areas) {
    const area = policy.fulfilment.delivery.areas.find((a) => hits([a.id, a.name, ...a.aliases], e.match));
    check(`area.${e.match[0]}`, area?.feePaise === e.feePaise);
  }
  for (const [p, want] of Object.entries(exp.fixed))
    check(p, JSON.stringify(valueAt(policy, p)) === JSON.stringify(want));
  const correct = total - wrong.length;
  return { correct, total, wrong, ratio: correct / total };
}
