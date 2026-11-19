import { BusinessPolicySchema, CompileResultWireSchema, LangSchema, ScenarioWireSchema } from "@agentdoor/core";
import { z } from "zod";

/**
 * The public replay session (04 §9), `bundle/try/session.json`. The shop's /try page reads it, so
 * the shape is strict and size-limited like every other external input.
 */
const MAX_TEXT = 8_000;
const MAX_ID = 120;
const MAX_ROWS = 200;
const MAX_VERSIONS = 50;

const nonNegInt = z.number().int().min(0);

export const DemoSessionSchema = z.strictObject({
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
    .array(
      z.strictObject({
        gapId: z.string().max(MAX_ID),
        choice: z.string().max(MAX_ID),
        fromVersion: nonNegInt,
        toVersion: nonNegInt,
      }),
    )
    .max(MAX_ROWS),
  deployLog: z.array(z.strictObject({ step: z.string().max(MAX_ID), ms: nonNegInt, ok: z.boolean() })).max(MAX_ROWS),
  usage: z.strictObject({ calls: nonNegInt, totalUsd: z.number().min(0) }),
});
export type DemoSession = z.infer<typeof DemoSessionSchema>;
