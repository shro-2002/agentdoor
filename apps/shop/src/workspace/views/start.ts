import { html, type SafeHtml } from "@agentdoor/ui";
import { LIMITS } from "../config.js";
import { accessDialog } from "./access-view.js";
import { EXAMPLES } from "./examples.js";
import { icon, type IconName } from "./icons.js";
import { notice, type Tone } from "./kit.js";
import { landShell } from "./land-shell.js";

export { accessStepPage } from "./access-view.js";
export { businessesPage, messagePage } from "./simple-pages.js";

export const CLOSED_HEADING = "Workspace is closed";

export interface StartOptions {
  closed: boolean;
  flash: { tone: Tone; text: string } | null;
  /** Fills the composer: after a refused submit, or from `?example=N`. */
  description?: string;
  /** This browser already owns drafts, so the quiet "My businesses" link shows. */
  hasDrafts: boolean;
  /** This browser holds a valid early-access session, so Build goes straight through. */
  earlyAccess: boolean;
}

const STEPS: { icon: IconName; name: string; line: string }[] = [
  { icon: "build", name: "Build", line: "Your words become rules" },
  { icon: "rehearse", name: "Rehearse", line: "Tough customers test them" },
  { icon: "launch", name: "Launch", line: "Share your storefront" },
];

const pills = (): SafeHtml =>
  html`<ul class="pills" aria-label="Start from an example">${EXAMPLES.map((e, i) => html`<li><a class="pill" href="/launch?example=${i + 1}" data-example="${e.text}">${e.label}</a></li>`)}</ul>`;

const flow = (): SafeHtml =>
  html`<ol class="flow" aria-label="How it works">${STEPS.map((s, i) => html`<li class="flow__step">${icon(s.icon)}<span class="flow__text"><strong>${s.name}</strong><span>${s.line}</span></span>${i < STEPS.length - 1 ? icon("arrow", "flow__arrow") : ""}</li>`)}</ol>`;

function composer(o: StartOptions): SafeHtml {
  return html`<form method="post" action="/launch" class="composer" data-composer data-access="${o.earlyAccess ? "ok" : "needed"}">
    <label class="sr-only" for="description">Describe your business</label>
    <textarea id="description" class="composer__input" name="description" rows="5" maxlength="${LIMITS.maxDescriptionChars}" required placeholder="Tell me about your business: what you sell, where, and how you work.">${o.description ?? ""}</textarea>
    <div class="composer__bar">
      <p class="composer__meta"><span>English, Hindi or Hinglish</span><span class="count" data-count="${LIMITS.maxDescriptionChars}" aria-hidden="true"></span></p>
      <button class="btn btn--primary btn--lg" type="submit"><span class="btn__label">Build my business</span>${icon("arrow")}<kbd class="kbd" aria-hidden="true" data-shortcut>Ctrl ↵</kbd></button>
    </div>
  </form>`;
}

/** /launch: a headline, a prompt composer, a few examples. */
export function startPage(o: StartOptions): string {
  if (o.closed) {
    const closed = html`<section class="hero"><h1 class="hero__title">${CLOSED_HEADING}</h1><p class="hero__lede">New businesses cannot be created right now. Please check back later.</p></section>`;
    return landShell({ title: CLOSED_HEADING, hasDrafts: false, main: closed });
  }
  const main = html`<section class="hero">
      <p class="hero__tag">${icon("sparkle")}Early access</p>
      <h1 class="hero__title">Turn the business in your head into a shop that's ready for its first customer.</h1>
      <p class="hero__lede">Describe it in your own words. AgentDoor builds the rules, rehearses tough customers, and launches your storefront.</p>
    </section>
    ${o.flash ? notice(o.flash.tone, o.flash.text) : ""}
    ${composer(o)}
    ${pills()}
    ${flow()}
    ${o.earlyAccess ? "" : accessDialog()}`;
  return landShell({ title: "AgentDoor: build, rehearse, launch", hasDrafts: o.hasDrafts, main });
}

