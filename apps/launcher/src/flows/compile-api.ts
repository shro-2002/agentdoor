import { CompileResultWireSchema, PolicyDraftWireSchema } from "@agentdoor/core";
import { z } from "zod";

/**
 * What Claude is actually asked to return. The structured-output endpoint refuses the full
 * CompileResult wire schema ("compiled grammar is too large": the policy object alone is at the
 * limit, measured 2026-11-19), so the policy travels as JSON text in one string field. Its shape
 * is still the strict `PolicyDraftWireSchema`: the prompt carries that JSON Schema, and code
 * parses + validates the text afterwards (failures take the one repair attempt).
 */
const s = CompileResultWireSchema.shape;
export const CompileApiSchema = z.strictObject({
  detectedLanguage: s.detectedLanguage,
  /** JSON text of the policy draft, or the text `null` if the transcript describes no business. */
  policyDraftJson: z.string(),
  evidence: s.evidence,
  missing: s.missing,
  questions: s.questions,
  assumptions: s.assumptions,
});
export type CompileApi = z.infer<typeof CompileApiSchema>;
export type CompileResultWire = z.infer<typeof CompileResultWireSchema>;

export type WireOutcome = { ok: true; wire: CompileResultWire } | { ok: false; issues: string[] };

const issueList = (e: z.ZodError): string[] =>
  e.issues.map((i) => `policyDraftJson.${i.path.join(".") || "(root)"}: ${i.message}`);

/** Turns the API shape into the contract's CompileResult wire shape (04 §1). */
export function toWire(api: CompileApi): WireOutcome {
  const { policyDraftJson, ...rest } = api;
  let draft: unknown;
  try {
    draft = JSON.parse(policyDraftJson);
  } catch {
    return { ok: false, issues: ["policyDraftJson: not valid JSON text"] };
  }
  if (draft === null) return { ok: true, wire: { ...rest, policyDraft: null } };
  const parsed = PolicyDraftWireSchema.safeParse(draft);
  if (!parsed.success) return { ok: false, issues: issueList(parsed.error) };
  return { ok: true, wire: { ...rest, policyDraft: parsed.data } };
}
