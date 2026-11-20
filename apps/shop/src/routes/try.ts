import { join } from "node:path";
import { Router, type Request, type Response } from "express";
import { QuoteRequestSchema, evaluate, policyHash, type BusinessPolicy, type QuoteRequest } from "@agentdoor/core";
import { formBody } from "../http/body.js";
import { requireSameOrigin } from "../security/origin.js";
import type { Limiters } from "../security/rate-limits.js";
import type { ServiceContext } from "../services/context.js";
import { liveRunFigures, recordedRunFigures } from "../services/figures.js";
import { firstProblemVersion, gateChecks, runLive } from "../services/try-live.js";
import { sessionLoader, type TrySession } from "../services/try-session.js";
import { earliestStandardDate } from "../views/format.js";
import { OTHER_AREA, firstWorkingDate, problemsFor } from "../views/order.js";
import { describePage, introPage, launchPage, rehearsePage, rulesPage, videoIdFrom, type QuoteTry } from "../views/try.js";

const MAX_QTY = 1000;
const MAX_AREA = 80;

export interface TryOptions {
  /** Same folder the shop boots from; the replay reads `<bundleDir>/try/session.json`. */
  bundleDir?: string;
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * `/try`: the public replay (04 §9). It renders a recorded session and re-runs the deterministic
 * engine live. It never calls Claude, never opens a database connection, never writes a file.
 * (This module deliberately takes no `pool`.)
 */
export function tryRouter(ctx: ServiceContext, limiters: Limiters, opts: TryOptions = {}): Router {
  const router = Router();
  const load = sessionLoader(opts.bundleDir ?? process.env.BUNDLE_DIR ?? join(process.cwd(), "bundle"));
  const sameOrigin = requireSameOrigin(ctx.config);
  router.use("/try", limiters.try);
  const videoId = (): string | null => videoIdFrom(process.env.DEMO_VIDEO_ID);
  const send = (res: Response, markup: string): void => void res.set("Cache-Control", "no-store").type("html").send(markup);

  const unavailable = (res: Response): void => void res.status(200).set("Cache-Control", "no-store").type("html").send(introPage(null, videoId()));

  router.get("/try", (_req, res) => {
    const l = load();
    send(res, introPage(l.ok ? l.session : null, videoId()));
  });

  router.get("/try/describe", (_req, res) => {
    const l = load();
    if (!l.ok) return unavailable(res);
    send(res, describePage(l.session));
  });

  router.get("/try/rules", (_req, res) => {
    const l = load();
    if (!l.ok) return unavailable(res);
    send(res, rulesPage(l.session));
  });

  const rehearse = (req: Request, res: Response, quote?: QuoteTry): void => {
    const l = load();
    if (!l.ok) return unavailable(res);
    const s = l.session;
    const nowMs = ctx.now();
    const last = s.policyVersions.length;
    const asked = Number(req.query.v);
    const version = Number.isInteger(asked) && asked >= 1 && asked <= last ? asked : firstProblemVersion(s, nowMs);
    const runs = s.policyVersions.map((_p, i) => runLive(s, i + 1, nowMs));
    const quotePolicy = quotePolicyOf(s);
    send(
      res,
      rehearsePage({
        session: s,
        run: runs[version - 1]!,
        latest: runs[last - 1]!,
        tabs: runs.map((r) => ({ version: r.version, criticalOpen: r.summary.criticalOpen })),
        earliest: earliestStandardDate(quotePolicy, nowMs),
        quotePolicy,
        runs: [
          liveRunFigures("First rehearsal run", runs[0]!),
          ctx.launch.launched ? recordedRunFigures(ctx.launch.record) : liveRunFigures("Final rehearsal run", runs[last - 1]!),
        ],
        ...(quote ? { quote } : {}),
      }),
    );
  };

  /** The shop's own policy when it is launched, so the mini-form quotes exactly what customers get. */
  const quotePolicyOf = (s: TrySession): BusinessPolicy => (ctx.launch.launched ? ctx.launch.policy : s.policyVersions.at(-1)!);

  router.get("/try/rehearse", (req, res) => rehearse(req, res));

  // The mini-form: evaluates in memory and renders. No signature, no token, no database.
  router.post("/try/quote", formBody, sameOrigin, (req, res) => {
    const l = load();
    if (!l.ok) return unavailable(res);
    const policy = quotePolicyOf(l.session);
    const body = req.body as Record<string, unknown>;
    const item = policy.catalog.find((c) => c.id === str(body.item, 60)) ?? policy.catalog[0]!;
    const qty = Number(str(body.qty, 6));
    const where = str(body.where, MAX_AREA);
    const fulfilment = where === "pickup" || !where ? { kind: "pickup" as const } : { kind: "delivery" as const, area: where === OTHER_AREA ? "Somewhere not listed" : where };
    const parsed = QuoteRequestSchema.safeParse({ lines: [{ itemId: item.id, qty: Number.isInteger(qty) && qty >= 1 && qty <= MAX_QTY ? qty : 0, optionIds: [] }], fulfilment, date: str(body.date, 10) });
    const label = fulfilment.kind === "pickup" ? "pickup" : `delivery to ${fulfilment.area}`;
    const shown = { item: item.name.en, qty: Number.isInteger(qty) ? qty : 0, date: str(body.date, 10), where: label };
    if (!parsed.success) {
      const quote: QuoteTry = { result: { outcome: "REFUSED", reasons: [{ code: "VALIDATION_FAILED", params: {}, ruleRef: "request" }] }, request: shown, problems: [{ field: "general", text: "Check the quantity and the date, then try again." }] };
      return rehearse(req, res, quote);
    }
    const request: QuoteRequest = parsed.data;
    const result = evaluate(policy, request, ctx.now());
    const problems = result.outcome === "QUOTED" ? [] : problemsFor(result.reasons, policy, firstWorkingDate(policy, request, ctx.now()));
    rehearse(req, res, { result, request: shown, problems });
  });

  router.get("/try/launch", (_req, res) => {
    const l = load();
    if (!l.ok) return unavailable(res);
    const s = l.session;
    const last = s.policyVersions.length;
    const run = runLive(s, last, ctx.now());
    send(
      res,
      launchPage({
        session: s,
        checks: gateChecks(s, run),
        recordedHash: policyHash(s.policyVersions[last - 1]!),
        liveHash: ctx.launch.launched ? ctx.launch.policyHash : null,
        mcpUrl: `${ctx.config.publicBaseUrl.replace(/\/$/, "")}/mcp`,
      }),
    );
  });

  return router;
}
