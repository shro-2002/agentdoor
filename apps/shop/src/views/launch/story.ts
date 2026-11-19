import type { LaunchRecord } from "@agentdoor/core";
import { gapTitle, gapWords } from "../gap-words.js";
import { approvalFigures, liveRunFigures, recordedRunFigures, type RunFigures } from "../../services/figures.js";
import { runLive } from "../../services/try-live.js";
import type { TrySession } from "../../services/try-session.js";

/**
 * The numbers behind /launch, all taken from the recorded real launch (`bundle/try/session.json`)
 * through the same figure services /try and the launch report use, so the three pages cannot disagree.
 * Pure function of (session, record, nowMs): no model, no database, no file writes.
 */

export interface GapStory {
  title: string;
  /** What would have gone wrong for the business, in plain words. */
  consequence: string;
  count: number;
}

export interface Correction {
  title: string;
  /** What the owner decided. */
  decision: string;
  toVersion: number;
  accepted: boolean;
}

export interface LaunchStory {
  recordedAt: string;
  model: string;
  modelCalls: number;
  rulesWritten: number;
  questionsAsked: number;
  first: RunFigures;
  final: RunFigures;
  /** True when the final run is read from the signed launch record rather than recomputed. */
  finalIsSigned: boolean;
  /** Gaps about the business rules themselves, one card per kind. */
  gaps: GapStory[];
  /** Rules the first run held back only because nobody had approved or reviewed them yet. */
  waitingForOwner: number;
  corrections: Correction[];
  approvals: { approved: number; required: number };
}

const DISMISS = "dismiss";
/** Gap kinds that only mean "a rule is waiting for the owner": counted, not shown as separate cards. */
const WAITING_CODES = new Set(["UNAPPROVED_RULE", "LOW_CONFIDENCE_SOURCE"]);

const humanize = (s: string): string => {
  const words = s.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** The launcher's fix choices in the owner's terms; an unknown choice falls back to its own name. */
export function decisionWords(choice: string): string {
  const units = /^units-(\d+)$/.exec(choice);
  if (units) return `Set the daily limit to ${units[1]} units`;
  if (choice === "unlisted-refuse") return "Refuse delivery to areas that are not on the list";
  if (choice === "approve") return "Approved the rule as written";
  if (choice === DISMISS) return "Accepted the shop's answer as fine";
  return humanize(choice);
}

const codeOf = (gapId: string): string => gapId.split(":")[0]!;

function gapCards(session: TrySession, nowMs: number): { gaps: GapStory[]; waiting: number } {
  const policy = session.policyVersions[0]!;
  const groups = new Map<string, GapStory>();
  let waiting = 0;
  for (const g of runLive(session, 1, nowMs).gaps.filter((x) => x.severity === "critical")) {
    if (WAITING_CODES.has(g.code)) {
      waiting += 1;
      continue;
    }
    const words = gapWords(g, policy);
    const known = groups.get(words.title);
    if (known) known.count += 1;
    else groups.set(words.title, { title: words.title, consequence: words.body, count: 1 });
  }
  return { gaps: [...groups.values()], waiting };
}

export function buildLaunchStory(session: TrySession, record: LaunchRecord | null, nowMs: number): LaunchStory {
  const last = session.policyVersions.length;
  const { gaps, waiting } = gapCards(session, nowMs);
  const approvals = approvalFigures(session.policyVersions[last - 1]!);
  return {
    recordedAt: session.recordedAt,
    model: session.compile.model,
    modelCalls: session.usage.calls,
    rulesWritten: approvalFigures(session.policyVersions[0]!).listed,
    questionsAsked: session.compile.result.questions.length,
    first: liveRunFigures("First rehearsal run", runLive(session, 1, nowMs)),
    final: record ? recordedRunFigures(record) : liveRunFigures("Final rehearsal run", runLive(session, last, nowMs)),
    finalIsSigned: record !== null,
    gaps,
    waitingForOwner: waiting,
    corrections: session.gapFixes.map((f) => ({
      title: gapTitle(codeOf(f.gapId)),
      decision: decisionWords(f.choice),
      toVersion: f.toVersion,
      accepted: f.choice === DISMISS,
    })),
    approvals: { approved: approvals.approvedRequired, required: approvals.required },
  };
}
