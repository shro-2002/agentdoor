import type { Request, Response } from "express";
import { z } from "zod";
import { formBody } from "../http/body.js";
import { ACCESS_COOKIE, ACCESS_MAX_AGE_MS, hasEarlyAccess, signAccessCookie } from "./access.js";
import { LIMITS, accessCodeMatches } from "./config.js";
import { COOKIE_MAX_AGE_MS, WORKSPACE_COOKIE, newId, signDraftCookie } from "./cookie.js";
import { HOUR_MS, HTTP, type RouteKit } from "./route-kit.js";
import { emptyState } from "./state.js";
import { createDraft, getDraft, hit, pruneHits } from "./store.js";
import { exampleText } from "./views/examples.js";
import { accessStepPage, businessesPage, startPage } from "./views/start.js";
import type { Tone } from "./views/kit.js";

const DescriptionSchema = z.string().trim().min(10, "Please write a little more.").max(LIMITS.maxDescriptionChars, `Please keep it under ${LIMITS.maxDescriptionChars} characters.`);
const MAX_CODE_CHARS = 200;
const OVERSIZE_SLACK = 50;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

/** The landing page, the early-access step and draft creation. Everything that makes a draft goes through `attempt`. */
export function registerStart(kit: RouteKit): void {
  const { router, pool, now, config, cfg, sameOrigin, send, cookieBase } = kit;
  const isClosed = cfg.accessCode === null && !cfg.open;
  const early = (req: Request): boolean => cfg.open || (cfg.accessCode !== null && hasEarlyAccess(req.headers.cookie, config.sessionSecret, cfg.accessCode, now()));

  const landing = (req: Request, flash: { tone: Tone; text: string } | null, description = ""): string =>
    startPage({ closed: false, flash, description, hasDrafts: kit.owned(req).length > 0, earlyAccess: early(req) });

  router.get("/launch", (req, res) => {
    const closed = isClosed;
    const example = exampleText(req.query.example);
    send(res, closed ? startPage({ closed: true, flash: null, hasDrafts: false, earlyAccess: false }) : landing(req, kit.takeFlash(req, res), example));
  });

  router.get("/launch/mine", async (req, res) => {
    const rows = await Promise.all(kit.owned(req).map((id) => getDraft(pool, id)));
    const list = rows.flatMap((r) => (r ? [{ id: r.id, name: r.state.policy?.business.name ?? "Untitled business", city: r.state.policy?.business.city ?? "Setting up" }] : []));
    send(res, businessesPage(list.reverse()));
  });

  /** A refused code is explained on the access step, which keeps the pending description in its form. */
  const refuse = (res: Response, description: string, text: string, status: number): void =>
    send(res, accessStepPage({ description, flash: { tone: "bad", text } }), status);

  async function attempt(req: Request, res: Response, issueCookie: boolean): Promise<void> {
    const expected = cfg.accessCode ?? "";
    if (isClosed) return send(res, startPage({ closed: true, flash: null, hasDrafts: false, earlyAccess: false }), HTTP.unavailable);
    const raw = str(req.body?.description, LIMITS.maxDescriptionChars + OVERSIZE_SLACK);
    const parsed = DescriptionSchema.safeParse(raw);
    if (!parsed.success) return send(res, landing(req, { tone: "bad", text: parsed.error.issues[0]?.message ?? "Please check what you wrote." }, raw.slice(0, LIMITS.maxDescriptionChars)), HTTP.badRequest);
    const description = parsed.data;
    const ip = kit.ipKey(req, "ip");
    let grant = false;
    if (!early(req)) {
      const code = str(req.body?.code, MAX_CODE_CHARS);
      // No session and no code in this request: nothing is created. The access step asks for the code.
      if (code === "") return send(res, accessStepPage({ description, flash: null }), HTTP.forbidden);
      // Every attempt is counted atomically before the comparison, so parallel guesses cannot slip past the limit;
      // once an address has used its attempts, even the right code is refused.
      if (!(await hit(pool, "code_fail", ip, HOUR_MS, LIMITS.wrongCodesPerIpPerHour, now()))) return refuse(res, description, "Too many wrong codes. Try again in an hour.", HTTP.tooMany);
      if (!accessCodeMatches(code, expected)) return refuse(res, description, "That access code is not right.", HTTP.forbidden);
      grant = issueCookie;
    }
    if (!(await hit(pool, "draft_new", ip, HOUR_MS, LIMITS.draftsPerIpPerHour, now()))) return send(res, landing(req, { tone: "bad", text: "That is enough new businesses for now. Try again later." }, description), HTTP.tooMany);
    void pruneHits(pool, now()).catch(() => undefined);
    const id = newId();
    await createDraft(pool, id, ip.slice(0, 16), emptyState(description));
    if (grant) res.cookie(ACCESS_COOKIE, signAccessCookie(config.sessionSecret, expected, now()), { ...cookieBase, maxAge: ACCESS_MAX_AGE_MS });
    res.cookie(WORKSPACE_COOKIE, signDraftCookie(config.sessionSecret, [...kit.owned(req), id], now()), { ...cookieBase, maxAge: COOKIE_MAX_AGE_MS });
    await kit.jobs.start(id, "compile");
    res.redirect(303, `/launch/w/${id}/setup`);
  }

  router.post("/launch", formBody, sameOrigin, (req, res) => attempt(req, res, false));
  router.post("/launch/access", formBody, sameOrigin, (req, res) => attempt(req, res, true));
}
