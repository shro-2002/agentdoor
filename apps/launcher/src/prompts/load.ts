import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDefaults } from "../flows/template.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let cached: string | null = null;

/**
 * Static compile system prompt (frozen so the prompt-cache prefix never changes). It carries no
 * date: today's date goes in the user turn.
 */
export function compileSystemPrompt(): string {
  cached ??= readFileSync(path.join(HERE, "compile.md"), "utf8").replace(
    "{{TEMPLATE_DEFAULTS}}",
    renderDefaults(),
  );
  return cached;
}
