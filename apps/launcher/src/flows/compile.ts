import {
  BusinessPolicySchema,
  CompileResultWireSchema,
  requiredPaths,
  type BusinessPolicy,
  type Lang,
  type RuleProvenance,
} from "@agentdoor/core";
import type { z } from "zod";
import type { ClaudeClient } from "../claude/client.js";
import { now, todayIst } from "../claude/clock.js";
import { HTTP_UNPROCESSABLE, LauncherError } from "../claude/errors.js";
import { compileSystemPrompt } from "../prompts/load.js";
import type { FsStore, Session } from "../store/fsStore.js";
import { deepEqual, getAt, related, setAt } from "./paths.js";
import {
  DEFAULT_NOTE,
  ITEM_DEFAULTS,
  OPTIONAL_DEFAULTS,
  REQUIRED_DEFAULTS,
  UNFOUND_QUOTE_NOTE,
} from "./template.js";

export const COMPILE_MODEL = "claude-sonnet-5-5";
const COMPILE_EFFORT = "medium";
const COMPILE_MAX_TOKENS = 12_000;
const MAX_QUESTIONS = 5;
const MAX_CHOICES = 4;
const READBACK_MAX = 500;
const RUSH_CAP_PATH = "rush.maxRushUnitsPerDay";
const COMPILE_FAILED_MESSAGE = "I couldn't read that — try rephrasing";

export type CompileResultWire = z.infer<typeof CompileResultWireSchema>;
type Json = Record<string, unknown>;

export interface ValidationIssue {
  code: string;
  severity: "warning" | "info";
  path?: string;
  message: string;
}

export interface Built {
  detectedLanguage: Lang;
  policy: BusinessPolicy;
  questions: CompileResultWire["questions"];
  missing: CompileResultWire["missing"];
  assumptions: CompileResultWire["assumptions"];
  validation: { ok: true; issues: ValidationIssue[] };
}

export type BuildOutcome =
  | { ok: true; value: Built }
  | { ok: false; issues: string[]; noBusiness?: true };

const CONFIDENCE_RANK = { low: 1, medium: 2, high: 3 } as const;

/** Whitespace-collapsed NFC form used on both sides of the verbatim check (05 §4.2). */
const normalizeText = (s: string): string => s.normalize("NFC").replace(/\s+/g, " ").trim();

export function isVerbatim(quote: string, transcript: string): boolean {
  const q = normalizeText(quote);
  return q !== "" && normalizeText(transcript).includes(q);
}

/** The turn a quote really appears in, trying the model's claimed turn first. */
function locateTurn(quote: string, claimed: number, turns: string[]): number | null {
  const order = [claimed, ...turns.map((_, i) => i).filter((i) => i !== claimed)];
  return order.find((i) => turns[i] !== undefined && isVerbatim(quote, turns[i]!)) ?? null;
}

/** `Localized.hi` is `string|null` on the wire but optional in the domain schema. */
function stripNullHi(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripNullHi);
  if (node === null || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node as Json)
      .filter(([k, v]) => !(k === "hi" && v === null))
      .map(([k, v]) => [k, stripNullHi(v)]),
  );
}

function proposed(
  source: RuleProvenance["source"],
  lang: Lang,
  text: string,
  confidence: RuleProvenance["confidence"],
): RuleProvenance {
  return {
    source,
    readback: { lang, text: text.slice(0, READBACK_MAX) || "(no read-back)" },
    confidence,
    status: "proposed",
    approvedAt: null,
  };
}

function mapEvidence(wire: CompileResultWire, turns: string[]): Record<string, RuleProvenance> {
  const best = new Map<string, CompileResultWire["evidence"][number]>();
  for (const e of wire.evidence) {
    const cur = best.get(e.path);
    if (!cur || CONFIDENCE_RANK[e.confidence] > CONFIDENCE_RANK[cur.confidence]) best.set(e.path, e);
  }
  const out: Record<string, RuleProvenance> = {};
  for (const [path, e] of best) {
    const quote = e.quote?.trim() ? e.quote : null;
    const turn = quote ? locateTurn(quote, e.turn, turns) : null;
    if (quote && turn !== null)
      out[path] = proposed({ kind: "transcript", quote, turn }, wire.detectedLanguage, e.readback, e.confidence);
    else if (quote)
      out[path] = proposed({ kind: "owner_edit", note: UNFOUND_QUOTE_NOTE }, wire.detectedLanguage, e.readback, "low");
    else out[path] = proposed({ kind: "owner_edit", note: DEFAULT_NOTE }, wire.detectedLanguage, e.readback, e.confidence);
  }
  return out;
}

