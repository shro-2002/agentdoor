import { findSmokeRequest } from "./smoke-request.js";
import { DeployError } from "./errors.js";
import type { BusinessPolicy } from "@agentdoor/core";

const HTTP_TIMEOUT_MS = 15_000;
const HTTP_OK = 200;
const HTTP_CREATED = 201;

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const timed = (fetchFn: FetchFn, url: string, init: RequestInit = {}): Promise<Response> =>
  fetchFn(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });

async function jsonOf(res: Response): Promise<{ data?: Record<string, unknown> } | null> {
  try {
    return (await res.json()) as { data?: Record<string, unknown> };
  } catch {
    return null;
  }
}

/** The shop's own view of itself: launched, and serving exactly this policy. */
export async function readHealth(fetchFn: FetchFn, baseUrl: string): Promise<{ launched: boolean; policyHash: string | null } | null> {
  try {
    const res = await timed(fetchFn, `${baseUrl}/healthz`);
    if (res.status !== HTTP_OK) return null;
    const data = (await jsonOf(res))?.data;
    if (!data) return null;
    return { launched: data.launched === true, policyHash: typeof data.policyHash === "string" ? data.policyHash : null };
  } catch {
    return null;
  }
}

/**
 * Public smoke (03 §5.5 step 2): `/healthz` hash, `/api/business`, and one quote that must be QUOTED.
 * It only reads and quotes: it never places an order, so it cannot dirty the shared database.
 */
export async function smoke(opts: { fetchFn: FetchFn; baseUrl: string; policy: BusinessPolicy; policyHash: string; nowMs: number }): Promise<void> {
  const { fetchFn, baseUrl } = opts;
  const health = await readHealth(fetchFn, baseUrl);
  if (!health?.launched || health.policyHash !== opts.policyHash) {
    throw new DeployError("SMOKE_FAILED", "/healthz does not report this policy as launched");
  }
  const biz = await timed(fetchFn, `${baseUrl}/api/business`);
  if (biz.status !== HTTP_OK) throw new DeployError("SMOKE_FAILED", `/api/business answered ${biz.status}`);
  const request = findSmokeRequest(opts.policy, opts.nowMs);
  if (!request) throw new DeployError("SMOKE_FAILED", "no known-good quote request exists for this policy");
  const res = await timed(fetchFn, `${baseUrl}/api/quotes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const quote = (await jsonOf(res))?.data?.quote as { token?: unknown } | undefined;
  if (res.status !== HTTP_CREATED || typeof quote?.token !== "string") {
    throw new DeployError("SMOKE_FAILED", `smoke quote was not QUOTED (status ${res.status})`);
  }
}
