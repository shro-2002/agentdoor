import { gapCategory, type GapCategory, type GapCode } from "@agentdoor/core";
import { html, type SafeHtml } from "@agentdoor/ui";
import type { Readiness } from "../readiness.js";
import type { DraftState } from "../state.js";

/** The categories that keep publishing locked. Customer mismatches are the owner's call and do not move the ring. */
const BLOCKING: GapCategory[] = ["policy", "approval", "engine"];
const FULL = 100;
const RADIUS = 44;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * How much of what the rehearsal ever raised is settled now: raised-and-closed over raised, from the
 * real gaps. Null until a rehearsal has run. It reaches 100 only when publishing is unlocked.
 */
export function settledPercent(state: DraftState, ready: Readiness): number | null {
  const run = state.run;
  if (!run) return null;
  // `seenGaps` stores codes as plain strings; they were written from real gaps, so they are gap codes.
  const blocking = (code: string): boolean => BLOCKING.includes(gapCategory(code as GapCode));
  const open = run.gaps.filter((g) => !g.dismissed && blocking(g.code)).length;
  const raised = Object.values(state.seenGaps).filter((g) => blocking(g.code)).length;
  const total = Math.max(raised, open);
  const share = total === 0 ? FULL : Math.floor(((total - open) / total) * FULL);
  return Math.min(share, ready.canPublish ? FULL : FULL - 1);
}

/** A ring with the percentage inside; the dash length is an attribute, so no inline style is needed. */
export function readinessRing(percent: number | null): SafeHtml {
  const filled = ((percent ?? 0) / FULL) * CIRCUMFERENCE;
  const label = percent === null ? "Not rehearsed yet" : `${percent} percent of the way to ready`;
  return html`<div class="ring${percent === FULL ? " is-full" : ""}" role="img" aria-label="${label}">
    <svg viewBox="0 0 100 100" width="104" height="104" aria-hidden="true" focusable="false"><circle class="ring__track" cx="50" cy="50" r="${RADIUS}" fill="none" stroke-width="7"/><circle class="ring__fill" cx="50" cy="50" r="${RADIUS}" fill="none" stroke-width="7" stroke-linecap="round" stroke-dasharray="${filled.toFixed(1)} ${CIRCUMFERENCE.toFixed(1)}" transform="rotate(-90 50 50)"/></svg>
    <span class="ring__text" aria-hidden="true">${percent === null ? "–" : `${percent}%`}</span>
  </div>`;
}
