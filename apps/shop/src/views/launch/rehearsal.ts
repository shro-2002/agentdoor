import { html, icon, provenanceBadge, type SafeHtml } from "@agentdoor/ui";
import { isoDay } from "../format.js";
import type { LaunchStory } from "./story.js";

/** The centerpiece of /launch: first run, gaps found, the owner's corrections, final run. Every number comes from the story. */

const MAX_GAP_CARDS = 4;
const plural = (n: number): string => `${n} ${n === 1 ? "call" : "calls"}`;

const figure = (n: number, label: string, tone: "bad" | "good"): SafeHtml =>
  html`<p class="figure figure--${tone}"><strong class="figure__n">${n}</strong><span class="figure__l">${label}</span></p>`;

function firstRun(s: LaunchStory): SafeHtml {
  return html`<article class="stage stage--first" aria-labelledby="stage-first-h">
    <p class="stage__tag">First rehearsal</p>
    <h3 id="stage-first-h" class="visually-hidden">The first rehearsal run</h3>
    ${figure(s.first.gaps.critical, "critical gaps on the first rehearsal run, before anything was fixed", "bad")}
    <p class="stage__facts">${s.first.checks} checks run, ${s.first.passed} passed. The rules were exactly as first written down.</p>
    ${provenanceBadge({ kind: "live", note: `Recomputed when you loaded this page, on ${s.first.basis.split(",")[0]}.` })}
  </article>`;
}

function gapCards(s: LaunchStory): SafeHtml {
  const shown = s.gaps.slice(0, MAX_GAP_CARDS);
  return html`<article class="stage stage--gaps" aria-labelledby="stage-gaps-h">
    <p class="stage__tag">What it found</p>
    <h3 id="stage-gaps-h" class="stage__title">What would have gone wrong</h3>
    <ul class="gaplist">${shown.map((g) => html`<li class="gapitem">
      <p class="gapitem__title">${icon("alert")}<span>${g.title}${g.count > 1 ? html` <span class="gapitem__count">×${g.count}</span>` : ""}</span></p>
      <p>${g.consequence}</p>
    </li>`)}</ul>
    ${s.waitingForOwner > 0 ? html`<p class="stage__facts">Plus ${s.waitingForOwner} more critical gaps that only meant a rule was still waiting for the owner's OK.</p>` : ""}
  </article>`;
}

function corrections(s: LaunchStory): SafeHtml {
  return html`<article class="stage stage--fix" aria-labelledby="stage-fix-h">
    <p class="stage__tag">The owner's corrections</p>
    <h3 id="stage-fix-h" class="stage__title">${s.approvals.approved} of ${s.approvals.required} required rules approved, and these decisions made</h3>
    ${s.corrections.length > 0
      ? html`<ol class="fixlist">${s.corrections.map((c) => html`<li><span class="fixlist__what">${c.title}</span><span class="fixlist__how">${c.decision}</span><span class="fixlist__v">v${c.toVersion}</span></li>`)}</ol>`
      : html`<p class="stage__facts">The owner approved the rules as written.</p>`}
    ${provenanceBadge({ kind: "claude", note: "The owner's real decisions, saved from the recorded launch." })}
  </article>`;
}

function finalRun(s: LaunchStory): SafeHtml {
  return html`<article class="stage stage--final" aria-labelledby="stage-final-h">
    <p class="stage__tag">Final rehearsal</p>
    <h3 id="stage-final-h" class="visually-hidden">The final rehearsal run</h3>
    ${figure(s.final.gaps.open, "gaps still open when the shop launched", "good")}
    <p class="stage__facts">${s.final.checks} checks run, ${s.final.passed} passed.</p>
    ${provenanceBadge(s.finalIsSigned
      ? { kind: "deploy", note: "Read from the signed launch record that this live shop runs on." }
      : { kind: "live", note: "Recomputed when you loaded this page." })}
  </article>`;
}

export function rehearsalPanel(story: LaunchStory | null): SafeHtml {
  const body = story
    ? html`<div class="stages">${firstRun(story)}${finalRun(story)}${gapCards(story)}${corrections(story)}</div>`
    : html`<p class="ad-note" role="note">${icon("clock")}<span>The recorded launch session is not available on this server right now. The walk-through and the report explain the same story.</span></p>`;
  return html`<section class="ad-rehearsal" id="rehearsal" aria-labelledby="rehearsal-h">
    <div class="wrap">
      <p class="ad-eyebrow">The centerpiece</p>
      <h2 id="rehearsal-h">What the rehearsal caught before a customer could</h2>
      <p class="ad-lead">This is a recorded real launch of Meera's Kitchen, made with live Claude. Here is what the rehearsal did to it, with the real numbers.</p>
      ${story ? html`<p class="ad-meta">Recorded ${isoDay(story.recordedAt)} with ${story.model}${story.modelCalls > 0 ? ` · ${plural(story.modelCalls)} to the model` : ""}.</p>` : ""}
      ${body}
    </div>
  </section>`;
}
