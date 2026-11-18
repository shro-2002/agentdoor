import { createHash } from "node:crypto";
import type { BusinessPolicy } from "./schema/policy.js";

/**
 * Canonical JSON (04 §3): keys sorted by UTF-16 code unit, no whitespace, arrays in order.
 * Only string / safe integer / boolean / null are allowed, so floats and NaN can never
 * make two machines disagree on a hash.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isSafeInteger(value))
        throw new TypeError(`canonicalJson: non-integer number ${value}`);
      return JSON.stringify(value);
    case "object":
      return Array.isArray(value)
        ? `[${value.map(canonicalJson).join(",")}]`
        : canonicalObject(value);
    default:
      throw new TypeError(`canonicalJson: unsupported ${typeof value}`);
  }
}

function canonicalObject(obj: object): string {
  const entries = Object.keys(obj)
    .sort()
    .map(
      (k) =>
        `${JSON.stringify(k)}:${canonicalJson((obj as Record<string, unknown>)[k])}`,
    );
  return `{${entries.join(",")}}`;
}

export const sha256Hex = (s: string): string =>
  createHash("sha256").update(s, "utf8").digest("hex");

/** Includes provenance on purpose: approvals are part of what was launched. */
export const policyHash = (policy: BusinessPolicy): string =>
  sha256Hex(canonicalJson(policy));
