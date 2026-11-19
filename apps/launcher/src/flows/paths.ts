/** Policy paths such as `rush.maxRushUnitsPerDay` or `catalog[choco-cake].unitPricePaise` (04 §1). */
const SEGMENT_RE = /^([A-Za-z]+)(?:\[([^\]]+)\])?$/;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);

interface Segment {
  key: string;
  id: string | null;
}

function parsePath(dotted: string): Segment[] | null {
  const segments: Segment[] = [];
  for (const raw of dotted.split(".")) {
    const m = SEGMENT_RE.exec(raw);
    if (!m) return null;
    segments.push({ key: m[1]!, id: m[2] ?? null });
  }
  return segments;
}

/** An array element is addressed by its `id` or (overrides) its `date`; a bare number is an index. */
function pick(list: unknown, id: string): unknown {
  if (!Array.isArray(list)) return undefined;
  const byKey = list.find((e) => isObj(e) && (e.id === id || e.date === id));
  return byKey ?? (/^\d+$/.test(id) ? list[Number(id)] : undefined);
}

function step(cur: unknown, seg: Segment): unknown {
  if (!isObj(cur) || !(seg.key in cur)) return undefined;
  const next = cur[seg.key];
  return seg.id === null ? next : pick(next, seg.id);
}

/** `found` is true for keys that exist with a null/false/0 value (e.g. `rush: null`). */
export function getAt(root: unknown, dotted: string): { found: boolean; value: unknown } {
  const segments = parsePath(dotted);
  if (!segments) return { found: false, value: undefined };
  let cur: unknown = root;
  for (const seg of segments) {
    const parent = cur;
    cur = step(parent, seg);
    if (cur === undefined) return { found: false, value: undefined };
  }
  return { found: true, value: cur };
}

/** Sets an existing-or-new leaf under a resolvable parent; returns false if the parent is missing. */
export function setAt(root: unknown, dotted: string, value: unknown): boolean {
  const segments = parsePath(dotted);
  const last = segments?.at(-1);
  if (!segments || !last || last.id !== null) return false;
  let parent: unknown = root;
  for (const seg of segments.slice(0, -1)) parent = step(parent, seg);
  if (!isObj(parent)) return false;
  parent[last.key] = structuredClone(value);
  return true;
}

/** True when `a` is the same path as `b`, or one is nested under the other. */
export function related(a: string, b: string): boolean {
  const under = (outer: string, inner: string) =>
    inner.startsWith(outer) && (inner[outer.length] === "." || inner[outer.length] === "[");
  return a === b || under(a, b) || under(b, a);
}

export const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
