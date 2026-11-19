import { randomBytes } from "node:crypto";
import { HTTP_NOT_FOUND, LauncherError } from "../claude/errors.js";

/**
 * A stubbed deploy job (T10): it emits the same step ids as `scripts/deploy.ts` (pack, upload, secrets,
 * publish, domain, smoke) on a timer so the StepTimeline can be built and shown, but it never runs
 * gddy, writes a bundle or touches the network. Real wiring needs the owner's confirmation.
 */
export const DEPLOY_STEPS = ["pack", "upload", "secrets", "publish", "domain", "smoke"] as const;
export type DeployStepId = (typeof DEPLOY_STEPS)[number];

const DEFAULT_STEP_MS = 900;
const JOB_ID_BYTES = 6;
const SHOP_URL = "https://agentdoor.shop";

/** Names and counts only, like the real deploy log: never a secret value. */
const LOG_LINES: Record<DeployStepId, string> = {
  pack: "pack: bundle verified, zip allow-list checked",
  upload: "upload: source imported to PREVIEW",
  secrets: "secrets: names set on PREVIEW and PUBLISH (values never shown)",
  publish: "publish: health probe GET / returned 200",
  domain: "domain: hostname ACTIVE, HTTPS valid",
  smoke: "smoke: quote, order and refusal checks passed",
};

export interface DeployStepView {
  id: DeployStepId;
  state: "waiting" | "running" | "done" | "failed";
  ms: number | null;
}
export interface DeployJobView {
  jobId: string;
  /** True for every job in this task: nothing was published. */
  stub: true;
  status: "running" | "done" | "failed";
  steps: DeployStepView[];
  log: string[];
  result: { url: string; mcpUrl: string; ownerUrl: string } | null;
}

export class StubDeploys {
  private readonly jobs = new Map<string, { startedAt: number; policyHash: string }>();

  constructor(
    private readonly stepMs: number = Number(process.env.AGENTDOOR_STUB_STEP_MS ?? DEFAULT_STEP_MS),
    private readonly clock: () => number = Date.now,
  ) {}

  start(policyHash: string): { jobId: string } {
    const jobId = `j_${randomBytes(JOB_ID_BYTES).toString("hex")}`;
    this.jobs.set(jobId, { startedAt: this.clock(), policyHash });
    return { jobId };
  }

  get(jobId: string): DeployJobView {
    const job = this.jobs.get(jobId);
    if (!job) throw new LauncherError("JOB_NOT_FOUND", "No such launch job.", HTTP_NOT_FOUND);
    const elapsed = this.clock() - job.startedAt;
    const steps: DeployStepView[] = DEPLOY_STEPS.map((id, i) => {
      const start = i * this.stepMs;
      if (elapsed >= start + this.stepMs) return { id, state: "done", ms: this.stepMs };
      if (elapsed >= start) return { id, state: "running", ms: Math.max(0, elapsed - start) };
      return { id, state: "waiting", ms: null };
    });
    const done = steps.every((s) => s.state === "done");
    return {
      jobId,
      stub: true,
      status: done ? "done" : "running",
      steps,
      log: steps.filter((s) => s.state === "done").map((s) => LOG_LINES[s.id]),
      result: done ? { url: SHOP_URL, mcpUrl: `${SHOP_URL}/mcp`, ownerUrl: `${SHOP_URL}/owner` } : null,
    };
  }
}
