/**
 * Reads a rule by its policy path (`rush.maxRushUnitsPerDay`, `catalog[choco-cake].unitPricePaise`).
 * A small copy of the launcher's reader: the shop is deployed without the launcher.
 */
const SEGMENT_RE = /^([A-Za-z]+)(?:\[([^\]]+)\])?$/;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);

function pick(list: unknown, id: string): unknown {
  if (!Array.isArray(list)) return undefined;
  return list.find((e) => isObj(e) && (e.id === id || e.date === id)) ?? (/^\d+$/.test(id) ? list[Number(id)] : undefined);
}

export function getAt(root: unknown, dotted: string): { found: boolean; value: unknown } {
  let cur: unknown = root;
  for (const raw of dotted.split(".")) {
    const m = SEGMENT_RE.exec(raw);
    if (!m || !isObj(cur) || !(m[1]! in cur)) return { found: false, value: undefined };
    const next = cur[m[1]!];
    cur = m[2] === undefined ? next : pick(next, m[2]);
    if (cur === undefined) return { found: false, value: undefined };
  }
  return { found: true, value: cur };
}
