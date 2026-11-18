import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  policyHash,
  type BusinessPolicy,
} from "../src/index.js";
import bakery from "./fixtures/policy.bakery.json";

const base = () => structuredClone(bakery) as unknown as BusinessPolicy;

function permute(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(permute);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .reverse()
        .map(([k, v]) => [k, permute(v)]),
    );
  }
  return value;
}

describe("U-HASH-1 key order does not matter", () => {
  it("permuted keys give the same hash", () => {
    expect(policyHash(permute(base()) as BusinessPolicy)).toBe(
      policyHash(base()),
    );
  });
  it("hash is 64 hex chars", () => {
    expect(policyHash(base())).toMatch(/^[0-9a-f]{64}$/);
  });
  it("sorts keys and strips whitespace", () => {
    expect(canonicalJson({ b: [1, { d: 1, c: 2 }], a: "x" })).toBe(
      '{"a":"x","b":[1,{"c":2,"d":1}]}',
    );
  });
});

describe("U-HASH-2 any single-field change changes the hash", () => {
  const mutations: [string, (p: any) => void][] = [
    ["price", (p) => (p.catalog[0].unitPricePaise += 1)],
    ["provenance status", (p) => (p.provenance.rush.status = "proposed")],
    ["provenance readback", (p) => (p.provenance.rush.readback.text += "!")],
    ["nested boolean", (p) => (p.fulfilment.pickup.enabled = false)],
    ["array order", (p) => p.catalog.reverse()],
    ["null to value", (p) => (p.fulfilment.pickup.areaLabel = null)],
  ];
  it.each(mutations)("%s", (_n, mutate) => {
    const p = base();
    mutate(p);
    expect(policyHash(p)).not.toBe(policyHash(base()));
  });
});

describe("U-HASH-3 canonicalJson refuses non-canonical values", () => {
  it.each([
    ["float", { a: 1.5 }],
    ["NaN", { a: NaN }],
    ["Infinity", { a: Infinity }],
    ["undefined", { a: undefined }],
    ["function", { a: () => 1 }],
    ["symbol", { a: Symbol("x") }],
    ["bigint", { a: 1n }],
    ["unsafe integer", { a: Number.MAX_SAFE_INTEGER + 1 }],
    ["top-level undefined", undefined],
  ])("throws on %s", (_n, v) => {
    expect(() => canonicalJson(v)).toThrow();
  });
  it("accepts ints, negatives, strings, bools, null, unicode", () => {
    expect(canonicalJson({ a: -3, b: "₹", c: true, d: null })).toBe(
      '{"a":-3,"b":"₹","c":true,"d":null}',
    );
  });
});