const isInferred = (p: RuleProvenance | undefined): boolean =>
  p?.source.kind === "owner_edit" && p.source.note === DEFAULT_NOTE;

/** Coverage direction (a): rules without evidence are flagged `missing` and filled with a default. */
class Coverage {
  readonly missing = new Map<string, { path: string; why: string }>();

  constructor(
    private readonly draft: Json,
    private readonly prov: Record<string, RuleProvenance>,
    private readonly lang: Lang,
    wireMissing: CompileResultWire["missing"],
  ) {
    for (const m of wireMissing) this.missing.set(m.path, m);
  }

  private flag(path: string, why: string): void {
    if (!this.missing.has(path)) this.missing.set(path, { path, why });
  }

  private fill(path: string, why: string, def: { has: boolean; value?: unknown }): void {
    const value = def.has ? def.value : getAt(this.draft, path).value;
    if (def.has) setAt(this.draft, path, def.value);
    this.prov[path] = proposed(
      { kind: "owner_edit", note: DEFAULT_NOTE },
      this.lang,
      `${path} = ${JSON.stringify(value)} (AgentDoor default)`,
      "low",
    );
    this.flag(path, why);
  }

  required(path: string): void {
    const has = path in REQUIRED_DEFAULTS;
    if (!(path in this.prov)) {
      this.fill(path, "The owner did not say this; AgentDoor used a default.", { has, value: REQUIRED_DEFAULTS[path] });
    } else if (isInferred(this.prov[path])) {
      this.flag(path, "Not stated by the owner; AgentDoor default proposed.");
    }
  }

  /** Optional rule leaves only need evidence when they differ from the template. */
  optional(path: string, def: unknown): void {
    const cur = getAt(this.draft, path);
    if (!cur.found || deepEqual(cur.value, def)) return;
    if (Object.keys(this.prov).some((p) => related(p, path))) return;
    this.fill(path, "Set without anything the owner said; reset to the AgentDoor default.", { has: true, value: def });
  }
}

function applyCoverage(draft: Json, prov: Record<string, RuleProvenance>, wire: CompileResultWire) {
  const cov = new Coverage(draft, prov, wire.detectedLanguage, wire.missing);
  for (const p of requiredPaths(draft as unknown as BusinessPolicy)) cov.required(p);
  if (draft.rush !== null) cov.required(RUSH_CAP_PATH);
  for (const [p, def] of Object.entries(OPTIONAL_DEFAULTS)) cov.optional(p, def);
  for (const item of (draft.catalog as { id: string }[]) ?? [])
    for (const [leaf, def] of Object.entries(ITEM_DEFAULTS)) cov.optional(`catalog[${item.id}].${leaf}`, def);
  return cov.missing;
}

/** Coverage direction (b): provenance must belong to an existing path; orphans are dropped and logged. */
function dropOrphans(draft: Json, prov: Record<string, RuleProvenance>, issues: ValidationIssue[]): void {
  for (const path of Object.keys(prov)) {
    if (getAt(draft, path).found) continue;
    delete prov[path];
    issues.push({ code: "ORPHAN_EVIDENCE", severity: "info", path, message: `Evidence for "${path}" matched no rule and was dropped.` });
  }
}

const zodIssues = (error: z.ZodError): string[] =>
  error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);

