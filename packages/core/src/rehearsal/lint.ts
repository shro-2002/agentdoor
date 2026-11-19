import type { BusinessPolicy, RuleProvenance } from "../schema/policy.js";
import { requiredPaths } from "./requiredPaths.js";
import { makeGap, type Gap } from "./types.js";

const UNBOUNDED_CAPACITY = 500;
const DIETARY_CLAIMS = {
  eggless: ["eggless", "egg-less", "egg free", "egg-free", "एगलेस"],
  vegan: ["vegan", "वीगन"],
} as const;

export interface LintOptions {
  /** Owner transcript; when absent, transcript quotes in provenance are used. */
  transcript?: string;
}

/** A default AgentDoor filled in that the owner has not confirmed yet. */
const isDefaulted = (prov: RuleProvenance | undefined): boolean =>
  !prov || (prov.status !== "approved" && prov.source.kind === "owner_edit");

const normalize = (s: string): string => s.trim().toLowerCase();

function capacityGaps(p: BusinessPolicy): Gap[] {
  const path = "capacity.unitsPerDay";
  const unbounded = p.capacity.unitsPerDay >= UNBOUNDED_CAPACITY;
  if (!unbounded && !isDefaulted(p.provenance[path])) return [];
  return [
    makeGap("NO_CAPACITY_LIMIT", "critical", "", [path], {
      unitsPerDay: p.capacity.unitsPerDay,
    }),
  ];
}

function rushGaps(p: BusinessPolicy): Gap[] {
  const { rush } = p;
  if (!rush) return [];
  const gaps: Gap[] = [];
  const cap = "rush.maxRushUnitsPerDay";
  if (
    rush.maxRushUnitsPerDay >= p.capacity.unitsPerDay ||
    isDefaulted(p.provenance["rush"])
  ) {
    gaps.push(
      makeGap("RUSH_UNBOUNDED", "critical", "", [cap], {
        maxRushUnitsPerDay: rush.maxRushUnitsPerDay,
      }),
    );
  }
  if (rush.withinHours > p.schedule.minLeadHours) {
    gaps.push(
      makeGap("RUSH_LEAD_CONFLICT", "critical", "", ["rush.withinHours"], {
        withinHours: rush.withinHours,
        minLeadHours: p.schedule.minLeadHours,
      }),
    );
  }
  return gaps;
}

const prepGaps = (p: BusinessPolicy): Gap[] =>
  p.catalog
    .filter((c) => c.prepHours > p.schedule.minLeadHours)
    .map((c) =>
      makeGap(
        "PREP_EXCEEDS_LEAD",
        "warning",
        c.id,
        [`catalog[${c.id}].prepHours`],
        {
          itemId: c.id,
          prepHours: c.prepHours,
          minLeadHours: p.schedule.minLeadHours,
        },
      ),
    );

function unlistedAreaGaps(p: BusinessPolicy): Gap[] {
  const path = "fulfilment.delivery.unlistedArea";
  if (!p.fulfilment.delivery.enabled || !isDefaulted(p.provenance[path])) {
    return [];
  }
  return [makeGap("UNLISTED_AREA_POLICY", "critical", "", [path])];
}

/** Two areas collide when any name/alias is equal or one prefixes the other. */
function areaAliasGaps(p: BusinessPolicy): Gap[] {
  const { areas } = p.fulfilment.delivery;
  const names = areas.map((a) => [a.name, ...a.aliases].map(normalize));
  const gaps: Gap[] = [];
  for (let i = 0; i < areas.length; i++) {
    for (let j = i + 1; j < areas.length; j++) {
      const clash = names[i]!.some((a) =>
        names[j]!.some((b) => a.startsWith(b) || b.startsWith(a)),
      );
      if (!clash) continue;
      const [a, b] = [areas[i]!, areas[j]!];
      gaps.push(
        makeGap("AREA_ALIAS_AMBIGUOUS", "warning", `${a.id}:${b.id}`, [
          `fulfilment.delivery.areas[${a.id}].aliases`,
          `fulfilment.delivery.areas[${b.id}].aliases`,
        ]),
      );
    }
  }
  return gaps;
}

function minOrderGaps(p: BusinessPolicy): Gap[] {
  const { delivery } = p.fulfilment;
  const feeCharged =
    delivery.enabled && delivery.areas.some((a) => a.feePaise > 0);
  if (p.orderRules.minOrderPaise > 0 || feeCharged) return [];
  return [makeGap("NO_MIN_ORDER", "warning", "", ["orderRules.minOrderPaise"])];
}

const unapprovedGaps = (p: BusinessPolicy): Gap[] =>
  requiredPaths(p)
    .filter((path) => p.provenance[path]?.status !== "approved")
    .map((path) => makeGap("UNAPPROVED_RULE", "critical", path, [path]));

const lowConfidenceGaps = (p: BusinessPolicy): Gap[] =>
  Object.entries(p.provenance)
    .filter(([, v]) => v.confidence === "low" && v.status !== "approved")
    .map(([path]) =>
      makeGap("LOW_CONFIDENCE_SOURCE", "critical", path, [path]),
    );

const customRequestGaps = (p: BusinessPolicy): Gap[] =>
  isDefaulted(p.provenance["orderRules.customRequests"])
    ? [
        makeGap("CUSTOM_REQUESTS_UNDEFINED", "warning", "", [
          "orderRules.customRequests",
        ]),
      ]
    : [];

function dietaryGaps(p: BusinessPolicy, opts: LintOptions): Gap[] {
  const quotes = Object.values(p.provenance).flatMap((v) =>
    v.source.kind === "transcript" ? [v.source.quote] : [],
  );
  const corpus = normalize(opts.transcript ?? quotes.join(" "));
  const gaps: Gap[] = [];
  for (const item of p.catalog) {
    for (const [tag, words] of Object.entries(DIETARY_CLAIMS)) {
      const claimed = (item.dietary as readonly string[]).includes(tag);
      if (!claimed || words.some((w) => corpus.includes(w))) continue;
      gaps.push(
        makeGap(
          "DIETARY_CLAIM_UNSUPPORTED",
          "warning",
          `${item.id}:${tag}`,
          [`catalog[${item.id}].dietary`],
          {
            itemId: item.id,
            tag,
          },
        ),
      );
    }
  }
  return gaps;
}

/** Static policy holes the engine cannot detect on its own (05 §5.2). */
export function lintPolicy(p: BusinessPolicy, opts: LintOptions = {}): Gap[] {
  return [
    ...capacityGaps(p),
    ...rushGaps(p),
    ...prepGaps(p),
    ...unlistedAreaGaps(p),
    ...areaAliasGaps(p),
    ...minOrderGaps(p),
    ...unapprovedGaps(p),
    ...lowConfidenceGaps(p),
    ...dietaryGaps(p, opts),
    ...customRequestGaps(p),
  ];
}
