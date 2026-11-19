import { html, type SafeHtml } from "@agentdoor/ui";
import { icon } from "./icons.js";
import { notice, type Tone } from "./kit.js";
import { landShell } from "./land-shell.js";

const ACCESS_PATH = "/launch/access";

const codeField = (autofocus: boolean): SafeHtml =>
  html`<div class="field"><label for="code">Access code</label><input id="code" class="input" type="password" name="code" autocomplete="off" required${autofocus ? html` autofocus` : ""}></div>`;

/** The early-access dialog. Without JavaScript it stays closed and the server renders the same step as a page. */
export function accessDialog(): SafeHtml {
  return html`<dialog class="gate" id="access-dialog" aria-labelledby="gate-title" data-gate>
    <form method="post" action="${ACCESS_PATH}" class="gate__form">
      <input type="hidden" name="description" value="" data-gate-description>
      <span class="gate__icon">${icon("lock")}</span>
      <h2 id="gate-title" class="gate__title">Early access</h2>
      <p class="gate__lede">AgentDoor is open to early testers. Enter your access code and we'll start building right away.</p>
      ${codeField(true)}
      <div class="gate__actions"><button class="btn btn--quiet" type="button" data-gate-close>Cancel</button><button class="btn btn--primary" type="submit">Continue</button></div>
    </form>
  </dialog>`;
}

export interface AccessStep {
  description: string;
  flash: { tone: Tone; text: string } | null;
}

/** The same step as a full page: the pending description travels in this POST, never in a URL. */
export function accessStepPage(o: AccessStep): string {
  const main = html`<section class="gate gate--page">
    <form method="post" action="${ACCESS_PATH}" class="gate__form">
      <input type="hidden" name="description" value="${o.description}">
      <span class="gate__icon">${icon("lock")}</span>
      <h1 class="gate__title">Early access</h1>
      <p class="gate__lede">AgentDoor is open to early testers. Enter your access code and we'll start building right away.</p>
      ${o.flash ? notice(o.flash.tone, o.flash.text) : ""}
      <blockquote class="gate__quote">${o.description}</blockquote>
      ${codeField(false)}
      <div class="gate__actions"><a class="btn btn--quiet" href="/launch">Back</a><button class="btn btn--primary" type="submit">Continue</button></div>
    </form>
  </section>`;
  return landShell({ title: "Early access · AgentDoor", hasDrafts: false, main });
}
