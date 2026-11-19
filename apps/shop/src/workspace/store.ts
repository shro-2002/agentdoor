import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { LIMITS } from "./config.js";
import type { DraftRow, DraftState, JobKind, JobRow, JobStatus } from "./state.js";

const MAX_CAS_TRIES = 6;

interface DraftRecord extends RowDataPacket {
  id: string;
  preview_id: string | null;
  version: number;
  compile_rounds: number;
  scenario_runs: number;
  spent_micro: number;
  reserved_micro: number;
  state: string;
}

const toDraft = (r: DraftRecord): DraftRow => ({
  id: r.id,
  previewId: r.preview_id,
  version: r.version,
  compileRounds: r.compile_rounds,
  scenarioRuns: r.scenario_runs,
  spentMicro: Number(r.spent_micro),
  reservedMicro: Number(r.reserved_micro),
  state: JSON.parse(r.state) as DraftState,
});

export async function createDraft(pool: Pool, id: string, ipHash: string, state: DraftState): Promise<void> {
  await pool.query("INSERT INTO ws_drafts (id, ip_hash, state) VALUES (?, ?, ?)", [id, ipHash, JSON.stringify(state)]);
}

export async function getDraft(pool: Pool, id: string): Promise<DraftRow | null> {
  const [rows] = await pool.query<DraftRecord[]>("SELECT * FROM ws_drafts WHERE id = ?", [id]);
  return rows[0] ? toDraft(rows[0]) : null;
}

export async function getDraftByPreview(pool: Pool, previewId: string): Promise<DraftRow | null> {
  const [rows] = await pool.query<DraftRecord[]>("SELECT * FROM ws_drafts WHERE preview_id = ?", [previewId]);
  return rows[0] ? toDraft(rows[0]) : null;
}

/**
 * Read-modify-write with a version check, so a job finishing while the owner saves an edit cannot
 * overwrite it. `change` may return a new state or mutate the one it is given.
 */
export async function updateState(pool: Pool, id: string, change: (s: DraftState) => DraftState | void): Promise<DraftRow> {
  for (let attempt = 0; attempt < MAX_CAS_TRIES; attempt += 1) {
    const row = await getDraft(pool, id);
    if (!row) throw new Error("draft not found");
    const next = change(row.state) ?? row.state;
    const [res] = await pool.query<ResultSetHeader>("UPDATE ws_drafts SET state = ?, version = version + 1 WHERE id = ? AND version = ?", [
      JSON.stringify(next),
      id,
      row.version,
    ]);
    if (res.affectedRows === 1) return { ...row, version: row.version + 1, state: next };
  }
  throw new Error("draft is busy");
}

export async function setPreviewId(pool: Pool, id: string, previewId: string): Promise<void> {
  await pool.query("UPDATE ws_drafts SET preview_id = ? WHERE id = ? AND preview_id IS NULL", [previewId, id]);
}

const ROUND_COLUMN = { compile: "compile_rounds", scenarios: "scenario_runs" } as const;
const ROUND_LIMIT = { compile: LIMITS.maxCompileRounds, scenarios: LIMITS.maxScenarioRuns } as const;

/** Atomically uses up one round; false when the draft has none left. */
export async function takeRound(pool: Pool, id: string, kind: keyof typeof ROUND_COLUMN): Promise<boolean> {
  const col = ROUND_COLUMN[kind];
  const [res] = await pool.query<ResultSetHeader>(`UPDATE ws_drafts SET ${col} = ${col} + 1 WHERE id = ? AND ${col} < ?`, [id, ROUND_LIMIT[kind]]);
  return res.affectedRows === 1;
}

/** A failed call gives its round back: the owner should not lose one to an outage. */
export async function giveBackRound(pool: Pool, id: string, kind: keyof typeof ROUND_COLUMN): Promise<void> {
  const col = ROUND_COLUMN[kind];
  await pool.query(`UPDATE ws_drafts SET ${col} = GREATEST(${col} - 1, 0) WHERE id = ?`, [id]);
}

interface JobRecord extends RowDataPacket {
  id: string;
  draft_id: string;
  kind: JobKind;
  status: JobStatus;
  payload: string | null;
  error_code: string | null;
  error_message: string | null;
  retryable: number;
  created_ms: number;
  heartbeat_ms: number;
}

const toJob = (r: JobRecord): JobRow => ({
  id: r.id,
  draftId: r.draft_id,
  kind: r.kind,
  status: r.status,
  payload: r.payload ? (JSON.parse(r.payload) as unknown) : null,
  errorCode: r.error_code,
  errorMessage: r.error_message,
  retryable: r.retryable === 1,
  createdMs: Number(r.created_ms),
  heartbeatMs: Number(r.heartbeat_ms),
});

export async function insertJob(pool: Pool, job: { id: string; draftId: string; kind: JobKind; payload: unknown; nowMs: number }): Promise<void> {
  await pool.query(
    "INSERT INTO ws_jobs (id, draft_id, kind, status, payload, created_ms, heartbeat_ms) VALUES (?, ?, ?, 'queued', ?, ?, ?)",
    [job.id, job.draftId, job.kind, job.payload === undefined ? null : JSON.stringify(job.payload), job.nowMs, job.nowMs],
  );
}