export function buildCompileResult(
  wire: CompileResultWire,
  turns: string[],
  opts: { allowQuestions?: boolean } = {},
): BuildOutcome {
  if (!wire.policyDraft)
    return { ok: false, noBusiness: true, issues: ["no business found in the transcript"] };
  const draft = stripNullHi(structuredClone(wire.policyDraft)) as Json;
  const prov = mapEvidence(wire, turns);
  const missing = applyCoverage(draft, prov, wire);
  const issues: ValidationIssue[] = [];
  dropOrphans(draft, prov, issues);

  const sorted = Object.fromEntries(Object.entries(prov).sort(([a], [b]) => a.localeCompare(b)));
  const parsed = BusinessPolicySchema.safeParse({ ...draft, provenance: sorted });
  if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };
  const policy = parsed.data;

  if (policy.rush && policy.rush.withinHours > policy.schedule.minLeadHours)
    issues.push({
      code: "RUSH_WINDOW_EXCEEDS_LEAD",
      severity: "warning",
      path: "rush.withinHours",
      message: "The rush window is longer than the normal lead time; check both numbers.",
    });
  const questions = ((opts.allowQuestions ?? true) ? wire.questions : [])
    .slice(0, MAX_QUESTIONS)
    .map((q) => ({ ...q, choices: q.choices.slice(0, MAX_CHOICES) }));
  return {
    ok: true,
    value: {
      detectedLanguage: wire.detectedLanguage,
      policy,
      questions,
      missing: [...missing.values()],
      assumptions: wire.assumptions,
      validation: { ok: true, issues },
    },
  };
}

export interface Deps {
  client: ClaudeClient;
  store: FsStore;
}

export interface CompileResponse {
  version: number;
  compileResult: Omit<Built, "validation">;
  validation: Built["validation"];
}

export function buildUserMessage(session: Session, round: number): string {
  const turns = session.turns.map((t, i) => `=== turn ${i} ===\n${t}`).join("\n\n");
  const rules =
    round === 0
      ? "Round 0: you may ask up to 5 questions."
      : "Final round: do NOT ask questions (return an empty questions array). Anything still unknown keeps an AgentDoor default with quote null.";
  return `Today's date (IST): ${todayIst()}\nOwner's language hint: ${session.language}\n${rules}\n\nTranscript turns:\n\n${turns}`;
}

/** Compiles the given session state, persisting the result as the next version. */
export async function compileState(deps: Deps, session: Session): Promise<CompileResponse> {
  const round = session.clarifyUsed ? 1 : 0;
  const fixtureId = `compile/${session.fixtureKey}/round${round}`;
  const opts = { allowQuestions: round === 0 };
  const call = deps.client
    .callStructured({
      flow: "compile",
      fixtureId,
      model: COMPILE_MODEL,
      effort: COMPILE_EFFORT,
      system: compileSystemPrompt(),
      user: buildUserMessage(session, round),
      wireSchema: CompileResultWireSchema,
      maxTokens: COMPILE_MAX_TOKENS,
      sessionId: session.id,
      validate: (w) => {
        const out = buildCompileResult(w, session.turns, opts);
        return out.ok || out.noBusiness ? [] : out.issues;
      },
    })
    .catch((e: unknown) => {
      if (e instanceof LauncherError && e.code === "STRUCTURED_OUTPUT_INVALID")
        throw new LauncherError("COMPILE_INVALID", COMPILE_FAILED_MESSAGE, HTTP_UNPROCESSABLE);
      throw e;
    });
  const { data: wire, usage, costUsd, fromFixture } = await call;

  const out = buildCompileResult(wire, session.turns, opts);
  if (!out.ok)
    throw new LauncherError(
      out.noBusiness ? "NO_BUSINESS_FOUND" : "COMPILE_INVALID",
      out.noBusiness ? "I couldn't find a business in that description — tell me what you sell." : COMPILE_FAILED_MESSAGE,
      HTTP_UNPROCESSABLE,
    );
  const { policy, validation, ...rest } = out.value;
  const version = deps.store.writeVersion(session.id, policy, {
    round,
    fixtureId,
    createdAt: now().toISOString(),
    model: COMPILE_MODEL,
    fromFixture,
    usage,
    costUsd,
    raw: wire,
    result: { ...rest, validation },
  });
  return { version, compileResult: { ...rest, policy }, validation };
}

export const compileSession = (deps: Deps, sessionId: string): Promise<CompileResponse> =>
  compileState(deps, deps.store.getSession(sessionId));
