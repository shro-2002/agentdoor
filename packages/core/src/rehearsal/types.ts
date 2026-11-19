/** Gap codes from 05 §5.2, plus two for the probe runner itself. */
export const GAP_CODES = [
  "NO_CAPACITY_LIMIT",
  "RUSH_UNBOUNDED",
  "RUSH_LEAD_CONFLICT",
  "PREP_EXCEEDS_LEAD",
  "UNLISTED_AREA_POLICY",
  "AREA_ALIAS_AMBIGUOUS",
  "NO_MIN_ORDER",
  "UNAPPROVED_RULE",
  "LOW_CONFIDENCE_SOURCE",
  "DIETARY_CLAIM_UNSUPPORTED",
  "CUSTOM_REQUESTS_UNDEFINED",
  "SCENARIO_UNHANDLED",
  "ENGINE_PROBE_FAILED",
  "PROBE_NEEDS_OWNER",
] as const;
export type GapCode = (typeof GAP_CODES)[number];
export type GapSeverity = "critical" | "warning";

export interface Gap {
  /** Stable and unique within one lint run; the launcher keys fixes by it. */
  id: string;
  code: GapCode;
  severity: GapSeverity;
  /** Policy paths the owner should look at. */
  paths: string[];
  /** Numbers/names for the gap card text (never model-written). */
  params: Record<string, string | number>;
}

export const makeGap = (
  code: GapCode,
  severity: GapSeverity,
  key: string,
  paths: string[],
  params: Gap["params"] = {},
): Gap => ({
  id: key ? `${code}:${key}` : code,
  code,
  severity,
  paths,
  params,
});
