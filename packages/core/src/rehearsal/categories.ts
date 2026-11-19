import type { Gap, GapCode } from "./types.js";

/**
 * The four kinds of finding a rehearsal can report. They are different things (a missing business
 * decision is not an engine bug), so no screen may add them into one figure.
 */
export const GAP_CATEGORIES = ["policy", "approval", "scenario", "engine"] as const;
export type GapCategory = (typeof GAP_CATEGORIES)[number];

const CATEGORY_OF: Record<GapCode, GapCategory> = {
  NO_CAPACITY_LIMIT: "policy",
  RUSH_UNBOUNDED: "policy",
  RUSH_LEAD_CONFLICT: "policy",
  PREP_EXCEEDS_LEAD: "policy",
  UNLISTED_AREA_POLICY: "policy",
  AREA_ALIAS_AMBIGUOUS: "policy",
  NO_MIN_ORDER: "policy",
  DIETARY_CLAIM_UNSUPPORTED: "policy",
  CUSTOM_REQUESTS_UNDEFINED: "policy",
  PROBE_NEEDS_OWNER: "policy",
  UNAPPROVED_RULE: "approval",
  LOW_CONFIDENCE_SOURCE: "approval",
  SCENARIO_UNHANDLED: "scenario",
  ENGINE_PROBE_FAILED: "engine",
};

export const gapCategory = (code: GapCode): GapCategory => CATEGORY_OF[code];

export type CategoryCounts = Record<GapCategory, number>;

/** Open findings per category; a gap the owner accepted (`dismissed`) is no longer open. */
export function countOpenByCategory(gaps: readonly (Pick<Gap, "code"> & { dismissed?: boolean })[]): CategoryCounts {
  const counts: CategoryCounts = { policy: 0, approval: 0, scenario: 0, engine: 0 };
  for (const g of gaps) if (!g.dismissed) counts[gapCategory(g.code)] += 1;
  return counts;
}
