import { html, icon, raw, type SafeHtml } from "@agentdoor/ui";

/** Which AgentDoor page is open, for the header's current-page mark. */
export type AgentDoorNav = "launch" | "try" | "report";

const NAV: { key: AgentDoorNav; href: string; label: string }[] = [
  { key: "launch", href: "/launch", label: "Workspace" },
  { key: "try", href: "/try", label: "Walk-through" },
  { key: "report", href: "/launch-report", label: "Launch report" },
];

export const adBrand = (): SafeHtml => html`<a class="ad-brand" href="/launch"><span class="ad-brand__mark">${icon("door")}</span><span>AgentDoor</span></a>`;

export function agentDoorHeader(active: AgentDoorNav | undefined): SafeHtml {
  return html`<header class="ad-head">
    <div class="wrap ad-head__row">
      ${adBrand()}
      <nav class="ad-nav" aria-label="Main">
        <ul>
          ${NAV.map((n) => html`<li><a href="${n.href}"${n.key === active ? raw(' aria-current="page"') : raw("")}>${n.label}</a></li>`)}
        </ul>
      </nav>
    </div>
  </header>`;
}

export function agentDoorFooter(repoUrl: string): SafeHtml {
  return html`<footer class="ad-foot">
    <div class="wrap ad-foot__row">
      <div>
        <p class="ad-foot__name">AgentDoor</p>
        <p>Diagnostics: a recorded launch of an illustrative bakery, kept so its numbers can be checked.</p>
      </div>
      <ul class="ad-foot__links">
        <li><a href="/launch">Open the workspace</a></li>
        <li><a href="/try">Walk through the launch</a></li>
        <li><a href="/launch-report">Launch report</a></li>
        <li><a href="/">See the shop it launched</a></li>
        ${repoUrl ? html`<li><a href="${repoUrl}" rel="noopener">Source code</a></li>` : ""}
      </ul>
    </div>
  </footer>`;
}
