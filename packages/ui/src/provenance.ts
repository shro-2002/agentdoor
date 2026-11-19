import { html, type SafeHtml } from "./html.js";
import { icon, type IconName } from "./icons.js";

/**
 * The three provenance badges (06 S8). Icon + words, never colour alone: a reader who cannot tell
 * saffron from leaf still reads "RECORDED" or "LIVE".
 */
export type Provenance = "claude" | "live" | "deploy";

const BADGES: Record<Provenance, { icon: IconName; text: string; says: string }> = {
  claude: { icon: "quote", text: "RECORDED · Claude", says: "Claude’s real output, saved from an earlier run" },
  live: { icon: "pulse", text: "LIVE · deterministic", says: "Computed now by AgentDoor’s rule engine. No AI involved." },
  deploy: { icon: "server", text: "RECORDED · deployment evidence", says: "A real GoDaddy deployment, saved from the launch" },
};

export const PROVENANCE_ORDER: Provenance[] = ["claude", "live", "deploy"];

export interface ProvenanceBadgeProps {
  kind: Provenance;
  /** Replaces the default one-line meaning, e.g. "recorded 19 Nov 2026 · sonnet · 4.2 s · $0.04". */
  note?: string;
}

export function provenanceBadge(p: ProvenanceBadgeProps): SafeHtml {
  const b = BADGES[p.kind];
  return html`<p class="prov prov--${p.kind}">
    <span class="prov__tag">${icon(b.icon)}<span>${b.text}</span></span>
    <span class="prov__note">${p.note ?? b.says}</span>
  </p>`;
}
