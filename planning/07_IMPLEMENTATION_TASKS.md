# 07 — Implementation Tasks

Times are wall-clock for one Claude Code session with the human reviewing. Cost = expected Claude API spend. Cap = hard per-task stop: at the cap, the agent stops, commits WIP, writes STATUS, and the human decides. Test IDs refer to `08`.

Model legend: **S** = `claude-sonnet-5-5`, **H** = `claude-haiku-5-5` (subagent only). Effort is set with Claude Code `/effort` or the `--effort` flag if available; otherwise state it in the prompt.

## 1. Dependency graph and critical path

```
T00 (human: keys + approved purchases TONIGHT) ──▶ T01 spike (preview → publish, same app) ─────┐
T02 scaffold+schemas+hash ─▶ T03 engine ─┬─▶ T05 shop data ─▶ T06 shop HTTP/MCP ─▶ T09 deploy ─▶ T12 E2E/hardening ─▶ T13 launch+submit
             └─▶ T04 signing ────────────┘        ▲                    │                ▲
             └─▶ T07 Claude+compiler ─▶ T08 rehearsal+gate ─▶ T10 launcher UI ─────────┘
                                                                        T06 ─▶ T11 shop UI ──────┘
```

**Critical path:** T00 → T01 → T05 → T06 → T09 → T12 → T13 (T02→T03→T04 run during T00/T01 and must land before T05).
**Parallel lane B (second Claude Code session, disjoint dirs):** T07 → T08 → T10.
**Parallel lane C:** T11 after T06 (can share lane A's session after T09).

## 2. Schedule (IST). Submit target: Fri 20 Nov 18:00

| Window | Lane A (critical) | Lane B | Human |
|---|---|---|---|
| Wed 18 Nov 19:45–21:00 | T02 | — | **T00: keys, Console limits, submission time; approve + buy Economy and domain on godaddy.com (INR cart), mailbox** |
| 21:00–23:00 | T01 spike (create app → preview → attach → publish → MCP/DB/mail/proxy/redeploy) | — | Claude.ai connector test when T01 asks |
| 23:00–01:00 | T03, then T04 | T07 start (needs T02 only) | Record STATUS, sleep |
| Thu 19 Nov 08:30–12:30 | T05 | T07 finish → T08 | Real baker input (B9) by 11:00 |
| 12:30–16:00 | T06 | T08 finish | review R2 after T06 |
| 16:00–17:00 | — | — | Office hours: confirm submission time |
| 17:00–21:00 | T09 + first real deploy | T10 | |
| 21:00–00:30 | T11 (incl. S8 `/try`) | T10 finish, `export-demo` from a fixture run | — |
| Fri 20 Nov 08:00–11:00 | T12 | (merge, fix) | **Feature freeze 11:00** |
| 11:00–15:00 | T13 production launch, demo data | — | Record video, write brief |
| 15:00–18:00 | buffer / fixes only | — | review R4, **submit by 18:00** |

## 3. Tasks

### T00 — Human setup and purchases TONIGHT (no Claude API cost) (R0-3)
- **Objective:** unblock the public URL, domain and mailbox now. They're mandatory whatever the spike finds, and DNS/TLS/DB discovery needs hours of lead time. The credit expires 23 Nov.
- **Deps:** none. **Owner:** you. Approvals and spend log: `private/GODADDY_LEDGER.md`.
- **Steps:** (1) Check the HackerEarth dashboard for the exact submission time; record it in STATUS. (2) Claude Console: confirm the $100 balance; create workspace `agentdoor`, keys `agentdoor-dev` and `agentdoor-runtime`; no payment method; $90 workspace spend limit if offered. (3) On **godaddy.com** (the organizers' instructed path; the INR cart is authoritative, CLI USD prices are indicative): add Economy Node.js hosting **1-month** + domain (`agentdoor.shop` default) → check the cart total incl. GST is fully covered by the in-store credit → **you approve and place the order**. (4) Mailbox: Titan Pro Light, 1-month term if the site offers it (the deck says it does), else the free trial only if no card is required, else 1-year $23.88 if the remaining credit covers it. Create the mailbox (`gddy email check-eligibility` → you run `gddy email create`), send a Gmail test email, confirm arrival. (5) Turn off auto-renew. (6) Fill `.env.local` (gitignored). (7) In a plain shell, `env | grep ANTHROPIC` prints nothing.
- **Acceptance:** STATUS lists submission time, Console balance, spend-limit availability, subscription id, domain, mailbox; GODADDY_LEDGER spend ≤ $40 with order ids.
- **Time:** 45 min. **Recovery:** cart total > credit → drop the mailbox upgrade (try the trial), or pick a cheaper TLD; ask at office hours (19 Nov 16:00). Never pay with a card without your decision.

### T01 — Feasibility spike (B3–B7), one session (merged, R0-3)
- **Deps:** T00 (Economy bought; domain bought or pending). **Files:** `spike/**` only.
- **Flow:** reuse or create the single app `agentdoor-shop` → upload to PREVIEW → attach Economy → secrets via `scripts/set-secrets.mjs` (JSON body through `gddy api call --file`, PREVIEW and PUBLISH configured separately; never argv) → publish → public checks → domain attach → mail → restart + redeploy persistence. Save the app id to `.agentdoor/deploy.json`.
- **Must measure (proxy topology):** `/spike/ip` echoes `req.socket.remoteAddress`, `X-Forwarded-For`, `X-Real-IP`, `Forwarded` from two different client networks (laptop + phone hotspot). Record the observed proxy peer addresses/CIDRs and chain length, and decide the exact `trust proxy` value (address list preferred, verified hop count otherwise, never `true`). Also the managed MySQL version and `max_connections`, and whether `DB_*` exist (the GoDaddy skill calls MySQL "optional"; if absent, check the hosting dashboard for an enable-database toggle).
- **Guidance:** see `02` §6. Copy GoDaddy's `sendEmail()` helper byte-for-byte (JS variant). `mysql2/promise` pool from `DB_*`. MCP: `McpServer` + `StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true})`, a new transport per request (stateless pattern). Deploy with raw `gddy` commands and capture every JSON response into `spike/RESULTS.md`.
- **Acceptance:** the 6 pass criteria in `02` §6; RESULTS.md holds the exact gddy commands, timings, PREFIX URL, and MCP result. Domain attached and HTTPS verified (or polling). `gddy hosting app list --app-type NODEJS` shows exactly one app; subscription shows 0 available slots used by anything else.
- **Tests:** manual curl script `spike/check.sh`.
- **Model:** S, effort medium. **Cost:** $3.00. **Cap:** $4. **Time:** 2 h.
- **Recovery:** MCP fails → record the fallback decision (`02` B3) and proceed; mail fails → ask office hours, continue (contact messages stored in DB).

### T02 — Monorepo scaffold, schemas, canonical hash
- **Deps:** none. **Files:** root configs, `packages/core/src/schema/**`, `hash.ts`, `docker-compose.yml`, `.gitignore`, `.npmrc`, `vitest.workspace.ts`, `scripts/check-secrets.sh`.
- **Contracts:** `04` §1, §3 (hash), §7 (config schema stub).
- **Guidance:** `git init` first, then npm workspaces; TS strict; ESM. Zod schemas export their inferred types. `canonicalJson` rejects non-integer numbers. Add a fixture `packages/core/test/fixtures/policy.bakery.json` (complete valid policy for "Meera's Kitchen", Pune) used by all later tests. Secret-scan script greps for `PRIVATE KEY`, `sk-ant-`, `DB_PASSWORD=` in tracked files.
- **Acceptance:** `npm ci && npm test` green from a fresh clone; schema tests U-SCH-1..4, U-HASH-1..3 pass; `docker compose up -d mysql` works.
- **Guidance (added):** install **all** runtime and dev dependencies for every workspace now (express, zod, mysql2, MCP SDK, Anthropic SDK, express-rate-limit, vitest, fast-check, esbuild, tsx, playwright) so the lanes never fight over `package-lock.json`. Create `packages/ui` as an empty workspace for lane B.
- **Model:** S, effort medium. **Cost:** $3.00. **Cap:** $4. **Time:** 60 min.
- **Recovery:** if Zod's JSON-schema export is missing, add `zod-to-json-schema`.

### T03 — Deterministic engine + property tests
- **Deps:** T02. **Files:** `packages/core/src/engine/**`, `rehearsal/probes.ts`, `rehearsal/lint.ts`, `rehearsal/classify.ts`, tests.
- **Contracts:** `04` §2 (order of checks, reason codes); `05` §5.1–5.2 (probe families, gap codes).
- **Guidance:** IST arithmetic with a fixed +330 min offset; fulfilment instant = date 10:00 IST; rush when `hoursUntil < rush.withinHours`; percent surcharge in basis points with integer rounding half-up on the subtotal; delivery area match = trim + lowercase exact against name/aliases. Probes are generated from the policy (no randomness except a seeded PRNG for baskets).
- **Acceptance:** U-ENG-1..12, P-ENG-1..4 pass; the seeded-leaky policy fixture yields gaps {NO_CAPACITY_LIMIT, RUSH_UNBOUNDED, UNLISTED_AREA_POLICY}; ≥95% line coverage on `engine/`.
- **Model:** S, effort high. **Cost:** $4.00. **Cap:** $5. **Time:** 90 min.

### T04 — Signing: quote tokens + launch record + order state machine
- **Deps:** T02. **Files:** `packages/core/src/crypto/**`, `orders/stateMachine.ts`, tests.
- **Contracts:** `04` §3; `03` §5.3.
- **Guidance:** `crypto.generateKeyPairSync('ed25519')`, export PKCS8/SPKI base64; `crypto.sign(null, data, key)`. Verify order: parse → signature → `exp` → `policyHash` → schema. Constant-time compare is not needed for signatures (the library verifies). Provide `scripts/gen-keys.ts`.
- **Acceptance:** U-SIG-1..6, U-SM-1..3 pass.
- **Model:** S, effort medium. **Cost:** $2.00. **Cap:** $2.50. **Time:** 45 min.

### T05 — Shop data layer: migrations, order transaction, capacity, idempotency
- **Deps:** T03, T04, T01 (MySQL facts). **Files:** `apps/shop/src/db/**`, `apps/shop/src/config.ts`, `apps/shop/test/integration/**`.
- **Contracts:** `04` §6–7; `03` §5.2–5.4.
- **Guidance:** `mysql2/promise` pool (connectionLimit 10). `placeOrder(verifiedQuote, customer, idemKey, channel)` exactly per the revised `03` §5.2 sequence (ledger row before BEGIN, one conditional UPDATE for both counters, DUPLICATE path re-reads by idempotency key). Global lock order `quote_redemptions → capacity_ledger → orders → audit_events` in **both** `placeOrder` and `transitionOrder`; bounded retry ≤3 with explicit ROLLBACK and jitter. Pool `connectionLimit: 5`. `transitionOrder(id, from, to)` with capacity release. Migrations under `GET_LOCK`. Boot guard function `loadLaunchState()` (pure-ish: reads bundle files, verifies). Integration tests run against docker MySQL (`DB_*` from compose).
- **Acceptance:** I-ORD-1..8 and C-CAP-1 (20 parallel → exactly 5, zero deadlock errors surfaced) pass; U-GATE-4 (boot guard rejects edited policy) passes.
- **Model:** S, effort **high** (R0-8: Opus would cost ~$10–12 here; correctness is backed by C-CAP-1, I-ORD-7 and the R2 review instead). **Cost:** $6.00. **Cap:** $9. **Time:** 2 h.
- **Recovery:** if MySQL is unavailable on the host (B4 failed), implement the `Repo` interface with an in-process store + snapshot file, keep the same tests (capacity atomicity is trivial in a single process), and document the limit.

### T06 — Shop HTTP surface: REST, MCP, owner auth, contact, security middleware
- **Deps:** T05. **Files:** `apps/shop/src/routes/**`, `security/**`, `email.ts`, `server.ts`, tests.
- **Contracts:** `04` §4–5; `03` §6–7.
- **Guidance:** one `quoteService`/`orderService` used by both REST and MCP (no duplicated logic). MCP stateless per request. Owner session cookie = `base64url(payload).hmac`, payload `{iat, exp}`. Login compares `sha256(token)` with `OWNER_TOKEN_HASH` via `timingSafeEqual`. Origin check on owner POSTs and `/contact`. `express.json({limit:'16kb'})`. Rate-limit buckets per `04` §4 (`mcp-read`, `quote-rest`, `order-create` shared by MCP `place_order` and REST orders, `contact`, `owner-auth`, `try`); the MCP route charges by tool name before dispatch; `trust proxy` = the exact topology recorded in STATUS (never `true`). JSON 404 for `/.well-known/oauth-*`. Origin check allows `PUBLIC_BASE_URL` **and** the platform PREFIX URL. Use the vended `sendEmail` helper verbatim. Templates in this task can be bare (T11 styles them), but must escape output.
- **Acceptance:** I-MCP-1..4, I-API-1..8, SEC-1..7, I-MAIL-1 (mock gateway locally) pass. Claude Code connected via `claude mcp add --transport http local http://localhost:3000/mcp` completes quote → order.
- **Model:** S, effort high. **Cost:** $6.00. **Cap:** $8. **Time:** 2 h.

### T07 — Claude client + compiler + clarification
- **Deps:** T02. **Files:** `apps/launcher/src/claude/**`, `flows/compile.ts`, `flows/clarify.ts`, `store/**`, `fixtures/**`, tests.
- **Contracts:** `05` §2–4; `04` §1 CompileResult.
- **Guidance:** follow the claude-api skill (TypeScript SDK, `output_config.format`, no temperature, fallbacks). Wire schemas per `04` §1 (no dynamic keys, no numeric/length bounds); fixtures keyed by `fixtureId`; clock from `AGENTDOOR_NOW`; one clarify round. Write prompts as Markdown files. Record fixtures once (`AGENTDOOR_LLM_MODE=record`) for the 4 transcripts; commit them. Score compile accuracy against `expected/*.json` in a test (≥90% of required paths correct for en/hinglish; ≥80% for hi).
- **Acceptance:** U-CMP-1..6, U-BUD-1..3 pass in replay mode; live recording total cost ≤ $1 (log in COST_LEDGER runtime row).
- **Model:** S, effort high. **Cost:** $6.00 (+$1 runtime recording). **Cap:** $8. **Time:** 2 h.

### T08 — Rehearsal runner, scenarios, explanations, gap fixes, launch gate
- **Deps:** T03, T04, T07. **Files:** `apps/launcher/src/flows/{rehearse,scenarios,gapText,gate,exportDemo}.ts`, tests, fixtures.
- **Guidance:** scenarios use the `daysAhead` wire shape; gap text from templates (no explain call); `export-demo` per `04` §9.
- **Contracts:** `05` §5–6; `04` §3 LaunchRecord.
- **Acceptance:** U-REH-1..5, U-GATE-1..3, U-DEMO-1 pass in replay mode; seeded-leaky → ≥3 critical gaps → apply fixes → 0 critical → signed launch record verifies.
- **Model:** S, effort high. **Cost:** $5.00 (+$0.40 runtime recording). **Cap:** $6. **Time:** 2 h.

### T09 — Deploy adapter (pack + gddy + linear idempotent script + smoke)
- **Deps:** T01, T06 (a buildable shop), T04. **Files:** `apps/launcher/src/deploy/**`, `scripts/deploy.ts`, tests (gddy mocked via a fake binary on PATH).
- **Guidance:** `execFile('gddy', args, {timeout})` with JSON parsing; never a shell string. Steps per `06` L4. A linear script: each step checks remote state before acting, so rerunning after a failure continues (only `appId` persisted). Secrets from generated keys in `.agentdoor/secrets/{preview,publish}.json` (chmod 600, gitignored), applied through `scripts/set-secrets.mjs` (`03` §5.6: JSON Patch body via temp file + `gddy api call --file`, PREVIEW and PUBLISH separately, names-only logging, never argv). Parse stdout only. Smoke test: `/healthz` policyHash equals expected; `/api/business` 200; `POST /api/quotes` with a known-good request returns QUOTED. Re-checks the gate before pack (U-GATE-3).
- **Guidance (added):** never `app create` if `.agentdoor/deploy.json` or an app named `agentdoor-shop` exists (`03` §5.5 rule 1). Preview stage = upload + import COMPLETED + boot log line `{"event":"boot","launched":true,"policyHash":…}` seen via `gddy hosting log list --variant PREVIEW`; no writes. Secrets via the body-based helper only.
- **Acceptance (deployment gate, all required):**
  1. **Live public storefront:** `https://<domain>/` returns 200 over HTTPS with the bakery menu rendered from the bundled policy (I-DEP-4).
  2. **Working MCP endpoint:** `https://<domain>/mcp` answers `initialize` and `tools/list` (3 tools) from an external client, and `get_quote` returns a signed quote (I-DEP-5).
  3. **Database persistence:** a `[TEST]` order placed via MCP is visible in the owner dashboard, survives `gddy hosting app restart --variant PUBLISH`, and survives a full redeploy; then it's declined and capacity is released (I-DEP-6).
  4. **Successful redeployment:** a second deploy with a changed, re-gated policy reuses the same app id and URL (no new app, no new slot), `/healthz` shows the new policyHash, and a quote signed under the old hash is refused `QUOTE_STALE_POLICY` (I-DEP-7).
  5. I-DEP-1..3 (mocked) pass; real deploy timings recorded in STATUS.
- **Model:** S, effort medium. **Cost:** $4.00. **Cap:** $5. **Time:** 90 min.

### T10 — `packages/ui` components + launcher UI (L1–L4)
- **Deps:** T07, T08 (APIs), T09 (deploy job API; stub allowed until ready). **Files:** `packages/ui/**`, `apps/launcher/src/views/**`, `public/**`, `server.ts` routes.
- **Guidance:** build `packages/ui` first (tokens.css, html escape tag, RuleCard, ReceiptSlip, GapCard, DoorGate, StepTimeline, StatusChip as pure functions returning HTML strings, also used by the shop's `/try`). Then pages L3, L2, L4, L1 (demo-critical first). Vanilla JS polling.
- **Acceptance:** E2E-1 (fixture mode: describe → questions → rules → rehearsal → fixes → gate) passes; A11Y-1 on L2/L3; screenshots at 375 and 1440 in `docs/screens/`.
- **Model:** S, effort medium. Use an **H** subagent only for the EN/Hinglish string table. **Cost:** $6.00. **Cap:** $8. **Time:** 2.5 h.

### T11 — Shop UI (S1–S5, S7, S8 `/try`)
- **Deps:** T06, T10 (`packages/ui`). **Files:** `apps/shop/src/views/**`, `apps/shop/src/routes/try.ts`, `public/**`.
- **Guidance:** ribbon on every page (`06` §3). `/try` has persistent nav (Storefront · Launch report · Watch demo), the embedded video and the three provenance badges (`04` §9, `06` S8). `/try` renders `bundle/try/session.json` with `packages/ui`, re-running engine/probes/linter live with the current time; until T13 exports the real session, use the fixture-mode export.
- **Acceptance:** E2E-2 (human order flow), E2E-4 (owner confirm), E2E-5 (`/try` replay), A11Y-2..3, no JS required for S2 basic flow and `/try`; S5 renders from the bundled launch record.
- **Model:** S, effort medium. **Cost:** $5.00. **Cap:** $7. **Time:** 2.5 h.

### T12 — End-to-end, security pass, fresh-clone check, fixes
- **Deps:** T06, T08, T09, T10, T11. **Files:** `e2e/**`, fixes anywhere (small).
- **Acceptance:** whole `08` suite green; SEC-1..12 checklist ticked; `scripts/fresh-clone-check.sh` (clone to tmp, `npm ci`, compose up, `npm test`, `npm run e2e`) passes; `npm audit --omit=dev` no high/critical.
- **Model:** S, effort high. **Cost:** $5.00. **Cap:** $6. **Time:** 2–3 h.

### T13 — Production launch, demo data, submission assets
- **Deps:** T12, T00. **Files:** `README.md`, `docs/BRIEF.md`, `docs/architecture.svg`, `docs/demo-script.md`.
- **Steps:** run the launcher live on the real (consented) baker transcript or the illustrative persona → `npm run export-demo` (real session → `bundle/try/session.json`) → deploy to the live domain → verify HTTPS, contact form → mailbox, MCP via Claude.ai connector → reset demo orders (owner declines test orders; the DB keeps them, which is fine) → record video (`11`) → fill submission.
- **Acceptance:** I-DEP-4..7 re-run on the final production deploy; SUB-1..3 in `08`; live demo run twice from a clean launcher state in < 3 min each; GODADDY_LEDGER total ≤ $40.
- **Model:** S, effort low/medium. **Cost:** $3.00 (+$2 runtime live runs). **Cap:** $4. **Time:** 3 h. The demo video is **mandatory** (R0-1).

### T14 — OPTIONAL stretch: live `/try/live` (S-LIVE)
- **Start only if:** every mandatory requirement R1–R20 passes (T12 green, T13 deployed and `/try` replay live) **and** the Claude ledger total is ≤ $75 at that moment, so worst case stays under the $85 stop.
- **Deps:** T13. **Files:** `apps/shop/src/routes/tryLive.ts`, `apps/shop/src/db/tryBudget.ts`, a thin compile call reusing launcher prompt + wire schema (bundled), tests.
- **Contract:** `04` §9 optional live mode: access code, compile only, hard $5 application budget via atomic reserve/settle in MySQL, 3 compiles/code/hour, disabled unless `TRY_LIVE_ENABLED=1`.
- **Acceptance:** I-TRY-1..3; enabling it does not change any mandatory test result; budget meter visible.
- **Model:** S, medium. **Cost:** $2.00. **Cap:** $3. Runtime exposure: hard $5 (application budget). **Time:** 90 min.

## 4. Cut list

**Already cut (R0-2, applied to the specs):** launcher reduced to 4 pages; QR code; S6 explainer page (moved into `/try` intro); S3 polling; `get_order_status` MCP tool; owner capacity bars; Haiku explain call (templates instead); second clarify round; resumable deploy state machine (linear idempotent script); reviews R1 and R3.

**If still behind, cut next in this order:**
1. Hindi storefront strings (keep Hindi read-backs in the launcher; they're core to R1).
2. Claude scenario generation → 6 committed hand-written Hinglish scenarios (say so honestly on `/try`).
3. Owner dashboard contact-messages tab (messages still reach the mailbox).
4. Launcher L1 polish (plain styling).

**Never cut:** R15–R20 (organizer-mandatory + judge access via `/try` + video), the deployed shop, MCP quote → order, signed quotes, atomic capacity, rehearsal gaps + gate, launch report.

## 5. Context strategy for implementation sessions

- One task per fresh Claude Code session; the prompt explicitly loads CLAUDE.md and names the exact `planning/` sections to read (never "read the whole repo").
- `CLAUDE.md` stays ≤120 lines; contracts live in `planning/04`, so the agent reads only the sections cited.
- End of task: run tests, commit (`feat(scope): …`), append to `STATUS.md` (≤10 lines: done, decisions, open issues, next), add a `private/COST_LEDGER.md` row with `/cost` output. Then `/clear` or exit.
- Two lanes never edit the same directories: lane A owns `apps/shop`, `spike`, `packages/core`, `e2e`; lane B owns `apps/launcher`, `packages/ui`. Run lane B in a separate git worktree (`git worktree add ../agentdoor-b`) and merge at milestones. Core changes requested by lane B are posted in STATUS as a request.
