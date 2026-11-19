/** The launcher API payloads the pages read (04 §8 plus routes/ui.ts); only the fields the UI uses. */
export interface GapCardData {
  gapId: string;
  code: string;
  severity: "critical" | "warning";
  dismissed: boolean;
  example: string | null;
  title: string;
  body: string;
  fixes: { choice: string; label: string; needsValue: boolean }[];
}

export interface RunData {
  runId: string;
  status: "running" | "done" | "failed";
  progress: { phase: "starting" | "probes" | "scenarios" | "classifying" | "done"; done: number; total: number };
  error?: { code: string; message: string };
  result?: {
    policyVersion: number;
    policyHash: string;
    ranAt: string;
    probes: { probeId: string; family: string; status: "PASS" | "FAIL" | "GAP"; detail: string }[];
    scenarios: { id: string; customerMessage: string; matched: boolean; outcome: string }[];
    gaps: { id: string; code: string; severity: string; dismissed: boolean; example: string | null }[];
    summary: { probes: number; probesPassed: number; probesFailed: number; scenarios: number; passed: number; criticalOpen: number; warningsOpen: number };
  };
  cards?: GapCardData[];
}

export interface GateData {
  canLaunch: boolean;
  checks: { id: string; label: string; ok: boolean; detail: string }[];
  policyVersion: number;
  policyHash: string;
  approvals: { required: number; approved: number };
  rehearsal: { runId: string | null; stale: boolean };
}

export interface RuleData {
  path: string;
  group: "menu" | "notice" | "rush" | "delivery" | "rules";
  leaf: string;
  subject: string | null;
  unit: string | null;
  value: unknown;
  editable: { min: number; max: number } | null;
  source: { kind: string; quote: string | null; note: string | null; turn: number | null };
  readback: { lang: string; text: string };
  confidence: string;
  status: string;
}

export interface QuestionData {
  id: string;
  path: string;
  text: string;
  choices: string[];
}

export interface OverviewData {
  sessionId: string;
  version: number;
  business: { name: string; ownerFirstName: string };
  turns: string[];
  rules: RuleData[];
  approvals: { required: number; approved: number };
  questions: QuestionData[];
}

export interface DeployData {
  jobId: string;
  stub: boolean;
  status: "running" | "done" | "failed";
  steps: { id: string; state: "waiting" | "running" | "done" | "failed"; ms: number | null }[];
  log: string[];
  result: { url: string; mcpUrl: string; ownerUrl: string } | null;
}
