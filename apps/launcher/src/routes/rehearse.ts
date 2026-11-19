import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { validationFailed } from "../claude/errors.js";
import { approveAllHigh, approveRule } from "../flows/approve.js";
import type { Deps } from "../flows/compile.js";
import { applyGapFix } from "../flows/gapFix.js";
import { gapCard, type CardLang } from "../flows/gapText.js";
import { gateStatus, launch, type GatePaths } from "../flows/gate.js";
import { rehearsalState, type Rehearsals } from "../flows/rehearse.js";
import { ok } from "./envelope.js";

const HTTP_ACCEPTED = 202;
const MAX_CHOICE_CHARS = 40;

export interface RehearseRouteDeps extends Deps {
  /** Where `launch` writes the bundle and finds the signing keys; defaults to the repo's real folders. */
  paths?: GatePaths;
}

const FixBody = z.strictObject({
  choice: z.string().min(1).max(MAX_CHOICE_CHARS),
  value: z.number().int().optional(),
});
const LaunchBody = z.strictObject({ consent: z.boolean() });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success)
    throw validationFailed(r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return r.data;
}

const param = (req: Request, name: string): string => String(req.params[name]);

/** Gap cards are English unless the owner writes Hindi or Hinglish (or the caller asks: `?lang=`). */
function cardLang(req: Request, sessionLanguage: string): CardLang {
  const asked = req.query.lang;
  if (asked === "en" || asked === "hinglish") return asked;
  return sessionLanguage === "en" ? "en" : "hinglish";
}

/** Launcher internal API, 04 §8: rehearse / runs / gap fixes / approvals / gate / launch. */
export function rehearseRouter(deps: RehearseRouteDeps, rehearsals: Rehearsals): Router {
  const r = Router();

  r.post("/session/:id/rehearse", (req: Request, res: Response) => {
    ok(res, { runId: rehearsals.start(param(req, "id")).runId }, HTTP_ACCEPTED);
  });

  r.get("/runs/:runId", (req: Request, res: Response) => {
    const run = rehearsals.get(param(req, "runId"));
    if (!run.result) return ok(res, run);
    const policy = deps.store.readPolicy(run.sessionId, run.result.policyVersion);
    const lang = cardLang(req, deps.store.getSession(run.sessionId).language);
    ok(res, { ...run, cards: run.result.gaps.map((g) => gapCard(g, policy, lang, g.example)) });
  });

  r.post("/session/:id/gaps/:gapId/fix", (req: Request, res: Response) => {
    const body = parse(FixBody, req.body);
    ok(res, applyGapFix(deps, param(req, "id"), param(req, "gapId"), body.choice, body.value));
  });

  r.post("/session/:id/rules/approve-high", (req: Request, res: Response) => {
    ok(res, approveAllHigh(deps, param(req, "id")));
  });

  r.post("/session/:id/rules/:path/approve", (req: Request, res: Response) => {
    ok(res, approveRule(deps, param(req, "id"), param(req, "path")));
  });

  r.get("/session/:id/gate", (req: Request, res: Response) => {
    const id = param(req, "id");
    const { run, stale } = rehearsalState(deps, id);
    ok(res, { ...gateStatus(deps, id), rehearsal: { runId: run?.runId ?? null, stale } });
  });

  r.post("/session/:id/launch", (req: Request, res: Response) => {
    const body = parse(LaunchBody, req.body);
    const { record, policyVersion, policyHash } = launch(deps, param(req, "id"), { consent: body.consent, paths: deps.paths });
    ok(res, { record, policyVersion, policyHash });
  });

  return r;
}
