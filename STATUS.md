# STATUS — compact progress and handoff

Keep this under ~150 lines. Newest entries on top within each section. Each task appends ≤10 lines.

## Now
- Phase: **IMPLEMENTATION READY** (2026-11-18 ~20:40 IST), subject only to the live-platform feasibility tests in T01: MCP via the GoDaddy CDN to a Claude connector; managed MySQL present + `max_connections`; mail gateway → mailbox; proxy topology for `trust proxy`; `updateSecrets` via `gddy api call --file` per variant; persistence across restart and redeploy. Plus the checkout total in INR (T00).
- Next: **T00** tonight (you: submission time, Console keys, approve/buy Economy + domain + mailbox after checking the final INR total) and **T02** in parallel → **T01** spike.
- No product code yet. Claude spend so far: $0. GoDaddy spend so far: $0.
- Deadline: Fri 20 Nov 2026. Exact submission time: **UNCONFIRMED**. Assume 18:00 IST.
- Reviews remaining: **R2** (after T06) and **R4** (before submit). No further architecture reviews unless a fatal feasibility blocker appears.

## Platform facts (public-safe; account details live in `private/ACCOUNT_FACTS.md`)
| Item | Value |
|---|---|
| Submission deadline (exact) | |
| MCP via CDN (curl / Claude.ai connector / Claude Code) | |
| `DB_*` present; MySQL version / `max_connections` | |
| Proxy topology → `trust proxy` value | |
| Mail gateway → mailbox delivered | |
| `updateSecrets` via `gddy api call --file`: works per variant? | |
| Persistence across restart + redeploy | |
| Redeploy wall time | |

## Decisions (append; never edit past entries)
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
