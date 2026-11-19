# STATUS — compact progress and handoff

Keep this under ~150 lines. Newest entries on top within each section. Each task appends ≤10 lines.

## Now
- Phase: **IMPLEMENTATION READY**. T01 live-platform spike done (2026-11-19): all feasibility risks cleared (MCP via CDN, MySQL, domain + HTTPS, mail both ways, proxy, persistence).
- Next: T05 persistence (T03 engine done). Submission time still UNCONFIRMED.
- Core engine, signing and rehearsal exist; no shop/launcher code yet. Claude spend so far: $0. GoDaddy spend so far: $0.
- Deadline: Fri 20 Nov 2026. Exact submission time: **UNCONFIRMED**. Assume 18:00 IST.
- Reviews remaining: **R2** (after T06) and **R4** (before submit). No further architecture reviews unless a fatal feasibility blocker appears.

## Platform facts (public-safe; account details live in `private/ACCOUNT_FACTS.md`)
| Item | Value |
|---|---|
| Submission deadline (exact) | UNCONFIRMED |
| MCP via CDN (curl / Claude.ai connector / Claude Code) | all three work (stateless streamable HTTP, no auth); SSE not buffered (1 s ticks) |
| `DB_*` present; MySQL version / `max_connections` | present; MySQL 8.4.8-8, 200; `FOR UPDATE` txn OK |
| Proxy topology → `trust proxy` value | **1**. Edge appends real IP as last `X-Forwarded-For`, keeps client values; `CF-Connecting-IP` unforgeable (spoof → error 1000). Key on `req.ip`. Confirmed on laptop and phone (mobile data) |
| Mail gateway → mailbox delivered | delivered both ways: inbound Gmail → hello@, and app `sendEmail()` gateway → hello@ inbox (not spam). Sender name shows the app host id |
| `updateSecrets` via `gddy api call --file`: works per variant? | yes, PREVIEW and PUBLISH separately, needs `application/json-patch+json` |
| Persistence across restart + redeploy | MySQL rows survive both; disk not relied on |
| Redeploy wall time | ≈125 s (upload 11 s + publish); restart ≈5 s |
| Custom domain | agentdoor.shop ACTIVE, HTTPS valid (Google Trust Services), http→https 301, apex + www |
| Publish health probe | hits `GET /`; must return 200 or publish fails after ~2 min |

