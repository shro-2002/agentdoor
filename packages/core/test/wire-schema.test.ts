import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BusinessPolicySchema,
  CompileResultWireSchema,
  ScenarioWireSchema,
  toWireJsonSchema,
} from "../src/index.js";
import bakery from "./fixtures/policy.bakery.json";

const FORBIDDEN_KEYWORDS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "multipleOf",
  "format",
  "patternProperties",
  "propertyNames",
];

function walk(
  node: unknown,
  visit: (n: Record<string, unknown>, path: string) => void,
  path = "#",
) {
  if (Array.isArray(node))
    return node.forEach((v, i) => walk(v, visit, `${path}[${i}]`));
  if (node && typeof node === "object") {
    visit(node as Record<string, unknown>, path);
    for (const [k, v] of Object.entries(node)) walk(v, visit, `${path}/${k}`);
  }
}

function violations(schema: unknown): string[] {
  const out: string[] = [];
  walk(schema, (n, path) => {
    if (n.type === "object") {
      if (n.additionalProperties !== false)
        out.push(`${path}: additionalProperties must be false`);
      if (!n.properties) out.push(`${path}: dynamic-key object`);
    }
    if (n.additionalProperties && typeof n.additionalProperties === "object")
      out.push(`${path}: map`);
    if (n.$ref) out.push(`${path}: $ref (recursion/sharing risk)`);
    for (const kw of FORBIDDEN_KEYWORDS)
      if (kw in n) out.push(`${path}: ${kw}`);
  });
  return out;
}

describe("U-CMP-7 (schema half) wire schemas are structured-output safe", () => {
  it.each([
    ["CompileResult", CompileResultWireSchema],
    ["ScenarioWire", ScenarioWireSchema],
  ])("%s JSON Schema has no maps, bounds or open objects", (_n, schema) => {
    expect(violations(toWireJsonSchema(schema))).toEqual([]);
  });

  it("the checker really catches a dynamic-key map and a bound", () => {
    const bad = z.toJSONSchema(
      z.object({
        m: z.record(z.string(), z.string()),
        n: z.number().int().min(1),
      }),
    );
    expect(violations(bad).length).toBeGreaterThan(0);
  });

  it("CompileResult has no provenance map in the policy draft", () => {
    const json = JSON.stringify(toWireJsonSchema(CompileResultWireSchema));
    expect(json).not.toContain('"provenance"');
  });

  it("a wire policy draft is accepted by the wire schema, but domain bounds still apply afterwards", () => {
    const { provenance: _p, ...draft } = structuredClone(bakery) as Record<
      string,
      any
    >;
    const toWire = (d: Record<string, any>) => ({
      ...d,
      catalog: d.catalog.map((c: any) => ({
        ...c,
        name: { en: c.name.en, hi: c.name.hi ?? null },
        options: c.options.map((o: any) => ({
          ...o,
          label: { en: o.label.en, hi: o.label.hi ?? null },
        })),
      })),
      cancellation: {
        ...d.cancellation,
        note: {
          en: d.cancellation.note.en,
          hi: d.cancellation.note.hi ?? null,
        },
      },
    });
    draft.catalog[0].unitPricePaise = -50; // wire has no bounds; the domain schema must reject it
    const wire = CompileResultWireSchema.safeParse({
      detectedLanguage: "en",
      policyDraft: toWire(draft),
      evidence: [],
      missing: [],
      questions: [],
      assumptions: [],
    });
    expect(wire.success).toBe(true);
    expect(
      BusinessPolicySchema.safeParse({ ...draft, provenance: {} }).success,
    ).toBe(false);
  });
});
