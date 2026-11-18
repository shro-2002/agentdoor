// Usage: npx tsx scripts/gen-keys.ts [--force]
// Writes the quote/launch signing key pair to .agentdoor/secrets/ (mode 600) and prints
// ONLY the public key. The private key never reaches stdout, argv or the repo.
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateKeyPair } from "../packages/core/src/index.js";

const dir = join(process.cwd(), ".agentdoor", "secrets");
const privatePath = join(dir, "quote-signing-private.key");
const publicPath = join(dir, "quote-signing-public.key");
const FILE_MODE = 0o600;

if (existsSync(privatePath) && !process.argv.includes("--force")) {
  console.error(
    "A signing key already exists. Re-run with --force to replace it (this invalidates every launch record and open quote).",
  );
  process.exit(1);
}

mkdirSync(dir, { recursive: true, mode: 0o700 });
const { privateKey, publicKey } = generateKeyPair();
for (const [path, value] of [[privatePath, privateKey], [publicPath, publicKey]] as const) {
  writeFileSync(path, `${value}\n`, { mode: FILE_MODE });
  chmodSync(path, FILE_MODE); // writeFile's mode is ignored when the file already exists
}
console.log(`QUOTE_SIGNING_PUBLIC_KEY=${publicKey}`);
