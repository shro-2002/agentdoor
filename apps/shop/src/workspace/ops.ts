import { policyHash, type BusinessPolicy } from "@agentdoor/core";
import { LauncherError } from "../../../launcher/src/claude/errors.js";
import { DISMISS, patchedPolicy } from "../../../launcher/src/flows/gapFix.js";
import { EditError, finishEdit } from "./edit.js";
import { recordRun, rehearseNow, scenariosFit } from "./flows.js";
import type { DraftState } from "./state.js";

/**
 * Stores an edited policy as the next version. If a rehearsal has already run and its customer
 * scenarios still fit the menu, the free deterministic checks re-run at once, so the numbers the
 * owner sees always describe the rules they have now. Otherwise the old run stays and is marked stale.
 */
export function commitPolicy(state: DraftState, next: BusinessPolicy, nowMs: number): boolean {
  if (state.policy && policyHash(state.policy) === policyHash(next)) return false;
  state.policy = next;
  state.policyVersion += 1;
  if (state.run && scenariosFit(state, next)) recordRun(state, rehearseNow(state, nowMs));
  return true;
}

/** Applies one of the typed fixes on an issue card (the launcher's own fix catalogue). */
export function applyFix(state: DraftState, gapId: string, choice: string, value: number | undefined, nowMs: number): void {
  const gap = state.run?.gaps.find((g) => g.id === gapId);
  const policy = state.policy;
  if (!gap || !policy) throw new EditError("That item is not in the latest check. Run the checks again.");
  const from = state.policyVersion;
  let next: BusinessPolicy;
  try {
    next = finishEdit(patchedPolicy(policy, gap, choice, value, state.language ?? "en"));
  } catch (e) {
    if (e instanceof LauncherError) throw new EditError(e.message);
    throw e;
  }
  if (choice === DISMISS) state.dismissals.push({ gapId, version: from, at: new Date(nowMs).toISOString() });
  commitPolicy(state, next, nowMs);
  state.fixes.push({ gapId, code: gap.code, severity: gap.severity, choice, fromVersion: from, toVersion: state.policyVersion, at: new Date(nowMs).toISOString() });
  // A dismissal changes the gap list even when the policy did not change.
  if (choice === DISMISS && state.run && scenariosFit(state, next)) recordRun(state, rehearseNow(state, nowMs));
}
