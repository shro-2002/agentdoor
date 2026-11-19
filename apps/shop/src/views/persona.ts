import { html, type SafeHtml } from "@agentdoor/ui";

/** Honesty label (planning/11 §1): the bundled shop is an illustrative persona. Change or empty it here only. */
export const PERSONA_NOTE = "Illustrative persona based on common home-bakery practices.";

/** A calm one-line note; renders nothing when the constant is empty. */
export function personaNote(): SafeHtml {
  return PERSONA_NOTE ? html`<p class="persona-note">${PERSONA_NOTE}</p>` : html``;
}
