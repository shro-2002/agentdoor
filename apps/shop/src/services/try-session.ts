import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BusinessPolicySchema, CompileResultWireSchema, LangSchema, ScenarioWireSchema } from "@agentdoor/core";
import { z } from "zod";

/**
 * `bundle/try/session.json` (04 §9), written by the launcher's `export-demo`. The launcher owns the
 * schema; the shop is deployed without it, so this is the same shape read back strictly: a file that
 * does not match is "replay unavailable", never a crash and never half-rendered.
 */
const MAX_TEXT = 8_000;
const MAX_ID = 120;
const MAX_ROWS = 200;
const MAX_VERSIONS = 50;
const nonNegInt = z.number().int().min(0);

export const TrySessionSchema = z.strictObject({
  v: z.literal(1),
  recordedAt: z.string().max(40),
  language: LangSchema,
  transcript: z.string().max(MAX_TEXT),
  compile: z.strictObject({
    result: CompileResultWireSchema,
    costUsd: z.number().min(0),
    model: z.string().max(80),
    latencyMs: nonNegInt,
  }),
  answers: z.array(z.strictObject({ questionId: z.string().max(MAX_ID), text: z.string().max(MAX_TEXT) })).max(MAX_ROWS),
  policyVersions: z.array(BusinessPolicySchema).min(1).max(MAX_VERSIONS),
  scenarios: z.array(ScenarioWireSchema).max(MAX_ROWS),
  gapFixes: z
    .array(z.strictObject({ gapId: z.string().max(MAX_ID), choice: z.string().max(MAX_ID), fromVersion: nonNegInt, toVersion: nonNegInt }))
    .max(MAX_ROWS),
  deployLog: z.array(z.strictObject({ step: z.string().max(MAX_ID), ms: nonNegInt, ok: z.boolean() })).max(MAX_ROWS),
  usage: z.strictObject({ calls: nonNegInt, totalUsd: z.number().min(0) }),
});
export type TrySession = z.infer<typeof TrySessionSchema>;

/** Same folder the shop boots from (`BUNDLE_DIR`, else `./bundle`). */
export const defaultBundleDir = (): string => process.env.BUNDLE_DIR ?? join(process.cwd(), "bundle");

export type SessionLoad = { ok: true; session: TrySession } | { ok: false };

/** Read from disk only when the file changed: a request costs one stat, not a re-parse. */
export function sessionLoader(bundleDir: string): () => SessionLoad {
  const file = join(bundleDir, "try", "session.json");
  let cached: { mtimeMs: number; size: number; result: SessionLoad } | null = null;
  return () => {
    try {
      const st = statSync(file);
      if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.result;
      const parsed = TrySessionSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
      const result: SessionLoad = parsed.success ? { ok: true, session: parsed.data } : { ok: false };
      cached = { mtimeMs: st.mtimeMs, size: st.size, result };
      return result;
    } catch {
      return { ok: false };
    }
  };
}
