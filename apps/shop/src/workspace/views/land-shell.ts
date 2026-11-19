import { html, type SafeHtml } from "@agentdoor/ui";
import { brand, pageDocument } from "./kit.js";

export interface LandOptions {
  title: string;
  main: SafeHtml;
  hasDrafts: boolean;
}

/** The frame of every page outside a workspace: a quiet top bar, the content, one line of footer. */
export function landShell(o: LandOptions): string {
  const body = html`<div class="land">
    <header class="land__top">${brand("/launch")}${o.hasDrafts ? html`<a class="quiet-link" href="/launch/mine">My businesses</a>` : ""}</header>
    <main id="main" class="land__main" tabindex="-1">${o.main}</main>
    <footer class="land__foot">Built with Claude · Hosted on GoDaddy</footer>
  </div>`;
  return pageDocument({ title: o.title, body, bodyClass: "is-land" });
}
