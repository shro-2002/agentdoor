import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/**
 * Makes ANTHROPIC_API_KEY available to the SDK for live/record runs by loading `.env.local` into
 * process.env. The key is never read into a variable here, returned, logged or put in an error;
 * the SDK picks it up from the environment itself. Returns whether a key is now present.
 */
export function loadRuntimeEnv(envFile: string = path.join(REPO_ROOT, ".env.local")): boolean {
  if (!process.env.ANTHROPIC_API_KEY) {
    try {
      process.loadEnvFile(envFile);
    } catch {
      // No file is fine: the key may come from the real environment.
    }
  }
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
