import { policyHash, type BusinessPolicy, type Gap, type Lang, type RuleProvenance } from "@agentdoor/core";
import { HTTP_NOT_FOUND, LauncherError, validationFailed } from "../claude/errors.js";
import type { Deps } from "./compile.js";
import { getAt, setAt } from "./paths.js";
import { approve, approvedNow, clipReadback, commitVersion, latestPolicy } from "./policyEdit.js";
import { latestRun, readDismissals } from "./rehearse.js";

/** A typed change: write `value` at `path`, or (approveOnly) just approve the rule as it stands. */
export type Patch = { path: string; value: unknown } | { path: string; approveOnly: true };

export interface FixOption {
  choice: string;
  label: { en: string; hinglish: string };
  patches: Patch[];
  /** A free number the owner types (custom capacity); the patch value is filled in from it. */
  needsValue?: { path: string; min: number; max: number };
}

export const DISMISS = "dismiss";
const CAPACITY_CHIPS = [5, 10, 15];
const RUSH_CAP_CHIPS = [1, 2, 3];
const MIN_ORDER_CHIPS_RUPEES = [200, 300, 500];
const LEAD_CHIPS_HOURS = [24, 48, 72];
const MAX_CUSTOM_UNITS = 499; // 500 is the "no limit" the linter flags
const PAISE_PER_RUPEE = 100;
const CAPACITY = "capacity.unitsPerDay";
const RUSH_CAP = "rush.maxRushUnitsPerDay";
const UNLISTED = "fulfilment.delivery.unlistedArea";
const CUSTOM = "orderRules.customRequests";
const MIN_ORDER = "orderRules.minOrderPaise";
const LEAD = "schedule.minLeadHours";

const opt = (choice: string, en: string, hinglish: string, patches: Patch[], needsValue?: FixOption["needsValue"]): FixOption => ({
  choice,
  label: { en, hinglish },
  patches,
  ...(needsValue ? { needsValue } : {}),
});
const setTo = (path: string, value: unknown): Patch => ({ path, value });
const approveOnly = (path: string): Patch => ({ path, approveOnly: true });

function capacityOptions(): FixOption[] {
  return [
    ...CAPACITY_CHIPS.map((n) => opt(`units-${n}`, `Up to ${n} units a day`, `Din mein ${n} units tak`, [setTo(CAPACITY, n)])),
    opt("units-custom", "A different number", "Koi aur number", [], { path: CAPACITY, min: 1, max: MAX_CUSTOM_UNITS }),
  ];
}

function rushCapOptions(policy: BusinessPolicy): FixOption[] {
  const approveRush = policy.provenance.rush?.status === "approved" ? [] : [approveOnly("rush")];
  const caps = RUSH_CAP_CHIPS.filter((n) => n < policy.capacity.unitsPerDay).map((n) =>
    opt(`rush-cap-${n}`, `At most ${n} rush units a day`, `Din mein sirf ${n} rush units`, [setTo(RUSH_CAP, n), ...approveRush]),
  );
  return [...caps, opt("rush-none", "No rush orders", "Rush orders nahi", [setTo("rush", null)])];
}

const unlistedOptions = (): FixOption[] => [
  opt("unlisted-refuse", "Refuse other areas", "Dusre areas ko mana karo", [setTo(UNLISTED, "REFUSE")]),
  opt("unlisted-ask", "Ask me first", "Pehle mujhse pucho", [setTo(UNLISTED, "ASK_OWNER")]),
];

const customOptions = (): FixOption[] => [
  opt("custom-refuse", "Refuse custom requests", "Custom requests mana karo", [setTo(CUSTOM, "REFUSE")]),
  opt("custom-ask", "Ask me first", "Pehle mujhse pucho", [setTo(CUSTOM, "ASK_OWNER")]),
];

const minOrderOptions = (): FixOption[] => [
  ...MIN_ORDER_CHIPS_RUPEES.map((r) =>
    opt(`min-${r}`, `Minimum order ₹${r}`, `Minimum order ₹${r}`, [setTo(MIN_ORDER, r * PAISE_PER_RUPEE)]),
  ),
  opt("min-accept", "Keep it without a minimum", "Bina minimum ke rehne do", [approveOnly(MIN_ORDER)]),
];

const leadOptions = (): FixOption[] =>
  LEAD_CHIPS_HOURS.map((h) => opt(`lead-${h}`, `${h} hours notice`, `${h} ghante ka notice`, [setTo(LEAD, h)]));

const approveChoice = (path: string): FixOption[] => [
  opt("approve", "Yes, this is right", "Haan, ye sahi hai", [approveOnly(path)]),
];

