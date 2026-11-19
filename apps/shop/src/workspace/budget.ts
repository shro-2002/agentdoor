import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { SpendGuard } from "../../../launcher/src/claude/client.js";
import { microOf, type WorkspaceConfig } from "./config.js";

/** Refused before any network call. `scope` says which cap was hit. */
export class BudgetError extends Error {
  constructor(readonly scope: "global" | "draft") {
    super(scope === "global" ? "The workspace's AI budget is used up." : "This business has used its AI allowance.");
    this.name = "BudgetError";
  }
}

type Caps = Pick<WorkspaceConfig, "budgetMicro" | "draftCapMicro">;

async function ensureBudgetRow(pool: Pool): Promise<void> {
  await pool.query("INSERT IGNORE INTO ws_budget (id, spent_micro, reserved_micro) VALUES (1, 0, 0)");
}

/**
 * Reserve before the call, settle after it, both as single atomic UPDATEs: two jobs racing for the
 * last dollar cannot both win. `reserved + spent + estimate` must stay within the cap, so even a
 * burst of concurrent jobs can never spend past it (the estimate is a worst case, settle refunds the rest).
 */
export function mysqlSpendGuard(pool: Pool, caps: Caps): SpendGuard {
  return {
    async reserve(draftId, estimateUsd) {
      const est = microOf(estimateUsd);
      await ensureBudgetRow(pool);
      const [global] = await pool.query<ResultSetHeader>(
        "UPDATE ws_budget SET reserved_micro = reserved_micro + ? WHERE id = 1 AND spent_micro + reserved_micro + ? <= ?",
        [est, est, caps.budgetMicro],
      );
      if (global.affectedRows !== 1) throw new BudgetError("global");
      const [draft] = await pool.query<ResultSetHeader>(
        "UPDATE ws_drafts SET reserved_micro = reserved_micro + ? WHERE id = ? AND spent_micro + reserved_micro + ? <= ?",
        [est, draftId, est, caps.draftCapMicro],
      );
      if (draft.affectedRows !== 1) {
        await pool.query("UPDATE ws_budget SET reserved_micro = GREATEST(reserved_micro - ?, 0) WHERE id = 1", [est]);
        throw new BudgetError("draft");
      }
      let settled = false;
      return {
        async settle(actualUsd) {
          if (settled) return;
          settled = true;
          const actual = microOf(actualUsd);
          await pool.query("UPDATE ws_budget SET reserved_micro = GREATEST(reserved_micro - ?, 0), spent_micro = spent_micro + ? WHERE id = 1", [est, actual]);
          await pool.query("UPDATE ws_drafts SET reserved_micro = GREATEST(reserved_micro - ?, 0), spent_micro = spent_micro + ? WHERE id = ?", [est, actual, draftId]);
        },
      };
    },
  };
}

export interface BudgetSnapshot {
  spentMicro: number;
  reservedMicro: number;
}

export async function budgetSnapshot(pool: Pool): Promise<BudgetSnapshot> {
  await ensureBudgetRow(pool);
  const [rows] = await pool.query<(RowDataPacket & { spent_micro: number; reserved_micro: number })[]>("SELECT spent_micro, reserved_micro FROM ws_budget WHERE id = 1");
  return { spentMicro: Number(rows[0]?.spent_micro ?? 0), reservedMicro: Number(rows[0]?.reserved_micro ?? 0) };
}
