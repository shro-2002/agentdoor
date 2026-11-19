import { html, icon, type SafeHtml } from "@agentdoor/ui";
import { layout } from "../layout.js";
import { personaNote } from "../persona.js";
import { REPO_URL } from "../site.js";
import { rehearsalPanel } from "./rehearsal.js";
import type { LaunchStory } from "./story.js";

/** The exact opening line of the page; the e2e and unit tests quote it. */
export const LAUNCH_HEADLINE = "Don't just launch your business. Rehearse it before your first customer arrives.";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

interface Step {
  name: string;
  text: string;
}

/** Real counts from the recorded launch when we have them; plain wording when the session is missing. */
function flow(s: LaunchStory | null): Step[] {
  return [
    { name: "Describe", text: "Tell AgentDoor about the business the way you would tell a friend: in English, Hindi or Hinglish." },
    { name: "Clarify", text: s ? `It asked ${plural(s.questionsAsked, "question", "questions")} about what was missing.` : "It asks only about what you left out." },
    { name: "Review business rules", text: s ? `${s.rulesWritten} rules written down, each next to your own words, for you to approve.` : "Every rule is written down next to your own words, for you to approve." },
    { name: "Rehearse", text: s ? `${s.first.checks} checks and awkward customers run against the rules before anyone real arrives.` : "Boundary dates, full days and awkward customers run against the rules." },
    { name: "Resolve", text: s ? `${plural(s.corrections.length, "decision", "decisions")} by the owner until no critical gap was left.` : "You fix or accept each gap until none is critical." },
    { name: "Launch", text: "The shop opens only when every required rule is approved and nothing critical is open." },
  ];
}

function hero(s: LaunchStory | null, repoUrl: string): SafeHtml {
  return html`<section class="ad-hero" aria-labelledby="launch-h">
    <div class="wrap ad-hero__grid">
      <div>
        <p class="ad-eyebrow">Launch platform for small businesses</p>
        <h1 id="launch-h" class="ad-hero__title">${LAUNCH_HEADLINE}</h1>
        <p class="ad-hero__lead">AgentDoor turns what you say about your business into rules you approve, then tests those rules with awkward, realistic customers, so the gaps show up before a customer finds them.</p>
        <p class="ad-cta">
          <a class="btn btn--primary btn--lg" href="/try">Walk through the real launch session <span aria-hidden="true">→</span></a>
          <a class="btn btn--secondary btn--lg" href="/launch-report">See the launch report</a>
          ${repoUrl ? html`<a class="btn btn--ghost btn--lg" href="${repoUrl}" rel="noopener">Source code</a>` : ""}
        </p>
        <p class="ad-honest">${icon("check")}<span>What you can open here is a recorded real launch, made with live Claude. The interactive live launcher is coming next.</span></p>
      </div>
      ${s
        ? html`<aside class="ad-hero__card" aria-label="Before and after the rehearsal">
            <p class="ad-hero__card-t">One real launch, before and after</p>
            <p class="ad-hero__pair"><span><strong>${s.first.gaps.critical}</strong> critical gaps<br>first rehearsal</span><span class="ad-hero__arrow" aria-hidden="true">→</span><span><strong>${s.final.gaps.open}</strong> open<br>at launch</span></p>
          </aside>`
        : ""}
    </div>
  </section>`;
}

function flowSection(s: LaunchStory | null): SafeHtml {
  return html`<section class="ad-flow" id="flow" aria-labelledby="flow-h">
    <div class="wrap">
      <p class="ad-eyebrow">How it works</p>
      <h2 id="flow-h">Six steps from your words to an open shop</h2>
      <ol class="ad-steps">${flow(s).map((st, i) => html`<li class="ad-step ${st.name === "Rehearse" ? "ad-step--key" : ""}"><span class="ad-step__n" aria-hidden="true">${i + 1}</span><h3>${st.name}</h3><p>${st.text}</p></li>`)}</ol>
    </div>
  </section>`;
}

const HONEST = [
  { badge: "RECORDED", title: "Real, and recorded", text: "The launch you can walk through was made with live Claude, for an illustrative home-bakery persona. What you see is the recording of that run." },
  { badge: "LIVE", title: "Checked again on every page load", text: "The rule checks on the rehearsal and on the walk-through run now, in plain code with no AI in the loop, so the numbers cannot be talked into anything." },
  { badge: "NEXT", title: "The live launcher is coming next", text: "Launching your own business from your own words is the next step. It is not live on this site today." },
];

function honesty(): SafeHtml {
  return html`<section class="ad-honest-band" aria-labelledby="honest-h">
    <div class="wrap">
      <h2 id="honest-h">What is real today</h2>
      <ul class="ad-cards">${HONEST.map((h) => html`<li class="ad-card"><p class="ad-tag">${h.badge}</p><h3>${h.title}</h3><p>${h.text}</p></li>`)}</ul>
    </div>
  </section>`;
}

function closing(repoUrl: string): SafeHtml {
  return html`<section class="ad-close" aria-labelledby="close-h">
    <div class="wrap">
      <h2 id="close-h">See it for yourself</h2>
      <p class="ad-cta">
        <a class="btn btn--primary btn--lg" href="/try">Walk through the real launch session <span aria-hidden="true">→</span></a>
        <a class="btn btn--secondary btn--lg" href="/launch-report">See the launch report</a>
        ${repoUrl ? html`<a class="btn btn--ghost btn--lg" href="${repoUrl}" rel="noopener">Source code</a>` : ""}
      </p>
      ${personaNote()}
    </div>
  </section>`;
}

export function launchPage(story: LaunchStory | null, repoUrl: string = REPO_URL): string {
  const body = html`${hero(story, repoUrl)}${flowSection(story)}${rehearsalPanel(story)}${honesty()}${closing(repoUrl)}`;
  return layout({
    title: "Rehearse your business before your first customer arrives",
    body,
    chrome: "agentdoor",
    styles: ["agentdoor-launch.css"],
    active: "launch",
    repoUrl,
    description: "AgentDoor turns what a business owner says into approved rules, then rehearses awkward customers against them before launch. A recorded real launch you can walk through.",
  });
}
