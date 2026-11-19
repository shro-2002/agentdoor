import { describe, expect, it } from "vitest";
import { generateKeyPair } from "@agentdoor/core";
import { parseConfig } from "../src/config.js";

const k = generateKeyPair();
const env = {
  PORT: "8080",
  DB_HOST: "h",
  DB_PORT: "3306",
  DB_NAME: "n",
  DB_USER: "u",
  DB_PASSWORD: "p",
  QUOTE_SIGNING_PRIVATE_KEY: k.privateKey,
  QUOTE_SIGNING_PUBLIC_KEY: k.publicKey,
  SESSION_SECRET: Buffer.alloc(32, 7).toString("base64"),
  OWNER_TOKEN_HASH: "a".repeat(64),
  CONTACT_FORM_RECIPIENT_EMAIL: "hello@example.com",
  PUBLIC_BASE_URL: "https://example.com",
  NODE_ENV: "production",
};

describe("parseConfig", () => {
  it("accepts a complete env", () => {
    const r = parseConfig(env);
    expect(r.ok && r.config.port).toBe(8080);
  });
  it("fails closed on a missing var without echoing values", () => {
    const { SESSION_SECRET: _s, ...rest } = env;
    const r = parseConfig(rest);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(env.DB_PASSWORD);
  });
  it("rejects a mismatched key pair", () => {
    const r = parseConfig({ ...env, QUOTE_SIGNING_PUBLIC_KEY: generateKeyPair().publicKey });
    expect(r.ok).toBe(false);
  });
  it("rejects a short session secret", () => {
    expect(parseConfig({ ...env, SESSION_SECRET: "c2hvcnQ=" }).ok).toBe(false);
  });
});
