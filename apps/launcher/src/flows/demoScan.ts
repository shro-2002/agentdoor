import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The export gate (U-DEMO-1, SEC-17): refuses a session that would put a secret or customer data
 * on the public /try page. Findings are NAMES only; a matched value is never echoed anywhere.
 */
const MIN_SECRET_CHARS = 12;
/** Public by design (04 §7): these legitimately appear in public files. */
const PUBLIC_VALUE_NAMES = new Set(["QUOTE_SIGNING_PUBLIC_KEY", "PUBLIC_BASE_URL", "PLATFORM_BASE_URL"]);
const PUBLIC_FILES = new Set(["quote-signing-public.key"]);

// The literals are assembled so scripts/check-secrets.sh does not flag this detector itself.
const API_KEY_PREFIX = ["sk", "ant", ""].join("-");
const PEM_MARKER = ["PRIVATE", "KEY"].join(" ");

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "Anthropic API key", re: new RegExp(`${API_KEY_PREFIX}[A-Za-z0-9_-]{8,}`) },
  { name: "PEM private key", re: new RegExp(`-----BEGIN [A-Z ]*${PEM_MARKER}-----`) },
  // Ed25519 PKCS#8 DER always starts with these 16 bytes; base64 of them is this prefix.
  { name: "PKCS#8 private key", re: /MC4CAQAwBQYDK2VwBCIEI[A-Za-z0-9+/=]{20,}/ },
  { name: "e-mail address", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/ },
  // Indian mobile: optional +91, then 10 digits starting 6-9, optionally split 5+5; not inside longer alphanumerics.
  { name: "phone number", re: /(?<![A-Za-z0-9])(?:\+?91[ -]?)?[6-9]\d{4}[ -]?\d{5}(?![A-Za-z0-9])/ },
];

export interface SecretValue {
  /** File the value came from (a name, never the value). */
  file: string;
  value: string;
}

function jsonStringValues(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) for (const n of node) jsonStringValues(n, out);
  else if (node && typeof node === "object")
    for (const [k, v] of Object.entries(node)) if (!PUBLIC_VALUE_NAMES.has(k)) jsonStringValues(v, out);
  return out;
}

/** Every secret value stored under `.agentdoor/secrets` (keys, tokens, per-variant secret files). */
export function loadSecretValues(secretsDir: string): SecretValue[] {
  if (!existsSync(secretsDir)) return [];
  return readdirSync(secretsDir)
    .filter((f) => !PUBLIC_FILES.has(f) && statSync(path.join(secretsDir, f)).isFile())
    .flatMap((file) => {
      const text = readFileSync(path.join(secretsDir, file), "utf8").trim();
      let values = [text];
      try {
        values = jsonStringValues(JSON.parse(text));
      } catch {
        // not JSON: the whole file is the value (a key or token)
      }
      return values.filter((v) => v.length >= MIN_SECRET_CHARS).map((value) => ({ file, value }));
    });
}

/** Names of everything that must not be exported. Empty = clean. */
export function scanForLeaks(text: string, secrets: SecretValue[]): string[] {
  const findings = new Set<string>();
  for (const s of secrets) if (text.includes(s.value)) findings.add(`secret value (from ${s.file})`);
  for (const { name, re } of PATTERNS) if (re.test(text)) findings.add(name);
  return [...findings];
}