export async function getJob(pool: Pool, draftId: string, jobId: string): Promise<JobRow | null> {
  const [rows] = await pool.query<JobRecord[]>("SELECT * FROM ws_jobs WHERE id = ? AND draft_id = ?", [jobId, draftId]);
  return rows[0] ? toJob(rows[0]) : null;
}

/** The newest job of a draft, whatever its state. */
export async function latestJob(pool: Pool, draftId: string): Promise<JobRow | null> {
  const [rows] = await pool.query<JobRecord[]>("SELECT * FROM ws_jobs WHERE draft_id = ? ORDER BY created_ms DESC, id DESC LIMIT 1", [draftId]);
  return rows[0] ? toJob(rows[0]) : null;
}

export async function markJob(
  pool: Pool,
  id: string,
  status: JobStatus,
  nowMs: number,
  failure?: { code: string; message: string; retryable: boolean },
): Promise<void> {
  const finished = status === "done" || status === "failed" ? nowMs : null;
  await pool.query(
    "UPDATE ws_jobs SET status = ?, heartbeat_ms = ?, finished_ms = ?, error_code = ?, error_message = ?, retryable = ? WHERE id = ?",
    [status, nowMs, finished, failure?.code ?? null, failure?.message.slice(0, 300) ?? null, failure?.retryable ? 1 : 0, id],
  );
}

export async function beat(pool: Pool, id: string, nowMs: number): Promise<void> {
  await pool.query("UPDATE ws_jobs SET heartbeat_ms = ? WHERE id = ? AND status IN ('queued','running')", [nowMs, id]);
}

/**
 * Fails jobs that outlived the 3 minute limit, or whose process stopped beating (a restart).
 * Both are retryable. Runs before every status read, so a stuck job never blocks a draft.
 */
export async function sweepStaleJobs(pool: Pool, draftId: string, nowMs: number): Promise<void> {
  await pool.query(
    `UPDATE ws_jobs SET status = 'failed', finished_ms = ?, retryable = 1, error_code = 'TIMED_OUT',
       error_message = 'This took too long and was stopped. You can try again.'
     WHERE draft_id = ? AND status IN ('queued', 'running') AND created_ms < ?`,
    [nowMs, draftId, nowMs - LIMITS.jobTimeoutMs],
  );
  await pool.query(
    `UPDATE ws_jobs SET status = 'failed', finished_ms = ?, retryable = 1, error_code = 'INTERRUPTED',
       error_message = 'This was interrupted. You can try again.'
     WHERE draft_id = ? AND status IN ('queued', 'running') AND heartbeat_ms < ?`,
    [nowMs, draftId, nowMs - LIMITS.heartbeatStaleMs],
  );
}

/** Counts a hit in a fixed window and says whether it is still within `limit`. */
export async function hit(pool: Pool, kind: string, subject: string, windowMs: number, limit: number, nowMs: number): Promise<boolean> {
  const bucket = Math.floor(nowMs / windowMs);
  await pool.query("INSERT INTO ws_hits (kind, subject, bucket, hits) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE hits = hits + 1", [kind, subject, bucket]);
  const [rows] = await pool.query<(RowDataPacket & { hits: number })[]>("SELECT hits FROM ws_hits WHERE kind = ? AND subject = ? AND bucket = ?", [kind, subject, bucket]);
  return (rows[0]?.hits ?? 1) <= limit;
}

/** Old counters are dead weight: dropped opportunistically so the table stays small. */
export async function pruneHits(pool: Pool, nowMs: number): Promise<void> {
  const HOUR = 3_600_000;
  const MINUTE = 60_000;
  const cutoff = nowMs - 2 * HOUR;
  await pool.query("DELETE FROM ws_hits WHERE kind IN ('code_fail', 'draft_new') AND bucket < ?", [Math.floor(cutoff / HOUR)]);
  await pool.query("DELETE FROM ws_hits WHERE kind IN ('draft_req', 'prev_req') AND bucket < ?", [Math.floor(cutoff / MINUTE)]);
}

/** The current count of a window, without adding to it (used before a secret is compared). */
export async function peekHits(pool: Pool, kind: string, subject: string, windowMs: number, nowMs: number): Promise<number> {
  const [rows] = await pool.query<(RowDataPacket & { hits: number })[]>("SELECT hits FROM ws_hits WHERE kind = ? AND subject = ? AND bucket = ?", [kind, subject, Math.floor(nowMs / windowMs)]);
  return rows[0]?.hits ?? 0;
}

export interface PreparedRow {
  policyJson: string;
  recordJson: string;
  policyHash: string;
}

export async function savePrepared(pool: Pool, draftId: string, p: PreparedRow): Promise<void> {
  await pool.query(
    `INSERT INTO ws_publish (draft_id, policy_json, policy_hash, record_json) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE policy_json = VALUES(policy_json), policy_hash = VALUES(policy_hash), record_json = VALUES(record_json), prepared_at = CURRENT_TIMESTAMP(3)`,
    [draftId, p.policyJson, p.policyHash, p.recordJson],
  );
}

export async function getPrepared(pool: Pool, draftId: string): Promise<PreparedRow | null> {
  const [rows] = await pool.query<(RowDataPacket & { policy_json: string; policy_hash: string; record_json: string })[]>(
    "SELECT policy_json, policy_hash, record_json FROM ws_publish WHERE draft_id = ?",
    [draftId],
  );
  const r = rows[0];
  return r ? { policyJson: r.policy_json, policyHash: r.policy_hash, recordJson: r.record_json } : null;
}
