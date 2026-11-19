import { PolicyDraftWireSchema } from "@agentdoor/core";
import { outputSchemaFor } from "../claude/schema.js";
import { renderDefaults } from "../flows/template.js";
import { COMPILE_PROMPT_TEMPLATE, SCENARIOS_PROMPT } from "./texts.js";

let cached: string | null = null;

/** Static scenarios system prompt; the policy summary and the owner's words go in the user turn. */
export const scenariosSystemPrompt = (): string => SCENARIOS_PROMPT;

/**
 * Static compile system prompt (frozen so the prompt-cache prefix never changes). It carries no
 * date: today's date goes in the user turn. The .md sources are embedded in texts.ts so the same
 * code runs inside the deployed shop bundle.
 */
export function compileSystemPrompt(): string {
  cached ??= COMPILE_PROMPT_TEMPLATE
    .replace("{{POLICY_DRAFT_SCHEMA}}", () => JSON.stringify(outputSchemaFor(PolicyDraftWireSchema)))
    .replace("{{TEMPLATE_DEFAULTS}}", () => renderDefaults());
  return cached;
}