function prepOptions(gap: Gap, policy: BusinessPolicy): FixOption[] {
  const item = policy.catalog.find((c) => c.id === gap.params.itemId);
  if (!item) return [];
  return [
    opt("prep-accept", "Fine as it is", "Aise hi theek hai", [approveOnly(`catalog[${item.id}].prepHours`)]),
    opt("lead-raise", `Notice ${item.prepHours} hours for everything`, `Sab par ${item.prepHours} ghante ka notice`, [setTo(LEAD, item.prepHours)]),
  ];
}

function rushLeadOptions(policy: BusinessPolicy): FixOption[] {
  if (!policy.rush) return [];
  const { withinHours } = policy.rush;
  return [
    opt("rush-window-align", `Rush only within ${policy.schedule.minLeadHours} hours`, `Rush sirf ${policy.schedule.minLeadHours} ghante ke andar`, [
      setTo("rush.withinHours", policy.schedule.minLeadHours),
    ]),
    opt("lead-align", `${withinHours} hours notice`, `${withinHours} ghante ka notice`, [setTo(LEAD, withinHours)]),
  ];
}

function aliasOptions(gap: Gap, policy: BusinessPolicy): FixOption[] {
  const second = /areas\[([^\]]+)\]/.exec(gap.paths[1] ?? "")?.[1];
  const area = policy.fulfilment.delivery.areas.find((a) => a.id === second);
  if (!area || !gap.paths[1]) return [];
  return [
    opt("alias-clear", `Remove the extra names of ${area.name}`, `${area.name} ke extra naam hata do`, [setTo(`fulfilment.delivery.areas[${area.id}].aliases`, [])]),
    opt("alias-accept", "They are fine as they are", "Ye theek hain", [approveOnly(gap.paths[1])]),
  ];
}

function dietaryOptions(gap: Gap, policy: BusinessPolicy): FixOption[] {
  const item = policy.catalog.find((c) => c.id === gap.params.itemId);
  if (!item) return [];
  const without = item.dietary.filter((t) => t !== gap.params.tag);
  return [
    opt("dietary-confirm", `Yes, it is ${gap.params.tag}`, `Haan, ye ${gap.params.tag} hai`, [approveOnly(`catalog[${item.id}].dietary`)]),
    opt("dietary-remove", "Remove the label", "Label hata do", [setTo(`catalog[${item.id}].dietary`, without)]),
  ];
}

/** Fixes for the rule a scenario points at, when that rule has typed choices. */
function scenarioOptions(gap: Gap, policy: BusinessPolicy): FixOption[] {
  const byPath: Record<string, () => FixOption[]> = {
    [CAPACITY]: capacityOptions,
    [RUSH_CAP]: () => rushCapOptions(policy),
    [UNLISTED]: unlistedOptions,
    [CUSTOM]: customOptions,
    [MIN_ORDER]: minOrderOptions,
    [LEAD]: leadOptions,
  };
  const options = gap.paths.flatMap((p) => byPath[p]?.() ?? []);
  const unique = options.filter((o, i) => options.findIndex((x) => x.choice === o.choice) === i);
  return [...unique, opt(DISMISS, "Actually, that is fine", "Asal mein, ye theek hai", [])];
}

/** The typed choices offered for a gap (05 §5.2 "one-tap fixes"). Engine bugs and probe hand-offs have none. */
export function fixOptions(gap: Gap, policy: BusinessPolicy): FixOption[] {
  switch (gap.code) {
    case "NO_CAPACITY_LIMIT":
      return capacityOptions();
    case "RUSH_UNBOUNDED":
      return rushCapOptions(policy);
    case "RUSH_LEAD_CONFLICT":
      return rushLeadOptions(policy);
    case "PREP_EXCEEDS_LEAD":
      return prepOptions(gap, policy);
    case "UNLISTED_AREA_POLICY":
      return unlistedOptions();
    case "AREA_ALIAS_AMBIGUOUS":
      return aliasOptions(gap, policy);
    case "NO_MIN_ORDER":
      return minOrderOptions();
    case "UNAPPROVED_RULE":
    case "LOW_CONFIDENCE_SOURCE":
      return approveChoice(gap.paths[0] ?? "");
    case "DIETARY_CLAIM_UNSUPPORTED":
      return dietaryOptions(gap, policy);
    case "CUSTOM_REQUESTS_UNDEFINED":
      return customOptions();
    case "SCENARIO_UNHANDLED":
      return scenarioOptions(gap, policy);
    default:
      return [];
  }
}

export interface FixResult {
  fromVersion: number;
  toVersion: number;
  policyHash: string;
  /** True when the policy was already as the fix wants it (no new version). */
  noop: boolean;
}

export interface FixLogEntry {
  gapId: string;
  code: string;
  severity: string;
  choice: string;
  fromVersion: number;
  toVersion: number;
  at: string;
}

const gapNotFound = (why: string): LauncherError => new LauncherError("GAP_NOT_FOUND", why, HTTP_NOT_FOUND);

