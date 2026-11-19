import { toWireJsonSchema } from "@agentdoor/core";
import type { ZodType } from "zod";

type Json = Record<string, unknown>;

/**
 * Zod emits nullable scalars as `{"type": ["string","null"]}`. The structured-output docs only
 * promise `anyOf` for unions (04 §1: "nullable fields use anyOf [T, null]"), so rewrite type
 * arrays into anyOf before sending.
 */
function rewrite(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewrite);
  if (node === null || typeof node !== "object") return node;
  const obj = node as Json;
  const out: Json = {};
  for (const [k, v] of Object.entries(obj)) out[k] = rewrite(v);
  if (Array.isArray(obj.type)) {
    const { type, ...rest } = out;
    return { ...rest, anyOf: (type as string[]).map((t) => ({ type: t })) };
  }
  // Every number in the policy contract is an integer (04: paise, hours, basis points, counts);
  // the grammar for "integer" is far smaller than for arbitrary floats.
  if (obj.type === "number") return { ...out, type: "integer" };
  return out;
}

/** The JSON Schema sent as `output_config.format.schema` for a wire Zod schema. */
export function outputSchemaFor(schema: ZodType): Record<string, unknown> {
  // `$schema` is metadata the endpoint has no use for; keep the payload minimal.
  const { $schema: _meta, ...rest } = toWireJsonSchema(schema);
  return rewrite(rest) as Record<string, unknown>;
}