## Decisions (append; never edit past entries)
- 2026-11-19 (T03, approved by owner): **inside the rush window rush waives `minLeadHours` and prep hours.** Reason: planning/08 U-ENG-4 (rush at 10 h) and the fixture (lead 48 h, rush within 24 h) contradict each other otherwise. Rush = `0 < hoursUntil < withinHours` (strict); a past or equal-to-now fulfilment instant is never rush. Rush cap is checked per order (`units > maxRushUnitsPerDay`); the DB enforces the day total.
- 2026-11-19 (T03): engine details the docs left open. `NEEDS_OWNER` (unlisted area + ASK_OWNER) is deferred, so any later refusal wins. Pickup disabled has no code in 04 §2, so it returns `VALIDATION_FAILED` (ruleRef `fulfilment.pickup.enabled`). `RUSH_NOT_OFFERED` is appended to a lead refusal when `rush` is null. Min order is on the item subtotal (options included, fee and rush excluded). `dailyCutoff` is not used by the engine. `notes` is size-checked and never read. Scenario gaps only fire on QUOTE-vs-not mismatch (05 §5.2). Added gap codes `ENGINE_PROBE_FAILED` (critical) and `PROBE_NEEDS_OWNER` (warning). Core now exports `requiredPaths(policy)` for the launch gate.
- 2026-11-19 (T01): `app.set('trust proxy', 1)`; rate-limit key is `req.ip` (rightmost XFF), never the leftmost entry (client-controlled). Every build must serve `GET /` with 200 for the publish health probe. Secrets use `application/json-patch+json`.
- 2026-11-18 (revision 2): `/try` replay mandatory with three provenance badges (RECORDED · Claude / LIVE · deterministic / RECORDED · deployment evidence), embedded video, persistent nav. Optional `/try/live` (T14) only after R1–R20 pass and the ledger is ≤ $75: access code + hard $5 app budget. Trusted proxy topology measured in T01; separate buckets mcp-read / quote-rest / order-create / contact / owner-auth / try. Implementation sessions explicitly read CLAUDE.md; human cost checkpoints. Secrets only in the `updateSecrets` JSON body (`gddy api call --file`), PREVIEW and PUBLISH separately, never argv. Two-way provenance coverage gate. Global lock order `quote_redemptions → capacity_ledger → orders → audit_events`, bounded retry with ROLLBACK. Ledgers and account facts moved to gitignored `private/`. No AI-assistance disclosure file is committed to the repo (your decision, 2026-11-18).
- 2026-11-18: Hosting plan = **Economy 1-month ($4.99)**, the cheapest plan with a publish slot + managed MySQL. Exactly one app (`agentdoor-shop`) for the whole hackathon; all deploys reuse it. Free PREVIEW for development checks.
- 2026-11-18: Separate GoDaddy budget, cap $40 (`private/GODADDY_LEDGER.md`); every purchase needs explicit approval; mailbox free trial preferred over Titan yearly ($23.88).
- 2026-11-18: Deployment acceptance now requires live public storefront, working MCP, DB persistence across restart + redeploy, successful same-app redeploy (I-DEP-4..7).
- 2026-11-18: Domain + mailbox + contact form are **in scope** (organizer-mandatory, deck p.6). Supersedes earlier "Out: custom domain, Email API".
- 2026-11-18: Email via GoDaddy loopback gateway helper only (contract C11/C13); deck SMTP tip ignored for Node hosting.
- 2026-11-18: Durable state in GoDaddy managed MySQL; no reliance on disk persistence.
- 2026-11-18: Budget reallocation: $5 moved from "Claude compiler" to "Deployment/testing/fixes" (planning/09 §4).
- 2026-11-18: ~~Opus 5.5 for T05~~ superseded by R0-8: Sonnet 5.5 (high effort) for every task; Haiku only for string-table subagents.
- 2026-11-18 (R0): Public replay `/try` + ribbon + mandatory video (R20). Launcher cut to 4 pages; 3 MCP tools; no Haiku explain; 1 clarify round; linear deploy script; R1/R3 skipped. Purchases tonight. Wire schemas for structured output. Fixtures keyed by id with injected clock; scenarios use daysAhead. Ledger row before BEGIN, single conditional UPDATE, idempotent DUPLICATE path. trust proxy = measured hops. Human cost checkpoints, budget expected $63 / caps $82.50. `secret sync` argv accepted with controls.

