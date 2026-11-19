import { html } from "@agentdoor/ui";
import { LIMITS } from "../config.js";
import { brand, notice, pageDocument, type Tone } from "./kit.js";

export const CLOSED_HEADING = "Workspace is closed";

export interface StartOptions {
  closed: boolean;
  flash?: { tone: Tone; text: string } | null;
  /** Re-fills the form after a refused submit. */
  description?: string;
}

/** /launch: one question, one box. */
export function startPage(o: StartOptions): string {
  const form = html`<form method="post" action="/launch" class="start__form" data-start>
      <h1 class="start__title">What business are you dreaming of?</h1>
      <p class="start__lede">Tell me in English, Hindi or Hinglish: what you sell, where, and how you work.</p>
      <div class="field">
        <label class="sr-only" for="description">Describe your business</label>
        <textarea id="description" class="input input--area input--big" name="description" rows="6" maxlength="${LIMITS.maxDescriptionChars}" required placeholder="Example: I bake eggless cakes at home in Indiranagar, Bengaluru. Pickup only, a cake takes two days.">${o.description ?? ""}</textarea>
        <p class="count" data-count="${LIMITS.maxDescriptionChars}" aria-hidden="true"></p>
      </div>
      <div class="start__row">
        <div class="field field--code"><label for="code">Access code</label><input id="code" class="input" type="password" name="code" autocomplete="off" required></div>
        <button class="btn btn--primary btn--lg" type="submit">Create my business</button>
      </div>
    </form>`;
  const closed = html`<div class="start__form"><h1 class="start__title">${CLOSED_HEADING}</h1><p class="start__lede">New businesses cannot be created right now. Please check back later.</p></div>`;
  const body = html`<div class="start">
    <header class="start__top">${brand("/launch")}</header>
    <main id="main" class="start__main" tabindex="-1">${o.flash ? notice(o.flash.tone, o.flash.text) : ""}${o.closed ? closed : form}</main>
    <footer class="start__foot"><span>Diagnostics</span><a href="/launch-report">Launch report</a><a href="/try">Recorded walk-through</a></footer>
  </div>`;
  return pageDocument({ title: o.closed ? CLOSED_HEADING : "AgentDoor", body, bodyClass: "is-start" });
}

/** A small standalone page for errors outside a workspace (unknown or foreign draft, rate limits). */
export function messagePage(title: string, text: string): string {
  const body = html`<div class="start">
    <header class="start__top">${brand("/launch")}</header>
    <main id="main" class="start__main" tabindex="-1"><div class="start__form"><h1 class="start__title">${title}</h1><p class="start__lede">${text}</p><p><a class="btn btn--primary" href="/launch">Back to start</a></p></div></main>
  </div>`;
  return pageDocument({ title, body, bodyClass: "is-start" });
}
