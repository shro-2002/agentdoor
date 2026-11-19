import { html, icon, type SafeHtml } from "@agentdoor/ui";
import type { LaunchState } from "../db/launch-state.js";
import { recordedRunFigures } from "../services/figures.js";

/** The characters of the policy fingerprint shown to people; the whole hash is in the signed record. */
export const HASH_PREFIX_CHARS = 12;

/** The shop's rules page. */
export const HOW_WE_WORK_PATH = "/how-we-work";

/**
 * What a visitor may be told about how the rules were checked. `signed` comes only from the launch record
 * the shop verified at startup; `preview` comes from a draft's own gate in the workspace. No number is typed in.
 */
export type Trust =
  | { kind: "signed"; checks: number; passed: number; approved: number; required: number; hashPrefix: string; signedAt: string; policyVersion: number }
  | { kind: "preview"; rehearsed: boolean; checks: number };

export function trustOfLaunch(launch: LaunchState): Extract<Trust, { kind: "signed" }> | null {
  if (!launch.launched) return null;
  const run = recordedRunFigures(launch.record);
  const { approvals } = launch.record;
  return {
    kind: "signed",
    checks: run.checks,
    passed: run.passed,
    approved: approvals.approved,
    required: approvals.required,
    hashPrefix: launch.policyHash.slice(0, HASH_PREFIX_CHARS),
    signedAt: launch.record.signedAt,
    policyVersion: launch.record.policyVersion,
  };
}

export const badgeWords = (trust: Trust): string =>
  trust.kind === "signed" ? `Rehearsed before launch · ${trust.checks} checks · rules approved by the owner` : `Rehearsed · ${trust.checks} checks`;

/** The small badge in the hero. A draft that has not passed its gate shows none (the preview bar says so instead). */
export function trustBadge(trust: Trust | null, href: string): SafeHtml {
  if (!trust || (trust.kind === "preview" && !trust.rehearsed)) return html``;
  return html`<p class="hero__trust"><a class="trust-badge" href="${href}">${icon("check")}<span>${badgeWords(trust)}</span></a></p>`;
}

/** The same summary for AI shoppers in /.well-known/agentdoor.json. Every value comes from the signed record. */
export function wellKnownTrust(launch: LaunchState): object | null {
  const t = trustOfLaunch(launch);
  if (!t) return null;
  return {
    rehearsedBeforeLaunch: true,
    checks: t.checks,
    checksPassed: t.passed,
    rulesApproved: t.approved,
    rulesRequired: t.required,
    policyHashPrefix: t.hashPrefix,
    signedAt: t.signedAt,
    signatureVerifiedAtStartup: true,
    rulesUrl: HOW_WE_WORK_PATH,
  };
}