function chosenPatches(option: FixOption, value: number | undefined): Patch[] {
  if (!option.needsValue) return option.patches;
  const { path, min, max } = option.needsValue;
  if (value === undefined || !Number.isInteger(value) || value < min || value > max)
    throw validationFailed(`The value must be a whole number from ${min} to ${max}.`);
  return [setTo(path, value)];
}

function gapFixProvenance(lang: Lang, gap: Gap, option: FixOption): RuleProvenance {
  const text = lang === "en" ? option.label.en : option.label.hinglish;
  return {
    source: { kind: "gap_fix", gapId: gap.id.slice(0, 80), note: clipReadback(`Owner chose: ${option.label.en}`) },
    readback: { lang, text: clipReadback(text) },
    confidence: "high",
    status: "approved",
    approvedAt: approvedNow(),
  };
}

function applyPatches(policy: BusinessPolicy, patches: Patch[], gap: Gap, option: FixOption, lang: Lang): void {
  for (const patch of patches) {
    const prev = policy.provenance[patch.path];
    if ("approveOnly" in patch) {
      // Approving what the owner already said keeps the evidence; only a rule without any gets a gap_fix entry.
      policy.provenance[patch.path] = prev ? (prev.status === "approved" ? prev : approve(prev)) : gapFixProvenance(lang, gap, option);
      continue;
    }
    if (!getAt(policy, patch.path).found || !setAt(policy, patch.path, patch.value))
      throw validationFailed(`This fix does not apply to this policy ("${patch.path.slice(0, 60)}").`);
    policy.provenance[patch.path] = gapFixProvenance(lang, gap, option);
  }
}

/** Marks a scenario gap as accepted by the owner: an owner_edit note on the first rule the scenario points at. */
function dismissProvenance(prev: RuleProvenance | undefined, gap: Gap, lang: Lang, example: string): RuleProvenance {
  return {
    source: { kind: "owner_edit", note: clipReadback(`Owner reviewed "${example}" and said the current rule is fine.`) },
    readback: prev?.readback ?? { lang, text: "Confirmed by the owner after a rehearsal scenario" },
    confidence: prev?.confidence ?? "high",
    status: "approved",
    approvedAt: approvedNow(),
  };
}

/**
 * The policy as it would be after the owner's chosen fix (a pure function: the caller validates and
 * stores it). A scenario "that is fine" answer only records the owner's acceptance in provenance.
 */
export function patchedPolicy(policy: BusinessPolicy, gap: Gap & { example?: string | null }, choice: string, value: number | undefined, lang: Lang): BusinessPolicy {
  const option = fixOptions(gap, policy).find((o) => o.choice === choice);
  if (!option) throw validationFailed("Unknown fix choice for this gap.");
  const patches = chosenPatches(option, value);
  const next = structuredClone(policy);
  if (choice === DISMISS) {
    const path = gap.paths.find((p) => p in next.provenance);
    if (path) next.provenance[path] = dismissProvenance(next.provenance[path], gap, lang, gap.example ?? gap.id);
  } else applyPatches(next, patches, gap, option, lang);
  return next;
}

function appendLog(deps: Deps, sessionId: string, entry: FixLogEntry): void {
  const log = deps.store.readExtra<FixLogEntry[]>(sessionId, "fixes") ?? [];
  deps.store.writeExtra(sessionId, "fixes", [...log, entry]);
}

/**
 * Applies one owner-chosen typed fix (05 §5.5): patches the newest policy, writes it as the next
 * version, and thereby makes the rehearsal stale (its policy hash no longer matches).
 */
export function applyGapFix(deps: Deps, sessionId: string, gapId: string, choice: string, value?: number): FixResult {
  const run = latestRun(deps, sessionId);
  const gap = run?.gaps.find((g) => g.id === gapId);
  if (!run || !gap) throw gapNotFound(run ? "That gap is not in the latest rehearsal." : "Run the rehearsal first.");
  const { session, version, policy } = latestPolicy(deps, sessionId);
  const next = patchedPolicy(policy, gap, choice, value, session.language);

  const changed = JSON.stringify(next) !== JSON.stringify(policy);
  const toVersion = changed ? commitVersion(deps, sessionId, next, { kind: "gap_fix", gapId, choice, fromVersion: version }) : version;
  if (choice === DISMISS) {
    const at = approvedNow();
    deps.store.writeExtra(sessionId, "dismissals", [...readDismissals(deps, sessionId), { gapId, version: toVersion, at }]);
  }
  appendLog(deps, sessionId, { gapId, code: gap.code, severity: gap.severity, choice, fromVersion: version, toVersion, at: approvedNow() });
  return { fromVersion: version, toVersion, policyHash: policyHash(deps.store.readPolicy(sessionId, toVersion)), noop: !changed };
}
