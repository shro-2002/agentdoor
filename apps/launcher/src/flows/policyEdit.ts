import { BusinessPolicySchema, policyHash, type BusinessPolicy, type RuleProvenance } from "@agentdoor/core";
import { now } from "../claude/clock.js";
import { HTTP_NOT_FOUND, LauncherError, validationFailed } from "../claude/errors.js";
import type { Session } from "../store/fsStore.js";
import type { Deps } from "./compile.js";
import { getAt } from "./paths.js";

const READBACK_MAX = 500;
const NOT_COMPILED_STATUS = 409;

export interface Latest {
  session: Session;
  version: number;
  policy: BusinessPolicy;
}

/** The newest policy version of a session. */
export function latestPolicy(deps: Deps, sessionId: string): Latest {
  const session = deps.store.getSession(sessionId);
  const version = deps.store.latestVersion(sessionId);
  if (version === 0)
    throw new LauncherError("NOT_COMPILED", "Compile the description first.", NOT_COMPILED_STATUS);
  return { session, version, policy: deps.store.readPolicy(sessionId, version) };
}

export const unknownRule = (path: string): LauncherError =>
  new LauncherError("RULE_NOT_FOUND", `No rule "${path.slice(0, 80)}" in this policy.`, HTTP_NOT_FOUND);

export const approvedNow = (): string => now().toISOString();

/** Marks one provenance entry approved, keeping its source, read-back and confidence. */
export function approve(prov: RuleProvenance): RuleProvenance {
  return { ...prov, status: "approved", approvedAt: approvedNow() };
}

export const clipReadback = (text: string): string => text.slice(0, READBACK_MAX);

/** Coverage direction (b): provenance for a path that no longer exists (e.g. `rush.*` after "no rush") is dropped. */
export function pruneOrphans(policy: BusinessPolicy): void {
  for (const path of Object.keys(policy.provenance)) if (!getAt(policy, path).found) delete policy.provenance[path];
}

/**
 * Validates the edited policy against the strict domain schema and stores it as the next version.
 * `meta` is the audit record (what changed and why). Its `result` keeps the clarify code, which
 * reads the newest compile file, from tripping over an edit version.
 */
export function commitVersion(deps: Deps, sessionId: string, next: BusinessPolicy, meta: Record<string, unknown>): number {
  pruneOrphans(next);
  const sorted = Object.fromEntries(Object.entries(next.provenance).sort(([a], [b]) => a.localeCompare(b)));
  const parsed = BusinessPolicySchema.safeParse({ ...next, provenance: sorted });
  if (!parsed.success)
    throw validationFailed(
      `The change makes the policy invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300)}`,
    );
  return deps.store.writeVersion(sessionId, parsed.data, {
    ...meta,
    createdAt: now().toISOString(),
    policyHash: policyHash(parsed.data),
    result: { questions: [], missing: [], assumptions: [] },
  });
}
