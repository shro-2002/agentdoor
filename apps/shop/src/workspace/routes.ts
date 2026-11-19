import { createHash } from "node:crypto";
import { Router, type Request, type RequestHandler, type Response } from "express";
import { formBody } from "../http/body.js";
import { requireSameOrigin } from "../security/origin.js";
import type { OwnerAuth } from "../security/owner-auth.js";
import type { Limiters } from "../security/rate-limits.js";
import type { ServiceContext } from "../services/context.js";
import { previewStorefrontPage } from "../views/storefront.js";
import { buildCards } from "./cards.js";
import { LIMITS, type WorkspaceConfig } from "./config.js";
import { isId, newId, readDraftIds } from "./cookie.js";
import {
  EditError,
  RULE_SECTIONS,
  addArea,
  addProduct,
  approveRule,
  approveStated,
  editArea,
  editProduct,
  editRules,
  removeArea,
  removeProduct,
  type Form,
  type RuleSection,
} from "./edit.js";
import { recordRun, rehearseNow, scenariosFit } from "./flows.js";
import { WorkspaceJobs, type StartResult } from "./jobs.js";
import { applyFix, commitPolicy } from "./ops.js";
import { nextQuestion, recordAnswer } from "./questions.js";
import { buildPackage, readiness } from "./readiness.js";
import { HTTP } from "./route-kit.js";
import { registerStart } from "./start-routes.js";
import type { DraftRow, DraftState } from "./state.js";
import { getDraft, getDraftByPreview, getPrepared, hit, savePrepared, setPreviewId, updateState } from "./store.js";
import { overviewPage } from "./views/overview.js";
import { rehearsePage } from "./views/rehearse.js";
import { productsPage } from "./views/products.js";
import { rulesPage } from "./views/rules.js";
import { setupPage } from "./views/setup.js";
import { messagePage } from "./views/start.js";
import { storefrontTabPage } from "./views/storefront-tab.js";
import type { Tab, ViewCtx } from "./views/frame.js";
import type { Tone } from "./views/kit.js";

const MINUTE_MS = 60_000;
const FLASH_COOKIE = "ad_flash";
const FLASH_MAX_AGE_MS = 60_000;
const NEXT_TABS: Tab[] = ["products", "rules", "rehearse", "setup", "storefront"];

const str = (v: unknown, max = 400): string => (typeof v === "string" ? v.slice(0, max) : "");

export interface Workspace {
  router: Router;
  jobs: WorkspaceJobs;
}

