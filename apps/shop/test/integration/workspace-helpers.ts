import { createHash } from "node:crypto";
import type { WorkspaceJobs } from "../../src/workspace/jobs.js";
import { loadWorkspaceConfig, type WorkspaceConfig } from "../../src/workspace/config.js";
import { fakeSdk, type FakeSdkOptions } from "../support/fake-claude.js";
import { OWNER_TOKEN, PUBLIC_URL, startShop, type TestShop } from "./http-helpers.js";

export const CODE = "let-me-in-2026";
const MS_PER_DAY = 86_400_000;

export interface WsShop extends TestShop {
  fake: ReturnType<typeof fakeSdk>;
  jobs: WorkspaceJobs;
  clock2: { now: number };
  /** A browser: its own cookie jar. */
  browser: () => Browser;
}

export interface WsOptions extends FakeSdkOptions {
  code?: string | null;
  budgetUsd?: number;
  draftCapUsd?: number;
  apiKey?: string | null;
  /** No SDK at all (a missing key) when false. */
  withSdk?: boolean;
}

export async function startWorkspaceShop(o: WsOptions = {}): Promise<WsShop> {
  const fake = fakeSdk(o);
  const clock2 = { now: Date.now() };
  const base = loadWorkspaceConfig({
    WORKSPACE_ACCESS_CODE: o.code === undefined ? CODE : (o.code ?? undefined),
    WORKSPACE_BUDGET_USD: o.budgetUsd === undefined ? undefined : String(o.budgetUsd),
    ANTHROPIC_API_KEY: o.apiKey === undefined ? "test-key-never-used" : (o.apiKey ?? undefined),
  });
  const workspace: WorkspaceConfig = {
    ...base,
    ...(o.draftCapUsd === undefined ? {} : { draftCapMicro: Math.round(o.draftCapUsd * 1_000_000) }),
    ...(o.withSdk === false ? {} : { sdkFactory: () => fake.sdk }),
  };
  const shop = await startShop({ workspace, now: () => ++clock2.now });
  const jobs = shop.app.locals.workspaceJobs as WorkspaceJobs;
  return { ...shop, fake, jobs, clock2, browser: () => new Browser(shop.base) };
}

export class Browser {
  private jar = new Map<string, string>();
  constructor(private readonly base: string) {}

  cookieHeader(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  setCookie(name: string, value: string): void {
    this.jar.set(name, value);
  }

  private store(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      if (/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(line) || value === "") this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  async get(path: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string; headers: Headers; location: string | null }> {
    const res = await fetch(this.base + path, { headers: { cookie: this.cookieHeader(), ...headers }, redirect: "manual" });
    this.store(res);
    return { status: res.status, text: await res.text(), headers: res.headers, location: res.headers.get("location") };
  }

  async post(path: string, form: Record<string, string | string[]> = {}, headers: Record<string, string> = {}): Promise<{ status: number; text: string; headers: Headers; location: string | null }> {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
    const res = await fetch(this.base + path, {
      method: "POST",
      headers: { cookie: this.cookieHeader(), origin: PUBLIC_URL, "content-type": "application/x-www-form-urlencoded", ...headers },
      body,
      redirect: "manual",
    });
    this.store(res);
    return { status: res.status, text: await res.text(), headers: res.headers, location: res.headers.get("location") };
  }

  /** Follows one redirect (the post-redirect-get the pages use). */
  async follow(r: { location: string | null }): Promise<{ status: number; text: string }> {
    return this.get(r.location ?? "/");
  }

  /** Creates a draft and returns its id. */
  async create(description: string, code = CODE): Promise<string> {
    const r = await this.post("/launch", { description, code });
    const id = /\/launch\/w\/([0-9a-f]{32})/.exec(r.location ?? "")?.[1];
    if (!id) throw new Error(`draft not created (status ${r.status})`);
    return id;
  }

  /** Signs in as the shop owner (the existing /owner login). */
  async signInOwner(): Promise<void> {
    const r = await this.post("/owner/login", { token: OWNER_TOKEN });
    if (r.status !== 303) throw new Error("owner sign-in failed");
  }
}

/** Polls the job-status endpoint of a draft until nothing is running. */
export async function settle(b: Browser, shop: WsShop, id: string): Promise<{ status: string; kind: string; error: { message: string; retryable: boolean; code: string } | null }> {
  await shop.jobs.idle();
  const page = await b.get(`/launch/w/${id}/setup`);
  const jobId = /data-job-url="[^"]*\/jobs\/([0-9a-f]{32})\.json"/.exec(page.text)?.[1];
  if (jobId) throw new Error("a job is still running");
  const row = await shop.pool.query("SELECT id, kind, status, error_code, error_message, retryable FROM ws_jobs WHERE draft_id = ? ORDER BY created_ms DESC LIMIT 1", [id]);
  const j = (row[0] as { id: string; kind: string; status: string; error_code: string | null; error_message: string | null; retryable: number }[])[0];
  if (!j) throw new Error("no job");
  return { status: j.status, kind: j.kind, error: j.status === "failed" ? { message: j.error_message ?? "", retryable: j.retryable === 1, code: j.error_code ?? "" } : null };
}

export const daysMs = (n: number): number => n * MS_PER_DAY;
export const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

const unesc = (s: string): string => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Does what an owner does on the Rehearse screen until publishing unlocks: approve, then fix or accept. */
export async function clearEverything(b: Browser, id: string): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    const page = (await b.get(`/launch/w/${id}/rehearse`)).text;
    if (page.includes("Publishing is unlocked")) return;
    if (page.includes("/approve-stated")) {
      await b.post(`/launch/w/${id}/approve-stated`, { next: "rehearse" });
      continue;
    }
    const forms = page.split("<form").slice(1).map((f) => f.split("</form>")[0]!);
    const hidden = (f: string, name: string): string | undefined => {
      const m = new RegExp(`name="${name}" value="([^"]*)"`).exec(f);
      return m ? unesc(m[1]!) : undefined;
    };
    const approve = forms.find((f) => f.includes('/approve"'));
    if (approve) {
      await b.post(`/launch/w/${id}/approve`, { path: hidden(approve, "path")!, next: "rehearse" });
      continue;
    }
    const fixes = forms.filter((f) => f.includes('/fix"'));
    const pick = fixes.find((f) => f.includes("Accept the shop&#39;s answer")) ?? fixes[0];
    if (pick) {
      await b.post(`/launch/w/${id}/fix`, { gapId: hidden(pick, "gapId")!, choice: hidden(pick, "choice")!, ...(pick.includes('name="value"') ? { value: "3" } : {}) });
      continue;
    }
    await b.post(`/launch/w/${id}/rehearse`, { mode: "recheck" });
  }
  throw new Error("rehearsal did not clear");
}
