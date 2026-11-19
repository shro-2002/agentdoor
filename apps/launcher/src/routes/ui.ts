import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router, type Request, type Response } from "express";
import type { BusinessPolicy } from "@agentdoor/core";
import { z } from "zod";
import { LauncherError, validationFailed } from "../claude/errors.js";
import { approve, approvedNow, commitVersion, latestPolicy, unknownRule } from "../flows/policyEdit.js";
import type { Deps } from "../flows/compile.js";
import { getAt, setAt } from "../flows/paths.js";
import { gateStatus } from "../flows/gate.js";
import { ok } from "./envelope.js";
import { StubDeploys } from "./deploy-stub.js";

const LAUNCHER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEMO_KEY = "seeded-leaky";
const EDITED_NOTE = "Edited by owner";
const MAX_READBACK = 200;
const HTTP_CONFLICT = 409;

/** Numeric rule leaves the owner may retype, with the bounds the editor enforces (integers in stored units). */
const EDITABLE: Record<string, { min: number; max: number }> = {
  unitPricePaise: { min: 100, max: 1_000_000 },
  feePaise: { min: 0, max: 100_000 },
  minOrderPaise: { min: 0, max: 1_000_000 },
  maxQtyPerOrder: { min: 1, max: 1000 },
  prepHours: { min: 0, max: 720 },
  unitsPerDay: { min: 1, max: 10_000 },
  minLeadHours: { min: 0, max: 720 },
  quoteValidityMinutes: { min: 1, max: 1440 },
};

type GroupId = "menu" | "notice" | "rush" | "delivery" | "rules";
const GROUP_RANK: GroupId[] = ["menu", "notice", "rush", "delivery", "rules"];

export interface RuleView {
  path: string;
  group: GroupId;
  /** Last path segment (`unitPricePaise`) or the whole path for top-level rules. */
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

function describePath(policy: BusinessPolicy, p: string): { group: GroupId; leaf: string; subject: string | null; unit: string | null; order: number } {
  const item = /^catalog\[([^\]]+)\]\.(\w+)$/.exec(p);
  if (item) {
    const idx = policy.catalog.findIndex((c) => c.id === item[1]);
    const c = policy.catalog[idx];
    return { group: "menu", leaf: item[2]!, subject: c?.name.en ?? item[1]!, unit: c?.unit ?? null, order: idx };
  }
  const area = /^fulfilment\.delivery\.areas\[([^\]]+)\]\.(\w+)$/.exec(p);
  if (area) {
    const idx = policy.fulfilment.delivery.areas.findIndex((a) => a.id === area[1]);
    return { group: "delivery", leaf: area[2]!, subject: policy.fulfilment.delivery.areas[idx]?.name ?? area[1]!, unit: null, order: 10 + idx };
  }
  const group: GroupId = p.startsWith("capacity") || p.startsWith("schedule") ? "notice" : p.startsWith("rush") ? "rush" : p.startsWith("fulfilment") ? "delivery" : "rules";
  const leaf = p.includes(".") ? p.slice(p.lastIndexOf(".") + 1) : p;
  return { group, leaf: p === "rush" ? "rush" : leaf, subject: null, unit: null, order: 0 };
}

export function ruleViews(policy: BusinessPolicy): RuleView[] {
  return Object.entries(policy.provenance)
    .map(([p, prov]) => {
      const d = describePath(policy, p);
      const src = prov.source;
      return {
        order: d.order,
        view: {
          path: p,
          group: d.group,
          leaf: d.leaf,
          subject: d.subject,
          unit: d.unit,
          value: getAt(policy, p).value ?? null,
          editable: EDITABLE[d.leaf] ?? null,
          source: {
            kind: src.kind,
            quote: src.kind === "transcript" ? src.quote : null,
            note: src.kind === "transcript" ? null : src.note,
            turn: src.kind === "transcript" ? src.turn : null,
          },
          readback: prov.readback,
          confidence: prov.confidence,
          status: prov.status,
        } satisfies RuleView,
      };
    })
    .sort((a, b) => GROUP_RANK.indexOf(a.view.group) - GROUP_RANK.indexOf(b.view.group) || a.order - b.order)
    .map((x) => x.view);
}

