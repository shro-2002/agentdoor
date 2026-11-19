import { z } from "zod";
import { importPrivateKey, signUtf8, verifyUtf8 } from "@agentdoor/core";

const MIN_SESSION_SECRET_BYTES = 32;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const KEY_PROBE = "agentdoor-key-pair-check";
const MAX_PORT = 65_535;

const nonEmpty = z.string().min(1);
const port = z.coerce.number().int().min(1).max(MAX_PORT);

const EnvSchema = z.object({
  PORT: port,
  DB_HOST: nonEmpty,
  DB_PORT: port,
  DB_NAME: nonEmpty,
  DB_USER: nonEmpty,
  DB_PASSWORD: nonEmpty,
  QUOTE_SIGNING_PRIVATE_KEY: nonEmpty,
  QUOTE_SIGNING_PUBLIC_KEY: nonEmpty,
  SESSION_SECRET: nonEmpty,
  OWNER_TOKEN_HASH: z.string().regex(SHA256_HEX),
  CONTACT_FORM_RECIPIENT_EMAIL: z.email(),
  PUBLIC_BASE_URL: z.url(),
  NODE_ENV: z.enum(["production", "development", "test"]).default("production"),
});

export interface ShopConfig {
  port: number;
  nodeEnv: "production" | "development" | "test";
  db: { host: string; port: number; database: string; user: string; password: string };
  signingPrivateKey: string;
  signingPublicKey: string;
  sessionSecret: Buffer;
  ownerTokenHash: string;
  contactRecipient: string;
  publicBaseUrl: string;
}

/** Only variable names are reported, never values: the result may be logged. */
export type ConfigResult =
  | { ok: true; config: ShopConfig }
  | { ok: false; errors: string[] };

function keyPairMatches(privateKey: string, publicKey: string): boolean {
  try {
    importPrivateKey(privateKey);
    return verifyUtf8(KEY_PROBE, signUtf8(KEY_PROBE, privateKey), publicKey);
  } catch {
    return false;
  }
}

export function parseConfig(env: Record<string, string | undefined>): ConfigResult {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => String(i.path[0] ?? "env"));
    return { ok: false, errors: [...new Set(names)].map((n) => `${n}: missing or invalid`) };
  }
  const e = parsed.data;
  const sessionSecret = Buffer.from(e.SESSION_SECRET, "base64");
  const problems: string[] = [];
  if (sessionSecret.length < MIN_SESSION_SECRET_BYTES)
    problems.push("SESSION_SECRET: must decode to at least 32 bytes");
  if (!keyPairMatches(e.QUOTE_SIGNING_PRIVATE_KEY, e.QUOTE_SIGNING_PUBLIC_KEY))
    problems.push("QUOTE_SIGNING_*: key pair invalid or mismatched");
  if (problems.length > 0) return { ok: false, errors: problems };
  return {
    ok: true,
    config: {
      port: e.PORT,
      nodeEnv: e.NODE_ENV,
      db: {
        host: e.DB_HOST,
        port: e.DB_PORT,
        database: e.DB_NAME,
        user: e.DB_USER,
        password: e.DB_PASSWORD,
      },
      signingPrivateKey: e.QUOTE_SIGNING_PRIVATE_KEY,
      signingPublicKey: e.QUOTE_SIGNING_PUBLIC_KEY,
      sessionSecret,
      ownerTokenHash: e.OWNER_TOKEN_HASH,
      contactRecipient: e.CONTACT_FORM_RECIPIENT_EMAIL,
      publicBaseUrl: e.PUBLIC_BASE_URL,
    },
  };
}

/** Boot-time wrapper: log variable names only, then exit (fail closed). */
export function loadConfigOrExit(
  env: Record<string, string | undefined> = process.env,
): ShopConfig {
  const r = parseConfig(env);
  if (r.ok) return r.config;
  console.error(JSON.stringify({ event: "config_invalid", errors: r.errors }));
  process.exit(1);
}
