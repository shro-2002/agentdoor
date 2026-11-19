import { describe, expect, it } from "vitest";
import {
  decodeQuoteToken,
  generateKeyPair,
  signLaunchRecord,
  signQuoteToken,
  verifyLaunchRecord,
  verifyQuoteToken,
  type LaunchRecord,
  type QuoteTokenPayload,
} from "../src/index.js";

const keys = generateKeyPair();
const NOW = 1_800_000_000;
const HASH = "a".repeat(64);

const payload = (): QuoteTokenPayload => ({
  v: 1,
  qid: "11111111-1111-4111-8111-111111111111",
  shop: "demo-bakery",
  policyHash: HASH,
  request: { items: [{ id: "cake", qty: 1 }] },
  totalPaise: 120_000,
  capacityUnits: 1,
  isRush: false,
  iat: NOW,
  exp: NOW + 900,
});
const ctx = { currentPolicyHash: HASH, nowSec: NOW + 10 };

const tamper = (token: string, change: (p: QuoteTokenPayload) => void) => {
  const [body, sig] = token.split(".") as [string, string];
  const p = JSON.parse(Buffer.from(body, "base64url").toString());
  change(p);
  return `${Buffer.from(JSON.stringify(p)).toString("base64url")}.${sig}`;
};

describe("quote token", () => {
  it("U-SIG-1 round-trips", () => {
    const r = verifyQuoteToken(signQuoteToken(payload(), keys.privateKey), keys.publicKey, ctx);
    expect(r).toEqual({ ok: true, payload: payload() });
  });
  it("U-SIG-2 tampered total is QUOTE_INVALID", () => {
    const t = tamper(signQuoteToken(payload(), keys.privateKey), (p) => (p.totalPaise -= 1));
    expect(verifyQuoteToken(t, keys.publicKey, ctx)).toEqual({ ok: false, code: "QUOTE_INVALID" });
  });
  it("U-SIG-3 other policy hash is QUOTE_STALE_POLICY", () => {
    const t = signQuoteToken(payload(), keys.privateKey);
    const r = verifyQuoteToken(t, keys.publicKey, { ...ctx, currentPolicyHash: "b".repeat(64) });
    expect(r).toEqual({ ok: false, code: "QUOTE_STALE_POLICY" });
  });
  it("U-SIG-4 past exp is QUOTE_EXPIRED", () => {
    const t = signQuoteToken(payload(), keys.privateKey);
    const r = verifyQuoteToken(t, keys.publicKey, { ...ctx, nowSec: NOW + 901 });
    expect(r).toEqual({ ok: false, code: "QUOTE_EXPIRED" });
  });
  it("U-SIG-5 token from another key is QUOTE_INVALID", () => {
    const t = signQuoteToken(payload(), generateKeyPair().privateKey);
    expect(verifyQuoteToken(t, keys.publicKey, ctx)).toEqual({ ok: false, code: "QUOTE_INVALID" });
  });
  it.each(["", "abc", "a.b.c", ".", "x."])("malformed %j is QUOTE_INVALID", (t) => {
    expect(verifyQuoteToken(t, keys.publicKey, ctx)).toEqual({ ok: false, code: "QUOTE_INVALID" });
  });
  it("garbage public key never throws", () => {
    const t = signQuoteToken(payload(), keys.privateKey);
    expect(verifyQuoteToken(t, "not-a-key", ctx)).toEqual({ ok: false, code: "QUOTE_INVALID" });
  });
});

describe("decodeQuoteToken (signature and shape only)", () => {
  it("returns the payload of an expired, stale-policy token: freshness is the caller's call", () => {
    const t = signQuoteToken(payload(), keys.privateKey);
    expect(decodeQuoteToken(t, keys.publicKey)).toEqual({ ok: true, payload: payload() });
    expect(verifyQuoteToken(t, keys.publicKey, { currentPolicyHash: "b".repeat(64), nowSec: NOW + 9999 }).ok).toBe(false);
  });
  it("refuses a bad signature, another key, a wrong shape and garbage", () => {
    const t = signQuoteToken(payload(), keys.privateKey);
    const tampered = tamper(t, (p) => (p.totalPaise -= 1));
    const other = signQuoteToken(payload(), generateKeyPair().privateKey);
    const noQid = signQuoteToken({ ...payload(), qid: 5 } as unknown as QuoteTokenPayload, keys.privateKey);
    for (const bad of [tampered, other, noQid, "", "a.b.c", "x."])
      expect(decodeQuoteToken(bad, keys.publicKey)).toEqual({ ok: false, code: "QUOTE_INVALID" });
    expect(decodeQuoteToken(t, "not-a-key")).toEqual({ ok: false, code: "QUOTE_INVALID" });
  });
});

const record = (): LaunchRecord => ({
  v: 1,
  shop: "demo-bakery",
  policyVersion: 3,
  policyHash: HASH,
  rehearsal: {
    runId: "run-1",
    ranAt: "2026-11-19T10:00:00+05:30",
    probes: 40,
    scenarios: 6,
    passed: 46,
    gapsFound: [],
    criticalOpen: 0,
    resultsHash: "c".repeat(64),
  },
  approvals: { required: 12, approved: 12 },
  publicKey: keys.publicKey,
  signedAt: "2026-11-19T10:01:00+05:30",
});

describe("launch record", () => {
  it("U-SIG-6 verifies; editing criticalOpen breaks it", () => {
    const signed = signLaunchRecord(record(), keys.privateKey);
    expect(verifyLaunchRecord(signed, keys.publicKey)).toBe(true);
    const forged = structuredClone(signed);
    forged.record.rehearsal.criticalOpen = 1;
    expect(verifyLaunchRecord(forged, keys.publicKey)).toBe(false);
  });
  it("rejects a record re-signed by a forger with their own embedded key", () => {
    const forger = generateKeyPair();
    const r = { ...record(), publicKey: forger.publicKey };
    expect(verifyLaunchRecord(signLaunchRecord(r, forger.privateKey), keys.publicKey)).toBe(false);
  });
});