const EditBody = z.strictObject({ value: z.number().int(), readback: z.string().min(1).max(MAX_READBACK) });

function questionsOf(deps: Deps, id: string, version: number, clarifyUsed: boolean): unknown[] {
  if (clarifyUsed) return [];
  for (let v = version; v >= 1; v--) {
    const q = (deps.store.readCompile(id, v) as { result?: { questions?: unknown[] } }).result?.questions;
    if (q && q.length > 0) return q;
  }
  return [];
}

export interface UiRouteDeps extends Deps {
  mode: string;
}

/** Routes the four launcher pages need beyond 04 §8: status, demo text, rule overview, typed edit, stubbed deploy. */
export function uiRouter(deps: UiRouteDeps, deploys: StubDeploys): Router {
  const r = Router();

  r.get("/status", (_req: Request, res: Response) => ok(res, { mode: deps.mode, maxTranscriptChars: 6000 }));

  r.get("/demo", (_req: Request, res: Response) => {
    const file = path.join(LAUNCHER_ROOT, "fixtures", "transcripts", `${DEMO_KEY}.txt`);
    ok(res, { language: "en", fixtureKey: DEMO_KEY, transcript: readFileSync(file, "utf8").trim() });
  });

  r.get("/session/:id/overview", (req: Request, res: Response) => {
    const id = String(req.params.id);
    const { session, version, policy } = latestPolicy(deps, id);
    const gate = gateStatus(deps, id);
    ok(res, {
      sessionId: id,
      version,
      business: { name: policy.business.name, ownerFirstName: policy.business.ownerFirstName },
      language: session.language,
      turns: session.turns,
      rules: ruleViews(policy),
      approvals: gate.approvals,
      questions: questionsOf(deps, id, version, session.clarifyUsed),
    });
  });

  r.post("/session/:id/rules/:path/edit", (req: Request, res: Response) => {
    const id = String(req.params.id);
    const rulePath = String(req.params.path);
    const parsed = EditBody.safeParse(req.body);
    if (!parsed.success) throw validationFailed("Send a whole number and a short read-back.");
    const { version, policy } = latestPolicy(deps, id);
    const prov = policy.provenance[rulePath];
    if (!prov) throw unknownRule(rulePath);
    const leaf = describePath(policy, rulePath).leaf;
    const bounds = EDITABLE[leaf];
    if (!bounds) throw validationFailed("That rule cannot be edited here.");
    const { value, readback } = parsed.data;
    if (value < bounds.min || value > bounds.max) throw validationFailed(`Use a number from ${bounds.min} to ${bounds.max}.`);
    const next = structuredClone(policy);
    if (!setAt(next, rulePath, value)) throw unknownRule(rulePath);
    next.provenance[rulePath] = {
      ...approve(prov),
      source: { kind: "owner_edit", note: EDITED_NOTE },
      readback: { lang: prov.readback.lang, text: readback },
      confidence: "high",
      approvedAt: approvedNow(),
    };
    const created = commitVersion(deps, id, next, { kind: "edit", path: rulePath, fromVersion: version });
    ok(res, { version: created });
  });

  r.post("/session/:id/deploy", (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!z.strictObject({ consent: z.literal(true) }).safeParse(req.body).success)
      throw validationFailed("Launching needs the owner's explicit consent.");
    const gate = gateStatus(deps, id);
    if (!gate.canLaunch)
      throw new LauncherError("GATE_BLOCKED", `launch gate blocked: ${gate.checks.filter((c) => !c.ok).map((c) => c.label).join("; ")}`, HTTP_CONFLICT);
    ok(res, { jobId: deploys.start(gate.policyHash).jobId }, 202);
  });

  r.get("/deploy/:jobId", (req: Request, res: Response) => ok(res, deploys.get(String(req.params.jobId))));

  return r;
}
