# 08 — Test and Security Plan

Tooling: `vitest` (unit/integration), `fast-check` (property), Playwright + `@axe-core/playwright` (E2E, a11y), docker `mysql:8` (integration). Routine runs **never call Claude**: `AGENTDOOR_LLM_MODE=replay` is the default under `vitest`, and `FIXTURE_MISSING` fails the test. Live-model tests are tagged `@live` and excluded from `npm test`.

Clock: all core functions take `nowMs`; tests use fixed instants (e.g. `2026-11-19T10:00:00+05:30`).

## 1. Fixtures (defined up front)

| Fixture | Content | Used by |
|---|---|---|
| `policy.bakery.json` | Complete valid policy "Meera's Kitchen", Pune: 4 items (choco cake ₹600/kg max 3 kg, eggless vanilla ₹650/kg, cookie box ₹350/box, brownie dozen ₹480); `unitsPerDay 10`; closed Mon; `minLeadHours 48`; rush within 24 h +₹200 flat, max 2 rush units/day; pickup Baner; delivery areas Baner ₹0, Aundh ₹80, Wakad ₹120, Hinjewadi ₹150 (alias "hinjawadi"); unlisted REFUSE; min order ₹300; quote validity 30 min; all provenance approved | engine, signing, shop tests |
| `policy.seeded-leaky.json` | Same but `capacity.unitsPerDay` default-proposed (500), rush with default cap, `unlistedArea` default ASK_OWNER, one low-confidence price | rehearsal, gate |
| `transcripts/{en,hi,hinglish,seeded-leaky}.txt` + `expected/*.json` | Owner descriptions; expected required-path values | compiler accuracy |
| `fixtures/llm/<fixtureId>.json` | Recorded Claude responses keyed by fixture id (compile ×4, recompile ×1, scenarios ×1) | launcher tests |
| `fixtures/demo/session.json` | Fixture-mode export of the seeded run (`04` §9) | `/try` tests until T13 replaces it |
| `requests/*.json` | Named quote requests (valid basket, rush, closed day, unlisted area, haggle-notes twin pair) | engine, API, MCP |

## 2. Test catalog (ID → expectation)

