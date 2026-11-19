import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PolicyDraftWireSchema } from "@agentdoor/core";
import { outputSchemaFor } from "../claude/schema.js";
import { renderDefaults } from "../flows/template.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let cached: string | null = null;
let cachedScenarios: string | null = null;

/** Static scenarios system prompt; the policy summary and the owner's words go in the user turn. */
export function scenariosSystemPrompt(): string {
  cachedScenarios ??= readFileSync(path.join(HERE, "scenarios.md"), "utf8");
  return cachedScenarios;
}

/**
 * Static compile system prompt (frozen so the prompt-cache prefix never changes). It carries no
 * date: today's date goes in the user turn.
 */
export function compileSystemPrompt(): string {
  cached ??= readFileSync(path.join(HERE, "compile.md"), "utf8")
    .replace("{{POLICY_DRAFT_SCHEMA}}", () => JSON.stringify(outputSchemaFor(PolicyDraftWireSchema)))
    .replace("{{TEMPLATE_DEFAULTS}}", () => renderDefaults());
  return cached;
}