/** The /launch workspace: drafts, jobs, previews. The only part of the shop that may call Claude. */
export function createWorkspace(ctx: ServiceContext, limiters: Limiters, ownerAuth: OwnerAuth, cfg: WorkspaceConfig): Workspace {
  const { pool, now, config } = ctx;
  const router = Router();
  const sameOrigin = requireSameOrigin(config);
  const secure = config.publicBaseUrl.startsWith("https://");
  const jobs = new WorkspaceJobs({ pool, now, log: ctx.log }, cfg);
  const origin = config.publicBaseUrl.replace(/\/$/, "");
  const cookieBase = { httpOnly: true, sameSite: "lax", secure, path: "/launch" } as const;

  const ipKey = (req: Request, label: string): string => createHash("sha256").update(`${label}:${req.ip ?? "unknown"}`).digest("hex").slice(0, 32);
  const send = (res: Response, markup: string, status = 200): void => void res.status(status).set("Cache-Control", "no-store").type("html").send(markup);

  function setFlash(res: Response, tone: Tone, text: string): void {
    res.cookie(FLASH_COOKIE, JSON.stringify({ t: tone, x: text.slice(0, 240) }), { ...cookieBase, maxAge: FLASH_MAX_AGE_MS });
  }

  function takeFlash(req: Request, res: Response): ViewCtx["flash"] {
    const raw = /(?:^|;\s*)ad_flash=([^;]*)/.exec(req.headers.cookie ?? "")?.[1];
    if (!raw) return null;
    res.clearCookie(FLASH_COOKIE, cookieBase);
    try {
      const v = JSON.parse(decodeURIComponent(raw)) as { t?: unknown; x?: unknown };
      const tones: Tone[] = ["ok", "warn", "bad", "info", "mute"];
      return typeof v.x === "string" && tones.includes(v.t as Tone) ? { tone: v.t as Tone, text: v.x.slice(0, 240) } : null;
    } catch {
      return null;
    }
  }

  const owned = (req: Request): string[] => readDraftIds(req.headers.cookie, config.sessionSecret, now());

  router.use("/launch", limiters.workspace);
  registerStart({ router, pool, now, config, cfg, jobs, sameOrigin, cookieBase, send, ipKey, takeFlash, owned });

  // ---- one draft -------------------------------------------------------------------------------

  const guard: RequestHandler = async (req, res, next) => {
    const id = String(req.params.id);
    // Not found, not forbidden: another browser's draft must not even be confirmed to exist.
    if (!isId(id) || !owned(req).includes(id)) return send(res, messagePage("Not found", "That business is not available in this browser."), HTTP.notFound);
    if (!(await hit(pool, "draft_req", id, MINUTE_MS, LIMITS.draftRequestsPerMinute, now()))) return send(res, messagePage("Slow down", "Too many requests. Try again in a minute."), HTTP.tooMany);
    const row = await getDraft(pool, id);
    if (!row) return send(res, messagePage("Not found", "That business is not available in this browser."), HTTP.notFound);
    res.locals.row = row;
    next();
  };
  router.use("/launch/w/:id", guard);

  const rowOf = (res: Response): DraftRow => res.locals.row as DraftRow;
  const baseOf = (row: DraftRow): string => `/launch/w/${row.id}`;
  const back = (res: Response, row: DraftRow, tab: string, tone?: Tone, text?: string): void => {
    if (tone && text) setFlash(res, tone, text);
    res.redirect(303, `${baseOf(row)}${tab === "overview" ? "" : `/${tab}`}`);
  };
  const nextTab = (req: Request, fallback: Tab): Tab => (NEXT_TABS.includes(req.body?.next) ? (req.body.next as Tab) : fallback);

  async function viewCtx(req: Request, res: Response): Promise<ViewCtx> {
    const row = rowOf(res);
    const fresh = (await getDraft(pool, row.id)) ?? row;
    const prepared = ownerAuth.signedIn(req) ? await getPrepared(pool, row.id) : null;
    return {
      id: row.id,
      base: baseOf(row),
      state: fresh.state,
      job: await jobs.current(row.id),
      ready: readiness(fresh.state),
      flash: takeFlash(req, res),
      owner: ownerAuth.signedIn(req),
      previewPath: fresh.previewId ? `/launch/p/${fresh.previewId}` : null,
      prepared: prepared !== null,
      origin,
      nowMs: now(),
      device: req.query.device === "phone" ? "phone" : "desktop",
      roundsLeft: { compile: LIMITS.maxCompileRounds - fresh.compileRounds, scenarios: LIMITS.maxScenarioRuns - fresh.scenarioRuns },
    };
  }

  const page = (render: (c: ViewCtx) => string): RequestHandler => async (req, res) => send(res, render(await viewCtx(req, res)));

  router.get("/launch/w/:id", page(overviewPage));
  router.get("/launch/w/:id/setup", page(setupPage));
  router.get("/launch/w/:id/products", page(productsPage));
  router.get("/launch/w/:id/rules", page(rulesPage));
  router.get("/launch/w/:id/rehearse", async (req, res) => {
    const c = await viewCtx(req, res);
    send(res, rehearsePage(c, buildCards(c.state, c.base)));
  });
  router.get("/launch/w/:id/storefront", page(storefrontTabPage));

  router.get("/launch/w/:id/jobs/:file", async (req, res) => {
    const row = rowOf(res);
    const jobId = String(req.params.file).replace(/\.json$/, "");
    const job = isId(jobId) ? await jobs.status(row.id, jobId) : null;
    if (!job) return void res.status(HTTP.notFound).json({ status: "missing" });
    res.set("Cache-Control", "no-store").json({
      status: job.status,
      kind: job.kind,
      error: job.status === "failed" ? { code: job.errorCode, message: job.errorMessage, retryable: job.retryable } : null,
    });
  });

  // ---- setup: questions and retries ---------------------------------------------------------------

  const startFailed = (res: Response, row: DraftRow, r: Extract<StartResult, { ok: false }>, tab: string): void => back(res, row, tab, r.reason === "BUSY" ? "info" : "warn", r.message);

  async function runJob(res: Response, row: DraftRow, kind: "compile" | "clarify" | "rehearse", payload: unknown, tab: string): Promise<void> {
    const r = await jobs.start(row.id, kind, payload);
    if (r.ok) return back(res, row, tab);
    startFailed(res, row, r, tab);
  }

  router.post("/launch/w/:id/setup/answer", formBody, sameOrigin, async (req, res) => {
    const row = rowOf(res);
    const text = str(req.body?.other, LIMITS.maxAnswerChars + 1).trim() || str(req.body?.answer, LIMITS.maxAnswerChars + 1).trim();
    let accepted = false;
    const after = await updateState(pool, row.id, (s) => {
      accepted = recordAnswer(s, str(req.body?.questionId, 80), text);
    });
    if (!accepted) return back(res, row, "setup", "warn", "Pick an answer or type one (up to 400 characters).");
    if (nextQuestion(after.state)) return back(res, row, "setup");
    await runJob(res, row, "clarify", null, "setup");
  });

  router.post("/launch/w/:id/setup/apply", formBody, sameOrigin, async (_req, res) => runJob(res, rowOf(res), "clarify", null, "setup"));

  router.post("/launch/w/:id/setup/skip", formBody, sameOrigin, async (_req, res) => {
    const row = rowOf(res);
    if (Object.keys(row.state.answers).length > 0) return runJob(res, row, "clarify", null, "setup");
    await updateState(pool, row.id, (s) => {
      s.questionsClosed = true;
      s.questions = [];
    });
    back(res, row, "setup");
  });

  router.post("/launch/w/:id/retry", formBody, sameOrigin, async (req, res) => {
    const row = rowOf(res);
    const last = await jobs.current(row.id);
    if (!last || last.status !== "failed" || !last.retryable) return back(res, row, "setup", "warn", "There is nothing to retry.");
    const description = str(req.body?.description, LIMITS.maxDescriptionChars + 1).trim();
    if (last.kind === "compile" && description !== "" && (description.length < 10 || description.length > LIMITS.maxDescriptionChars))
      return back(res, row, "setup", "warn", "Please write between 10 and 2000 characters.");
    await runJob(res, row, last.kind, last.kind === "compile" ? { description: description || undefined } : last.payload, last.kind === "rehearse" ? "rehearse" : "setup");
  });

  // ---- products, areas, rules ---------------------------------------------------------------------

  type Edit = (policy: NonNullable<DraftState["policy"]>, req: Request, nowIso: string) => NonNullable<DraftState["policy"]>;

  /** Validates through the core schema, stores the next version, and answers with a short confirmation. */
  const editor = (tab: Tab, done: string, change: Edit): RequestHandler => async (req, res) => {
    const row = rowOf(res);
    try {
      await updateState(pool, row.id, (s) => {
        if (!s.policy) throw new EditError("Set up your business first.");
        commitPolicy(s, change(s.policy, req, new Date(now()).toISOString()), now());
      });
      back(res, row, tab, "ok", done);
    } catch (e) {
      if (!(e instanceof EditError)) throw e;
      back(res, row, tab, "bad", e.message);
    }
  };

  const form = (req: Request): Form => (req.body ?? {}) as Form;
  const pid = (req: Request): string => String(req.params.pid);
  const aid = (req: Request): string => String(req.params.aid);
  const post = (path: string, ...h: RequestHandler[]): void => void router.post(`/launch/w/:id${path}`, formBody, sameOrigin, ...h);

  post("/products/add", editor("products", "Product added.", (p, r, t) => addProduct(p, form(r), t)));
  post("/products/:pid/remove", editor("products", "Product removed.", (p, r) => removeProduct(p, pid(r))));
  post("/products/:pid", editor("products", "Product saved.", (p, r, t) => editProduct(p, pid(r), form(r), t)));
  post("/areas/add", editor("rules", "Area added.", (p, r, t) => addArea(p, form(r), t)));
  post("/areas/:aid/remove", editor("rules", "Area removed.", (p, r) => removeArea(p, aid(r))));
  post("/areas/:aid", editor("rules", "Area saved.", (p, r, t) => editArea(p, aid(r), form(r), t)));
  post("/rules/:section", async (req, res, next) => {
    const section = String(req.params.section);
    if (!(RULE_SECTIONS as readonly string[]).includes(section)) return next("route");
    return editor("rules", "Saved.", (p, r, t) => editRules(p, section as RuleSection, form(r), t))(req, res, next);
  });

  post("/approve", (req, res, next) => editor(nextTab(req, "rules"), "Approved.", (p, r, t) => approveRule(p, str(r.body?.path, 200), t))(req, res, next));
  post("/approve-stated", async (req, res) => {
    const row = rowOf(res);
    let count = 0;
    await updateState(pool, row.id, (s) => {
      if (!s.policy) return;
      const out = approveStated(s.policy, new Date(now()).toISOString());
      count = out.count;
      commitPolicy(s, out.policy, now());
    });
    back(res, row, nextTab(req, "rules"), count > 0 ? "ok" : "info", count > 0 ? `Approved ${count} ${count === 1 ? "rule" : "rules"} you stated.` : "Nothing left that you stated.");
  });

  // ---- rehearse ------------------------------------------------------------------------------------

  post("/rehearse", async (req, res) => {
    const row = rowOf(res);
    const mode = str(req.body?.mode, 12);
    const policy = row.state.policy;
    if (!policy) return back(res, row, "rehearse", "warn", "Set up your business first.");
    if (mode === "regenerate") return runJob(res, row, "rehearse", { regenerate: true }, "rehearse");
    if (scenariosFit(row.state, policy)) {
      await updateState(pool, row.id, (s) => recordRun(s, rehearseNow(s, now())));
      return back(res, row, "rehearse", "ok", "Checks re-run.");
    }
    await runJob(res, row, "rehearse", null, "rehearse");
  });

  post("/fix", async (req, res) => {
    const row = rowOf(res);
    const raw = str(req.body?.value, 8);
    try {
      await updateState(pool, row.id, (s) => applyFix(s, str(req.body?.gapId, 200), str(req.body?.choice, 60), raw === "" ? undefined : Number(raw), now()));
      back(res, row, "rehearse", "ok", "Done. The checks have been re-run.");
    } catch (e) {
      if (!(e instanceof EditError)) throw e;
      back(res, row, "rehearse", "bad", e.message);
    }
  });

  // ---- preview and publishing ------------------------------------------------------------------------

  post("/preview", async (_req, res) => {
    const row = rowOf(res);
    if (!row.state.policy) return back(res, row, "storefront", "warn", "Set up your business first.");
    if (!row.previewId) await setPreviewId(pool, row.id, newId());
    back(res, row, "storefront");
  });

  const refuseNonOwner = (res: Response): void => send(res, messagePage("Publishing needs the owner's authorization", "Only the signed-in shop owner can prepare a business for publishing."), HTTP.forbidden);

  post("/prepare", async (req, res) => {
    // The owner session is checked before anything else is looked at or stored.
    if (!ownerAuth.signedIn(req)) return refuseNonOwner(res);
    const row = rowOf(res);
    if (!readiness(row.state).canPublish) return back(res, row, "storefront", "warn", "Finish the rehearsal first: publishing is still locked.");
    const pkg = buildPackage(row.state, { privateKey: config.signingPrivateKey, publicKey: config.signingPublicKey }, new Date(now()).toISOString());
    await savePrepared(pool, row.id, { policyJson: pkg.policyJson, policyHash: pkg.policyHash, recordJson: JSON.stringify(pkg.signed) });
    back(res, row, "storefront", "ok", "Package prepared.");
  });

  router.get("/launch/w/:id/package.json", async (req, res) => {
    if (!ownerAuth.signedIn(req)) return refuseNonOwner(res);
    const prepared = await getPrepared(pool, rowOf(res).id);
    if (!prepared) return void res.status(HTTP.notFound).json({ error: "not prepared" });
    res.set("Cache-Control", "no-store").json({ policy: JSON.parse(prepared.policyJson) as unknown, launchRecord: JSON.parse(prepared.recordJson) as unknown });
  });

  // A preview is read-only, shareable and has its own random id; it carries no way to edit or order.
  router.get("/launch/p/:previewId", async (req, res) => {
    const previewId = String(req.params.previewId);
    const row = isId(previewId) ? await getDraftByPreview(pool, previewId) : null;
    if (!row?.state.policy) return send(res, messagePage("Not found", "This preview does not exist."), HTTP.notFound);
    if (!(await hit(pool, "prev_req", previewId, MINUTE_MS, LIMITS.previewRequestsPerMinute, now()))) return send(res, messagePage("Slow down", "Too many requests. Try again in a minute."), HTTP.tooMany);
    res.set("X-Robots-Tag", "noindex");
    send(res, previewStorefrontPage(row.state.policy, `/launch/p/${previewId}`));
  });

  return { router, jobs };
}
