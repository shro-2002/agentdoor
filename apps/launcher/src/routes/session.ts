import { Router, type Request, type Response } from "express";
import { LangSchema } from "@agentdoor/core";
import { z } from "zod";
import { validationFailed } from "../claude/errors.js";
import { answerQuestions } from "../flows/clarify.js";
import { compileSession, type Deps } from "../flows/compile.js";
import { ok } from "./envelope.js";

export const MAX_TRANSCRIPT_CHARS = 6000; // 05 §4
const MAX_ANSWER_CHARS = 1000;
const MAX_ANSWERS = 5;

const CreateSessionBody = z.strictObject({
  language: LangSchema,
  transcript: z.string().min(1).max(MAX_TRANSCRIPT_CHARS),
  fixtureKey: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
});

const AnswersBody = z.strictObject({
  answers: z
    .array(
      z.strictObject({
        questionId: z.string().min(1).max(40),
        text: z.string().min(1).max(MAX_ANSWER_CHARS),
      }),
    )
    .min(1)
    .max(MAX_ANSWERS),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success)
    throw validationFailed(r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return r.data;
}

const sessionParam = (req: Request): string => String(req.params.id);

/** Launcher internal API, 04 §8 (session / compile / answers / usage). */
export function sessionRouter(deps: Deps): Router {
  const r = Router();

  r.post("/session", (req: Request, res: Response) => {
    const body = parse(CreateSessionBody, req.body);
    const session = deps.store.createSession(body);
    ok(res, { sessionId: session.id }, 201);
  });

  r.post("/session/:id/compile", async (req: Request, res: Response) => {
    ok(res, await compileSession(deps, sessionParam(req)));
  });

  r.post("/session/:id/answers", async (req: Request, res: Response) => {
    const body = parse(AnswersBody, req.body);
    ok(res, await answerQuestions(deps, sessionParam(req), body.answers));
  });

  r.get("/usage", (req: Request, res: Response) => {
    const totals = deps.client.usageTotals();
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : null;
    ok(res, { totalUsd: totals.totalUsd, sessionUsd: sessionId ? totals.sessionUsd(sessionId) : null });
  });

  return r;
}
