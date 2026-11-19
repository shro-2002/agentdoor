import { html } from "@agentdoor/ui";
import { icon } from "./icons.js";
import { landShell } from "./land-shell.js";

/** A small standalone page for errors outside a workspace (unknown or foreign draft, rate limits). */
export function messagePage(title: string, text: string): string {
  const main = html`<section class="hero hero--small"><h1 class="hero__title">${title}</h1><p class="hero__lede">${text}</p><p><a class="btn btn--primary" href="/launch">Back to start</a></p></section>`;
  return landShell({ title, hasDrafts: false, main });
}

export interface BusinessLink {
  id: string;
  name: string;
  city: string;
}

/** Every business this browser started, newest first. */
export function businessesPage(list: BusinessLink[]): string {
  const rows = list.map((b) => html`<li><a class="biz" href="/launch/w/${b.id}"><span class="biz__name">${b.name}</span><span class="biz__city">${b.city}</span>${icon("arrow")}</a></li>`);
  const main = html`<section class="hero hero--small"><h1 class="hero__title">My businesses</h1>
    ${list.length === 0 ? html`<p class="hero__lede">Nothing here yet.</p>` : html`<ul class="bizlist">${rows}</ul>`}
    <p><a class="btn btn--primary" href="/launch">Build another</a></p></section>`;
  return landShell({ title: "My businesses · AgentDoor", hasDrafts: false, main });
}
