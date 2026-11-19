import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { HTTP_TOO_MANY, LauncherError } from "./errors.js";
import type { Usage } from "./pricing.js";

export interface UsageRow {
  at: string;
  sessionId: string;
  flow: string;
  fixtureId: string;
  model: string;
  mode: string;
  attempt: number;
  usage: Usage;
  costUsd: number;
}

export const DEFAULT_MAX_USD_PER_SESSION = 1.5;
export const DEFAULT_MAX_USD_TOTAL = 8;

/** Append-only spend log; it is the single source of truth for the budget guard, so it survives restarts. */
export class UsageLog {
  constructor(readonly file: string) {}

  append(row: UsageRow): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    appendFileSync(this.file, `${JSON.stringify(row)}\n`);
  }

  rows(): UsageRow[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as UsageRow);
  }

  sessionSpend(sessionId: string): number {
    return sum(this.rows().filter((r) => r.sessionId === sessionId));
  }

  totalSpend(): number {
    return sum(this.rows());
  }
}

const sum = (rows: UsageRow[]): number => rows.reduce((t, r) => t + r.costUsd, 0);
const fmt = (usd: number): string => `$${usd.toFixed(4)}`;

export class BudgetGuard {
  constructor(
    private readonly log: UsageLog,
    private readonly caps: { sessionUsd: number; totalUsd: number },
  ) {}

  /** Throws BUDGET_EXCEEDED before any network call if spend + worst-case estimate would pass a cap. */
  assertCanSpend(sessionId: string, estimateUsd: number): void {
    const session = this.log.sessionSpend(sessionId);
    const total = this.log.totalSpend();
    if (session + estimateUsd > this.caps.sessionUsd)
      throw new LauncherError(
        "BUDGET_EXCEEDED",
        `Session budget ${fmt(this.caps.sessionUsd)} would be exceeded (spent ${fmt(session)}, this call up to ${fmt(estimateUsd)}).`,
        HTTP_TOO_MANY,
      );
    if (total + estimateUsd > this.caps.totalUsd)
      throw new LauncherError(
        "BUDGET_EXCEEDED",
        `Total budget ${fmt(this.caps.totalUsd)} would be exceeded (spent ${fmt(total)}, this call up to ${fmt(estimateUsd)}).`,
        HTTP_TOO_MANY,
      );
  }
}