## Task log
<!-- T## — date — result (done/blocked) — key decisions — open issues — next -->
- T03 — 2026-11-19 — **done** — `core/engine` (dates, money, request schema, `evaluate`), `core/rehearsal` (probes + runner, lint, classify, requiredPaths). U-ENG-1..12, P-ENG-1..4, U-REH-1/2, dates/money green (core: 134 tests); engine coverage 100% lines. Decisions: see 2026-11-19 (T03) entries (rush waives lead, deferred NEEDS_OWNER, pickup-off code). Issues: P-ENG-3's generator reached QUOTED too rarely (13/2000 < required 20), so I weighted `engine.prop.test.ts` towards valid input (properties unchanged). `npm test` is red only because untracked T05 tests in `apps/shop/test` have no `src` yet; not committed here. Next: T05.
- T01 (resumed) — 2026-11-19 — **done** — attach, secrets (both variants), publish (2nd try: needed `GET /`), check.sh, MCP via Claude Code + Claude.ai connector, domain ACTIVE + HTTPS, mail gateway accepts, restart + redeploy persistence, still one app. Decisions: trust proxy = 1 (see Decisions). Issues: gddy 0.2.38 available, not installed; gateway mail sender name is the app host id (set readable subject in contact form). Next: T03 engine exports, then T05 persistence. Details in `spike/RESULTS.md`.
- T02 — 2026-11-18 — done — npm workspaces (core, ui stub, shop, launcher), all deps installed exact (zod 4, vitest 5, TS 7); strict domain schemas, separate unbounded wire schemas (CompileResult, ScenarioWire), canonicalJson + policyHash, fixtures policy.bakery/seeded-leaky; U-SCH-1..4, U-HASH-1..3, U-CMP-7 (schema half) green (49 tests). Decisions: vitest 5 has no `vitest.workspace.ts`, so `vitest.config.ts` with `test.projects`; wire `Localized.hi` is `string|null` (domain: optional), mapping code must drop nulls; check-secrets.sh skips `planning/` (docs quote the patterns). Next: T03 engine. Not done: Prettier/ESLint config beyond defaults, Playwright browsers not installed.
- T04 — 2026-11-18 — done — `core/crypto` (keys, quoteToken, launchRecord) + `orders/stateMachine`; `scripts/gen-keys.ts`; U-SIG-1..6, U-SM-1..3 green (17 tests). Decisions: keys are base64 (private PKCS#8 DER, public raw 32 B); `verifyQuoteToken` checks signature → payload shape → expiry → policy hash; `verifyLaunchRecord` takes the trusted public key from the caller (env), never from the file, and requires the embedded key to match; token `request` and gap `code` typed structurally (no engine dependency); invalid transition code `INVALID_TRANSITION` (not in 04 §6, shop should map to 409). gen-keys refuses to overwrite without `--force`. Issue: `tsc` fails on untracked T03 tests (engine/dates exports missing from index), not part of T04. Next: T03 engine exports, then T05 persistence.
- T01 — 2026-11-18 — **BLOCKED (partial)** — no Economy subscription (`totalAvailableSlots: 0`), no domain/mailbox: T00 purchases not done, and I never purchase. Done: `spike/` built and verified locally (healthz/ip/env/db/mail/sse/MCP stateless), `scripts/set-secrets.mjs`, the single app `agentdoor-shop` created (id in `.agentdoor/deploy.json`), spike uploaded to PREVIEW (import ~10 s). Details in `spike/RESULTS.md`. Next: you buy Economy (T00), then resume at `subscription attach`. Also needs `CONTACT_FORM_RECIPIENT_EMAIL` in private/ACCOUNT_FACTS.md (not recorded yet).

## Review findings (R0–R4)
<!-- ID — gate — severity — finding — fix task — status -->
R0 run 2026-11-18 19:10 IST. Verdict: **CONDITIONAL GO**. All P0 fixes applied to planning docs 2026-11-18 ~20:15 IST.
- R0-1 — P0 — Judges can't experience the launcher: public URL is only the storefront. Fix: public replay-mode launcher at `/try` on the same app + storefront ribbon + mandatory video. Tasks T09/T10/T12. — fixed in docs
- R0-2 — P0 — Schedule over-subscribed (lane A ≈ 18 h on paper, no slack). Fix: apply cuts now (merge launcher to 4 pages, drop S3 polling/S6/QR/capacity bars/`get_order_status`/Haiku explain, linear deploy script, 1 clarify round, R1+R3 skipped). — fixed in docs
- R0-3 — P0 — Purchases gated behind T01a for no benefit; delays MCP/DNS/TLS/DB discovery ~10 h. Fix: buy Economy + domain tonight on godaddy.com (INR cart authoritative); merge T01a/b. — fixed in docs
- R0-4 — P0 — Compiler structured-output schema will 400: `provenance` is a dynamic-key map; numeric/string bounds unsupported. Fix: wire schema returns `policy` + `evidence[]` array; code builds provenance; bounds in Zod only. T02/T07. — fixed in docs
- R0-5 — P0 — Time-dependent fixtures: prompt hash includes today's date; recorded scenarios carry absolute dates that go stale during judging. Fix: fixtures keyed by id, injected clock, scenarios use `daysAhead`. T07/T08. — fixed in docs
- R0-6 — P0 — Order txn as specified deadlocks under contention (`INSERT IGNORE` inside txn) and returns QUOTE_ALREADY_USED on concurrent idempotent retry. Fix: ledger row created before BEGIN; one conditional UPDATE; retry ×3; re-read by idempotency key on duplicate. `03` §5.2, T05. — fixed in docs
- R0-7 — P0 — Per-IP rate limits behind GoDaddy CDN: one shared bucket (429 for judges, owner lockout) or spoofable XFF. Fix: spike measures proxy hops; exact `trust proxy`; MCP 120/min. T01/T06. — fixed in docs
- R0-8 — P0 — Budget enforcement: per-task caps with human cost checkpoints; T05 on Sonnet. — fixed in docs
- R0-9 — P0 — (superseded by revision 2: secrets via official `updateSecrets` JSON body through `gddy api call --file`; argv never used) `gddy hosting secret sync` takes values only via argv (verified); plan's "never argv" + I-DEP-8 unsatisfiable. Fix: accept local argv; assert no secrets in logs/state/zip; set secrets on both variants. `03` §5.6, T09. — fixed in docs

## Open issues / requests between lanes
<!-- lane B → lane A core change requests go here -->