### Schemas and hash (T02)
- **U-SCH-1** Valid fixture parses; inferred type matches.
- **U-SCH-2** Unknown key at any level → rejected (`strict`).
- **U-SCH-3** Float price (`600.5`) → rejected; negative → rejected; string over max length → rejected.
- **U-SCH-4** `negotiation` other than `'NEVER'` → rejected (a discount can't even be expressed).
- **U-HASH-1** Same object with permuted keys → identical hash.
- **U-HASH-2** Any single-field change (including a provenance status) → different hash.
- **U-HASH-3** `canonicalJson` throws on non-integer number, `undefined`, function.

### Engine (T03)
- **U-ENG-1** Valid basket: line totals, fee and total exact (hand-computed in the test).
- **U-ENG-2** Lead time: 47 h59 m → `LEAD_TIME_NOT_MET`; 48 h → QUOTED.
- **U-ENG-3** Prep hours > lead → uses prep.
- **U-ENG-4** Rush: inside 24 h with rush enabled and lead satisfied → `RUSH_APPLIED`, +₹200. If rush disabled → `RUSH_NOT_OFFERED`.
- **U-ENG-5** Closed weekday and closed date → `CLOSED_DAY`.
- **U-ENG-6** Beyond `maxAdvanceDays` → `TOO_FAR_AHEAD`.
- **U-ENG-7** Qty < min / > max → refused with the specific code.
- **U-ENG-8** Area match: `"  HINJAWADI "` → Hinjewadi fee; `"Kothrud"` → `AREA_NOT_SERVED` (REFUSE) / `AREA_NEEDS_OWNER` (ASK_OWNER).
- **U-ENG-9** Below min order → `BELOW_MIN_ORDER`.
- **U-ENG-10** Single order exceeding day capacity → `CAPACITY_FULL`.
- **U-ENG-11** Unknown item/option → `UNKNOWN_ITEM`.
- **U-ENG-12** Percent rush surcharge rounding (basis points, half-up) exact for 3 hand cases.
- **P-ENG-1** Determinism: ∀ valid (policy, request, now): `evaluate` twice → deep-equal.
- **P-ENG-2** Notes invariance: ∀ request: result(request) deep-equals result({...request, notes: arbitrary string incl. injection text}).
- **P-ENG-3** Arithmetic: ∀ QUOTED: `total = Σ lineTotal + deliveryFee + rushSurcharge`, all ints ≥ 0.
- **P-ENG-4** Monotonic lead time: if QUOTED at time t for date d, then also not refused for lead reasons at any t' < t.
- **U-REH-1** Probe generator covers every family in `05` §5.1 for the bakery fixture (≥25 probes) and all PASS.
- **U-REH-2** Seeded-leaky → gaps ⊇ {NO_CAPACITY_LIMIT, RUSH_UNBOUNDED, UNLISTED_AREA_POLICY, LOW_CONFIDENCE_SOURCE}.

### Signing and state machine (T04)
- **U-SIG-1** Sign → verify round-trip OK.
- **U-SIG-2** Tampered payload (total −1) → `QUOTE_INVALID`.
- **U-SIG-3** Different policyHash than current → `QUOTE_STALE_POLICY`.
- **U-SIG-4** `exp` in past → `QUOTE_EXPIRED`.
- **U-SIG-5** Token signed by a different key → `QUOTE_INVALID`.
- **U-SIG-6** Launch record signature verifies; editing `criticalOpen` breaks it.
- **U-SM-1** Allowed transitions succeed; **U-SM-2** forbidden (e.g. DECLINED→CONFIRMED) rejected; **U-SM-3** releases-capacity flag correct per transition.

### Shop data + concurrency (T05, docker MySQL)
- **I-ORD-1** Valid quote → order persisted `PENDING_OWNER`; capacity reserved = units; redemption row exists; audit row exists.
- **I-ORD-2** Same quote second order (different idem key) → `QUOTE_ALREADY_USED`; capacity unchanged.
- **I-ORD-3** Same idem key + same body → same orderId, 200, one row only.
- **I-ORD-4** Same idem key + different body → `IDEMPOTENCY_CONFLICT` 409.
- **I-ORD-5** Decline releases capacity; double decline → 409; confirm after decline → 409.
- **I-ORD-6** Rush cap: third rush unit on a day with cap 2 → `RUSH_CAP_REACHED`.
- **I-ORD-7** Concurrent idempotent retry: two simultaneous `placeOrder` calls with the same quote **and** same idempotency key → both return the same orderId (one 201, one 200); never `QUOTE_ALREADY_USED`. Rush + normal orders racing on one date never exceed either counter.
- **I-ORD-8** Lock ordering: 10 concurrent `placeOrder` + 10 concurrent `transitionOrder(DECLINED)` on the same date → no deadlock surfaced; final `reserved_units` equals the sum of non-declined orders; every failed attempt left no partial rows (redemption without order, or units without order).
- **C-CAP-1** 20 concurrent `placeOrder` (distinct quotes, 1 unit each) on capacity 5 → exactly 5 succeed, 15 `CAPACITY_FULL`, `reserved_units = 5`, **zero** deadlock/lock-wait errors surfaced to callers (internal retries allowed). Repeat 5 times (flake check).
- **U-GATE-4** Boot guard: edited policy (one price) with original launch record → `launched=false`, quote → `SHOP_NOT_LAUNCHED` 503.

### Shop HTTP / MCP (T06)
- **I-API-1** `POST /api/quotes` valid → 201 token; invalid JSON → 400 envelope; refused → 422 with reasons.
- **I-API-2** Body > 16 KB → 413/400; notes > 500 → 400.
- **I-API-3** `GET /api/orders/:id` with wrong token and nonexistent id → identical 404 bodies.
- **I-API-4** Rate limit: 21st quote/min → 429 + `Retry-After`.
- **I-API-5** Every response has security headers (§04-4) and `requestId`.
- **I-API-6** Expired quote order → 410 `QUOTE_EXPIRED`; stale policy → 410.
- **I-API-7** Proxy trust: with `trust proxy = N` (from T01), a forged extra `X-Forwarded-For` entry from the client does not change the rate-limit key; two different real client IPs get separate buckets; `/.well-known/oauth-authorization-server` returns JSON 404.
- **I-API-8** Separate buckets: exhausting `mcp-read` (121 `get_quote` calls) does not block `place_order`, and exhausting `order-create` (21 orders across MCP + REST combined) does not block `get_quote`; `contact` and `owner-auth` limits are independent of both.
- **I-MCP-1** `initialize` + `tools/list` → exactly 3 tools with schemas.
- **I-MCP-2** `get_quote` → `place_order` → order exists, channel `mcp`.
- **I-MCP-3** Malformed inputs (missing fields, wrong types, extra fields, 10 MB string, negative qty, `itemId: "../../etc"`) → `isError` with `VALIDATION_FAILED`; server stays healthy.
- **I-MCP-4** `get_quote` with haggling notes → same total as without; tool description states fixed prices.
- **I-MAIL-1** Contact form → message row stored → `sendEmail` called with recipient from env (mock gateway on 127.0.0.1:2525 in test); gateway 500 → stored with `FAILED`, user sees generic text, raw error only in logs.

### Launcher (T07–T09)
- **U-CMP-1..3** Replay compile for en/hinglish/hi → valid policy; required-path accuracy ≥ 90%/90%/80% vs expected; read-back language matches.
- **U-CMP-4** Seeded-leaky compile → `questions` length 1–5, each references a missing critical path.
- **U-CMP-5** Verbatim check: fabricated quote (not in transcript) → downgraded to `owner_edit`, confidence low, status proposed.
- **U-CMP-7** Wire schema check: the JSON Schema sent to Claude contains no dynamic-key objects, every object has `additionalProperties: false`, and there is no `minimum`/`maximum`/`minLength`/`maxLength`/`pattern`; domain bounds are still enforced after parsing (out-of-range price → repair path).
- **U-PROV-1** Two-way provenance coverage: every required path and every non-template policy leaf has provenance; every provenance key resolves to a real policy path; the gate fails when either direction is violated (remove one evidence item → gate blocked; add an orphan → dropped and logged).
- **U-CMP-6** Invalid structured output → one repair attempt → second failure surfaces error, no policy file written.
- **U-FIX-1** Replay is date-independent: run the replay suite with `AGENTDOOR_NOW` set to 3 different dates (today, +10 days, +25 days) → same fixtures load, scenario dates resolve relative to each, results stay consistent.
- **U-BUD-1** Budget guard blocks a call when session spend + estimate > cap. **U-BUD-2** Cost computed from usage incl. cache tokens matches the hand calculation. **U-BUD-3** replay mode never instantiates a network client.
- **U-REH-3** Scenario runner drops schema-invalid scenarios and counts them; mismatches become `SCENARIO_UNHANDLED`.
- **U-REH-4** Applying a gap fix creates v{n+1} with `gap_fix` provenance and marks rehearsal stale.
- **U-REH-5** Gap cards come from templates for every GapCode in EN and Hinglish, filled with the policy's own item/area names; no Claude call.
- **U-DEMO-1** `export-demo` writes a schema-valid `DemoSession`; a scan finds no secret values (keys, tokens, mailbox password, owner token) and no customer PII.
- **U-GATE-1** Gate blocks with: unapproved rule; stale rehearsal; critical open; FAIL > 0. Passes only when all clear.
- **U-GATE-2** Approval of a low-confidence rule requires explicit per-rule action ("approve all high-confidence" skips it).
- **U-GATE-3** Deploy adapter refuses to pack if the gate fails on disk state (forged UI request → 409 `GATE_BLOCKED`).
- **I-DEP-1** Deploy with fake `gddy` (scripted JSON responses): full happy path in order; state file written per step.
- **I-DEP-2** Failure at "publish" → resume skips completed steps; no duplicate app created.
- **I-DEP-3** (live, T09/T13) real deploy: `/healthz` policyHash matches; HTTPS on domain; timings recorded.
- **I-DEP-4** (live) Public storefront: `curl -sf https://<domain>/` → 200, HTML contains the bakery name and ≥1 catalog item from the bundle; HTTP → HTTPS works; no "Not launched" banner.
- **I-DEP-5** (live) MCP: external `initialize` + `tools/list` returns 3 tools; `tools/call get_quote` with `requests/valid-basket.json` returns `outcome: QUOTED` and a token that verifies against `/.well-known/agentdoor.json` public key.
- **I-DEP-6** (live) Persistence: place a `[TEST]` order via MCP → visible on `/owner` → `gddy hosting app restart --variant PUBLISH` → still visible with same status → full redeploy → still visible → owner declines → `capacity_ledger` released.
- **I-DEP-7** (live) Redeploy: change one approved rule, re-run the gate, deploy again → `gddy hosting app list --app-type NODEJS` still shows exactly one app with the same id; URL unchanged; `/healthz` policyHash = new hash; ordering with a quote token issued before the redeploy → 410 `QUOTE_STALE_POLICY`.
- **I-DEP-8** (mocked) Deploy adapter refuses `app create` when `.agentdoor/deploy.json` exists or an app named `agentdoor-shop` is listed. `set-secrets.mjs`: spawned argv for every child process contains **no secret value** (assert on the fake gddy's recorded argv), the body file is mode 600 and deleted afterwards (also on error), PREVIEW and PUBLISH are separate calls with their own files, and values never appear in logs, `deploy.json`, the zip or error output.

### End-to-end, a11y, submission (T10–T13)
- **E2E-1** Launcher fixture mode: L1 → L4 (deploy step mocked) with the seeded transcript; door unlocks after fixes.
- **E2E-2** Shop human flow: menu → quote (rush) → order → status page shows waiting.
- **E2E-3** (manual, recorded) Claude.ai custom connector: list tools, quote, haggle refused, place order.
- **E2E-5** Public replay `/try`: intro (video iframe with title + text link) → describe → rules → rehearse → launch, all 200 without JS; persistent nav to Storefront and Launch report on every step; every content block carries exactly one of the badges RECORDED · Claude / LIVE · deterministic / RECORDED · deployment evidence (DOM assertion), and the LIVE blocks change when `AGENTDOOR_NOW` changes while RECORDED blocks don't; rehearsal counters computed live; no request to `api.anthropic.com` (Playwright route assertion); no DB writes (row counts unchanged); ribbon link to `/try` present on S1, S2, S5; missing session file → "Replay unavailable" page, not 500.
- **E2E-4** Owner: login → pending order visible → confirm → status page shows confirmed; logout.
- **A11Y-1** axe: L2, L3 zero serious/critical. **A11Y-2** axe: S1, S2, S5, S7, S8 zero serious/critical. **A11Y-3** keyboard-only S2 order completes (Playwright `keyboard` only); focus visible.
- **SUB-1** Live link loads over HTTPS on own domain; contact form message arrives in mailbox; mailbox received an external test email.
- **SUB-2** `git clone` of the public repo + README steps → `npm test` green (fresh-clone script).
- **I-TRY-1** (stretch) `/try/live` returns 404 unless `TRY_LIVE_ENABLED=1`; wrong access code → 401 with rate limit. **I-TRY-2** (stretch) 30 concurrent compile requests near the cap → total reserved never exceeds $5.00 (DB CHECK holds) and excess requests get "budget used up". **I-TRY-3** (stretch) live compile output never changes the shop's policy, orders or `/healthz` hash.
- **SUB-3** Repo secret scan clean (script + manual grep for domain mailbox password, keys).

## 3. Threat model and security controls

| # | Threat | Vector | Control | Test |
|---|---|---|---|---|
| SEC-1 | Price manipulation | Agent edits total in token | Ed25519 signature + engine recompute on order | U-SIG-2, I-API-6 |
| SEC-2 | Quote replay / double booking | Reuse token | `quote_redemptions` PK in txn | I-ORD-2 |
| SEC-3 | Owner dashboard takeover | Brute-force token | 256-bit token; 5/15 min rate limit; timing-safe compare; generic errors | SEC-3 manual + I-API-4 |
| SEC-4 | CSRF on owner actions | Cross-site form | SameSite=Strict + Origin check | Playwright cross-origin POST → 403 |
| SEC-5 | Stored XSS | `notes`, names in dashboard/report | Auto-escaping `html` tag; CSP without `unsafe-inline` scripts | Inject `<script>`/`<img onerror>` → rendered as text |
| SEC-6 | IDOR on orders | Guess order ids | Access token required; uniform 404 | I-API-3 |
| SEC-7 | DoS | Large bodies, floods | 16 KB limit, rate limits, O(lines) engine, ≤20 lines | I-API-2, I-API-4, I-MCP-3 |
| SEC-8 | Launch-gate bypass | Edit bundle policy; forged deploy | Boot guard + signed launch record; deploy re-checks gate | U-GATE-3, U-GATE-4 |
| SEC-9 | Prompt injection → code/policy change | Transcript or scenario text | No codegen; schema-only; owner approval; scenarios can't change policy | U-CMP-5, U-REH-3, P-ENG-2 |
| SEC-10 | Secret leakage | Repo, logs, UI | `.gitignore`, secret-scan script, redacted deploy logs, secrets only in hosting secrets | SUB-3, I-DEP-1 log assertion |
| SEC-11 | Capacity race | Concurrent orders | Conditional UPDATE in txn | C-CAP-1 |
| SEC-12 | Supply chain | Malicious/vulnerable deps | Pinned exact versions, lockfile, `npm audit --omit=dev` | T12 |
| SEC-13 | Email header injection / spam via contact | CRLF in fields, floods | Gateway authors the message; fixed recipient from env; honeypot; 5/min | I-MAIL-1 |
| SEC-14 | Launcher exposed on LAN | Binding 0.0.0.0 | Bind 127.0.0.1; Host header check | unit test on server config |
| SEC-15 | GoDaddy credential or secret leakage | Token in repo/zip/logs/argv; shop holding account creds | gddy creds stay in OS keychain; shop has no GoDaddy creds; shop secrets go only in the JSON request body (`updateSecrets` via `gddy api call --file`, mode-600 temp file deleted in `finally`); never argv; names-only logs; zip allow-list | I-DEP-8; `unzip -l out/shop.zip` allow-list check in pack test |
| SEC-17 | `/try` leaks secrets or becomes a free Claude proxy | Recorded session contains keys/PII; replay calls Claude | Export scan (U-DEMO-1); `/try` has no Claude client code path; rate limit 60/min | U-DEMO-1, E2E-5 |
| SEC-18 | Live `/try` drains credits | Abuse of optional live mode | Disabled by default; access code; atomic $5 reserve/settle; 3/code/hour; compile only | I-TRY-1..3 |
| SEC-19 | Private account/billing data in the public repo | Ledgers, account ids, spend data committed | `private/` is gitignored (ledgers, account facts); public docs keep only hackathon-level facts | SUB-3 + `git ls-files private` empty |
| SEC-16 | Unapproved GoDaddy spend | Agent runs purchase commands | Purchase commands forbidden in CLAUDE.md; deploy adapter has no purchase code paths; ledger approval rule | Code grep in T12: no `checkout complete`, `domain purchase`, `email create` in source |

Policy changes after approval: any edit creates a new version, resets that path's approval and rehearsal status (U-REH-4, U-GATE-1). A deployed shop keeps serving the old policy until the next gated deploy. Old quotes then fail with `QUOTE_STALE_POLICY` (U-SIG-3).

Multilingual compilation quality: measured by U-CMP-1..3 accuracy plus one `@live` run per language in T07 (≈$0.20 total), recorded as fixtures.

Deployment failure recovery: I-DEP-2 plus manual drill in T13 (kill the network mid-upload, rerun).

## 4. Execution policy

- `npm test` = unit + property + integration (requires docker MySQL; integration auto-skips with a loud warning if the DB is down. CI-like runs must have it).
- `npm run e2e` = Playwright against local shop + launcher in fixture mode.
- Each task's prompt lists its test IDs; the task is done only when those pass.
- Coverage target: core ≥ 90% lines (pure code; cheap to cover), shop ≥ 75%, launcher flows ≥ 70%. UI templates are excluded from coverage (E2E covers them).
