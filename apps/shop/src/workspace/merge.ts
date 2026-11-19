import { BusinessPolicySchema, type BusinessPolicy } from "@agentdoor/core";
import { deepEqual, getAt, setAt } from "../../../launcher/src/flows/paths.js";

/**
 * A recompile rewrites the whole policy from the transcript, but the owner may already have edited
 * or approved rules since the last one. What they did survives: an approved rule that came out the
 * same stays approved, and a rule they changed themselves (or fixed) keeps their value. Rules that
 * came from their words and now read differently follow the new reading, because the new answers
 * are what changed them.
 */
export function mergeOwnerWork(next: BusinessPolicy, prev: BusinessPolicy | null): BusinessPolicy {
  if (!prev) return next;
  const merged = structuredClone(next);
  for (const [path, old] of Object.entries(prev.provenance)) {
    if (old.status !== "approved") continue;
    const before = getAt(prev, path);
    const now = getAt(merged, path);
    if (!before.found || !now.found) continue;
    if (deepEqual(before.value, now.value)) merged.provenance[path] = old;
    else if (old.source.kind !== "transcript" && setAt(merged, path, before.value)) merged.provenance[path] = old;
  }
  return BusinessPolicySchema.safeParse(merged).success ? merged : next;
}
