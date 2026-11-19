import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { DeployError } from "./errors.js";

const run = promisify(execFile);
const FILE_MODE = 0o600;
const SESSION_SECRET_BYTES = 32;
const OWNER_TOKEN_BYTES = 24;
const SET_SECRETS_TIMEOUT_MS = 90_000;

export type Variant = "PREVIEW" | "PUBLISH";

/** Names the shop's config needs from hosting secrets (DB_* and PORT come from the platform). */
export const REQUIRED_SECRET_NAMES = [
  "QUOTE_SIGNING_PRIVATE_KEY",
  "QUOTE_SIGNING_PUBLIC_KEY",
  "SESSION_SECRET",
  "OWNER_TOKEN_HASH",
  "CONTACT_FORM_RECIPIENT_EMAIL",
  "PUBLIC_BASE_URL",
] as const;

/**
 * Optional names the shop reads when present. The workspace is closed unless WORKSPACE_ACCESS_CODE is set;
 * ANTHROPIC_API_KEY is the runtime key for its live Claude calls; the budget is a plain number (USD).
 * The owner adds these values to `.agentdoor/secrets/<variant>.json`; nothing here generates them.
 */
export const OPTIONAL_SECRET_NAMES = ["PLATFORM_BASE_URL", "ANTHROPIC_API_KEY", "WORKSPACE_ACCESS_CODE", "WORKSPACE_BUDGET_USD", "WORKSPACE_OPEN"] as const;

/** Of the optional names, the ones whose value is a credential: never allowed inside a packed file. */
export const PRIVATE_OPTIONAL_SECRET_NAMES = ["ANTHROPIC_API_KEY", "WORKSPACE_ACCESS_CODE"] as const;

/** Everything `set-secrets.mjs` will send; the script keeps its own copy and a test keeps the two equal. */
export const ALLOWED_SECRET_NAMES: readonly string[] = [...REQUIRED_SECRET_NAMES, ...OPTIONAL_SECRET_NAMES];

export const secretsDir = (stateDir: string): string => join(stateDir, "secrets");
const variantFile = (stateDir: string, v: Variant): string => join(secretsDir(stateDir), `${v.toLowerCase()}.json`);
const readText = (p: string): string => readFileSync(p, "utf8").trim();

export function readSigningPublicKey(stateDir: string): string {
  const p = join(secretsDir(stateDir), "quote-signing-public.key");
  if (!existsSync(p)) throw new DeployError("SECRETS_MISSING", "no signing key: run scripts/gen-keys.ts first");
  return readText(p);
}

export interface EnsureSecretsInput {
  stateDir: string;
  recipientEmail?: string;
  publicBaseUrl: Record<Variant, string>;
  platformBaseUrl?: string;
}

function generate(input: EnsureSecretsInput, v: Variant): { values: Record<string, string>; ownerToken: string } {
  const priv = join(secretsDir(input.stateDir), "quote-signing-private.key");
  if (!existsSync(priv)) throw new DeployError("SECRETS_MISSING", "no signing key: run scripts/gen-keys.ts first");
  if (!input.recipientEmail) {
    throw new DeployError("SECRETS_MISSING", "CONTACT_FORM_RECIPIENT_EMAIL is needed to create the secrets file");
  }
  const ownerToken = randomBytes(OWNER_TOKEN_BYTES).toString("base64url");
  const values: Record<string, string> = {
    QUOTE_SIGNING_PRIVATE_KEY: readText(priv),
    QUOTE_SIGNING_PUBLIC_KEY: readSigningPublicKey(input.stateDir),
    // Each variant gets its own session secret and owner token (03 §5.6).
    SESSION_SECRET: randomBytes(SESSION_SECRET_BYTES).toString("base64"),
    OWNER_TOKEN_HASH: createHash("sha256").update(ownerToken).digest("hex"),
    CONTACT_FORM_RECIPIENT_EMAIL: input.recipientEmail,
    PUBLIC_BASE_URL: input.publicBaseUrl[v],
  };
  if (input.platformBaseUrl) values.PLATFORM_BASE_URL = input.platformBaseUrl;
  return { values, ownerToken };
}

export interface EnsuredSecrets {
  /** Plain owner tokens, only for files created now. Shown once by the CLI, never stored. */
  ownerTokens: Partial<Record<Variant, string>>;
  /** Every secret value, for the zip/log leak scans. Never log. */
  values: string[];
}

/** Creates `.agentdoor/secrets/{preview,publish}.json` (mode 600) when absent; existing files are kept. */
export function ensureSecretFiles(
  input: EnsureSecretsInput,
  onOwnerToken?: (variant: Variant, token: string) => void,
): EnsuredSecrets {
  mkdirSync(secretsDir(input.stateDir), { recursive: true, mode: 0o700 });
  const ownerTokens: Partial<Record<Variant, string>> = {};
  const values: string[] = [];
  for (const v of ["PREVIEW", "PUBLISH"] as const) {
    const file = variantFile(input.stateDir, v);
    if (!existsSync(file)) {
      const made = generate(input, v);
      writeFileSync(file, JSON.stringify(made.values), { mode: FILE_MODE });
      ownerTokens[v] = made.ownerToken;
      // Shown the moment the file exists: a later failure must not lose the only plain copy.
      onOwnerToken?.(v, made.ownerToken);
    }
    chmodSync(file, FILE_MODE);
    const current = secretValues(input.stateDir, v);
    const missing = REQUIRED_SECRET_NAMES.filter((n) => !(n in current));
    if (missing.length > 0) {
      throw new DeployError("SECRETS_INVALID", `${v} secrets file lacks: ${missing.join(", ")}`);
    }
    const unknown = Object.keys(current).filter((n) => !ALLOWED_SECRET_NAMES.includes(n));
    if (unknown.length > 0) {
      throw new DeployError("SECRETS_INVALID", `${v} secrets file has names that are not allowed: ${unknown.join(", ")}`);
    }
    values.push(...Object.values(current));
  }
  return { ownerTokens, values };
}

export function secretValues(stateDir: string, v: Variant): Record<string, string> {
  return JSON.parse(readFileSync(variantFile(stateDir, v), "utf8")) as Record<string, string>;
}

export const secretNames = (stateDir: string, v: Variant): string[] => Object.keys(secretValues(stateDir, v));

/**
 * Applies one variant through scripts/set-secrets.mjs, which sends values only in a JSON body.
 * argv here is the script path and the variant name, nothing else. A bare `gddy` in the child is
 * resolved from PATH, so a fake binary's directory is put first when one is in use.
 */
export async function applySecrets(opts: {
  repoRoot: string;
  stateDir: string;
  variant: Variant;
  gddyBin: string;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const env = { ...(opts.env ?? process.env) };
  if (opts.gddyBin.startsWith("/")) env.PATH = `${dirname(opts.gddyBin)}:${env.PATH ?? ""}`;
  try {
    await run("node", [join(opts.repoRoot, "scripts/set-secrets.mjs"), opts.variant], {
      cwd: dirname(opts.stateDir),
      env,
      timeout: SET_SECRETS_TIMEOUT_MS,
    });
  } catch {
    // The child's own message is names-only, but execFile errors embed argv/stderr: say nothing more.
    throw new DeployError("SECRETS_FAILED", `setting ${opts.variant} secrets failed`);
  }
}
