# 03 — Architecture

Contracts (schemas, endpoints, tables) are in `04`. Agent/prompt design is in `05`. This file covers boundaries, flows and decisions.

## 1. System context

```
 Owner (home baker)                                           Customer (human)      Customer's AI agent (Claude)
        │ browser (localhost)                                       │ browser               │ MCP over HTTPS
        ▼                                                           ▼                        ▼
┌──────────────────────────── LAUNCHER (local, owner machine) ─┐   ┌──────── SHOP (GoDaddy Node.js hosting, PUBLISH) ────────┐
│ UI (server-rendered HTML + small JS)                         │   │ Storefront pages   /            /quote  /order/:id      │
│ Orchestrator ── Claude client (record/replay, budget guard)  │   │ MCP endpoint       /mcp  (stateless, JSON)              │
│   ├─ Compiler (Sonnet 5.5, structured output)                │   │ REST API           /api/*                               │
│   ├─ Clarifier (same call family)                            │   │ Owner dashboard    /owner  (session cookie)             │
│   └─ Scenario writer (Sonnet 5.5); gap text from templates   │   │ Launch report      /launch-report, /.well-known/agentdoor.json
│ Demo export ── session.json ──────────────(bundled)──────────┼──▶│ Public replay      /try  (recorded Claude output, live engine)
│ Rehearsal runner ── @agentdoor/core engine + probes          │   │ Contact form       /contact → mail gateway :2525       │
│ Launch gate ── signs launch record                           │   │ Core engine (same package, bundled)                     │
│ Deploy adapter ── gddy CLI (Hosting API) ─────────────HTTPS──┼──▶│ Boot guard: policy hash == launch record, else read-only│
│ State: .agentdoor/ (policy versions, usage.jsonl, deploy.json)│  │ MySQL (managed, DB_* env): orders, capacity, redemptions│
└──────────────────────────────────────────────────────────────┘   └─────────────────────────────────────────────────────────┘
        │ HTTPS 443                                                      ▲ DNS: own domain (GoDaddy) → app, HTTPS (CDN cert)
        ▼                                                                │ Mailbox hello@domain (Titan) ← gateway
   Anthropic API (launcher only)
```

**Key property:** no model runs in the shop. Prices, capacity, refusals and signatures are pure code, so there is nothing to jailbreak at transaction time and runtime Claude cost on the live site is zero.

## 2. Components and responsibilities

| Component | Owns | Must not |
|---|---|---|
| `packages/core` | Zod schemas, policy validation, canonical hash, deterministic engine, probe generator, gap linter, quote token sign/verify, launch-record sign/verify, order state machine | Do any I/O, read the clock (time is injected), or depend on Express/MySQL/Claude |
| `apps/launcher` | Owner UX, Claude orchestration, rehearsal runs, approval workflow, policy versions on disk, launch gate, deploy adapter, cost tracking | Run in production; expose itself beyond `127.0.0.1` |
| `apps/shop` | HTTP surfaces (pages, REST, MCP), owner auth, persistence, rate limiting, email gateway, boot guard | Call Claude; mutate policy at runtime; store secrets in DB |
| GoDaddy | Hosting (PREVIEW/PUBLISH), MySQL, secrets, domain + TLS, mailbox, mail gateway | — |

## 3. Repository layout (npm workspaces, TypeScript, Node 22)

```
/                         package.json (workspaces), tsconfig.base.json, .npmrc (save-exact=true), vitest.workspace.ts
  CLAUDE.md TASKS.md STATUS.md private/COST_LEDGER.md
  planning/               (this package)
  packages/core/src/
    schema/               policy.ts quote.ts order.ts launch.ts common.ts   (Zod; single source of types)
    hash.ts               canonicalJson(), policyHash()
    engine/               evaluate.ts (quote), dates.ts (IST calendar math), money.ts
    rehearsal/            probes.ts (deterministic), lint.ts (gap rules), classify.ts
    crypto/               keys.ts, quoteToken.ts, launchRecord.ts
    orders/               stateMachine.ts
    index.ts              re-exports only
  packages/core/test/     *.test.ts, *.prop.test.ts, fixtures/
  packages/ui/src/        (lane B, T10) pure functions → HTML strings: html`` escape tag, tokens.css, RuleCard, ReceiptSlip,
                          GapCard, DoorGate, StepTimeline, StatusChip. Used by launcher AND shop /try (no duplication)
  apps/launcher/src/
    server.ts             Express on 127.0.0.1:4321
    claude/               client.ts (SDK wrapper, record/replay by fixture id, budget), prompts/*.md, wire-schemas.ts
    flows/                compile.ts clarify.ts scenarios.ts gapText.ts (templates) rehearse.ts gate.ts exportDemo.ts
    deploy/               gddy.ts (execFile wrapper), pack.ts (zip builder), deploy.ts (linear, idempotent steps)
    store/                fsStore.ts (.agentdoor/ JSON files, atomic write via rename)
    views/                *.ts (html tagged templates)  public/ (app.css, app.js, fonts via Google Fonts link)
  apps/launcher/fixtures/ transcripts/{en,hi,hinglish,seeded-leaky}.txt, llm/*.json (recorded responses)
  apps/shop/src/
    server.ts             Express; mounts routes; boot guard
    config.ts             env parsing (Zod) — fails closed
    db/                   pool.ts migrate.ts repo.ts (all SQL here, parameterized)
    routes/               pages.ts api.ts mcp.ts owner.ts contact.ts health.ts
    security/             session.ts csrf.ts rateLimit.ts headers.ts escape.ts
    email.ts              GoDaddy vended sendEmail() helper, byte-for-byte (contract C13)
    views/                html templates   public/ app.css shop.js
  apps/shop/bundle/       policy.json + launch-record.json (written by deploy pack; gitignored except demo fixture)
  spike/                  T01 throwaway app
  e2e/                    Playwright specs
  docker-compose.yml      mysql:8 for local + integration tests
```

Deployable artifact: `deploy/pack.ts` runs esbuild on `apps/shop/src/server.ts` (core inlined, npm deps external) into `out/shop/dist/index.js`. It copies `public/` and `bundle/`, writes a generated `package.json` (`main: dist/index.js`, `build: "echo build"`, `start: "node dist/index.js"`, exact runtime deps, `engines.node: "22.x"`) and `.npmrc`, runs `npm install --package-lock-only`, then zips. It validates with GoDaddy's `validate-paas.mjs` when available.

## 4. Technology decisions

| Decision | Choice | Why | Simpler alternative | Why rejected |
|---|---|---|---|---|
| Language | TypeScript everywhere | One stack; Hosting is Node-only; shared types across launcher/shop | Plain JS | Loses schema-to-type guarantees the agent relies on |
| Shop web framework | Express + server-rendered HTML (tagged templates with auto-escape) | No build step on platform; fast to render; small attack surface | Next.js | Real build on platform, larger bundle, SSR quirks; zero demo benefit |
| Launcher UI | Same: server-rendered + ~200 lines vanilla JS (fetch + progress polling) | One pattern for the agent to learn; no SPA state bugs | React SPA | More code and build tooling; the polish comes from CSS, not React |
| Policy representation | Declarative JSON validated by Zod; fixed interpreter | Requirement R3; makes the rehearsal meaningful; no injection-to-code path | Claude-generated JS rules | Unreviewable, unsafe, can't be hashed meaningfully |
| Money | Integer paise | No float errors; deterministic hash | Decimal library | Unneeded; integers suffice |
| Time | All engine time injected; IST (`Asia/Kolkata`, no DST) via fixed +05:30 offset arithmetic | Determinism, testability; IST has no DST | `Intl`/tz library everywhere | Non-determinism in tests; extra dep |
| Hash | SHA-256 over canonical JSON (sorted keys, no floats allowed by schema) | Stable, explainable on report | Hash of `JSON.stringify` | Key-order instability |
| Quote signature | Ed25519 (`node:crypto`), compact token `b64url(payload).b64url(sig)` | Public verifiability (key on report); no dependency | HMAC | Not publicly verifiable; JWT lib adds dependency and alg-confusion risk |
| Persistence | GoDaddy managed MySQL | Free with the app; transactions; durable; egress allows only it | SQLite file | Disk persistence across deploys unverified; locking under concurrency |
| Capacity atomicity | Conditional `UPDATE ... WHERE reserved + ? <= cap` inside the order transaction | Single statement is atomic in InnoDB; no app-level locks | `SELECT ... FOR UPDATE` then update | Works too but more code; conditional update is the smallest correct thing |
| Replay prevention | `quote_redemptions(quote_id PRIMARY KEY)` inserted in the same txn | DB constraint is the source of truth | In-memory set | Lost on restart; races |
| Idempotency | `orders.idempotency_key UNIQUE` + `request_hash`; same key+hash → original; same key, different hash → 409 | Standard pattern | Idempotency table | Extra table for no gain |
| Owner auth | Owner token (shown once by launcher) → login → HMAC-signed HttpOnly Secure SameSite=Strict cookie, 8 h | No user DB, no OAuth; strong enough for one owner | Basic auth | No logout, credentials on every request, poor UX |
| CSRF | SameSite=Strict + Origin check on all owner POSTs | Two independent layers, no token plumbing | Synchronizer tokens | More template plumbing |
| MCP transport | `@modelcontextprotocol/sdk` Streamable HTTP, **stateless** (`sessionIdGenerator: undefined`), `enableJsonResponse: true` | Works behind CDNs/proxies; no sticky sessions; Claude connector compatible | SSE transport | Deprecated; buffering risk |
| Deployment | `gddy` CLI (GoDaddy's official Hosting API client) driven by `execFile` (no shell); a linear script whose steps each check remote state first (idempotent), so a rerun after a failure continues; only `appId` is persisted in `.agentdoor/deploy.json` | Official Hosting API client; OAuth in keychain; polls built-in; every call maps 1:1 to a Hosting API operation (logged for judges) | Raw REST with PAT | Re-implements auth + async polling; a PAT is one more credential to protect |
| Hosting plan | **Economy 1-month ($4.99)**, one app, redeployed | Cheapest plan with a publish slot + managed MySQL; term covers finale (11 Dec) | Deluxe ($7.99, 10 apps) | Extra slots are useless when we redeploy one app |
| Email | GoDaddy vended `sendEmail()` → gateway | Contract C13 makes it the only way | Nodemailer/SMTP | Blocked by egress (C11) |
| Claude in launcher only | Launcher calls Claude; shop never does | Keys stay local; zero runtime spend; no jailbreak surface | Hosted launcher | Exposes key/credits to public; one publish slot |
| Judge access to the launcher | Public read-only replay `/try` on the shop: recorded real Claude outputs + live engine/rehearsal (`04` §9) | Judges experience the Claude-powered core from the submitted URL; no key or credits exposed | Hosted live launcher | Exposes Claude key and credits to the public; one slot |
| LLM testability | `ClaudeClient` with modes `live | record | replay` (fixtures keyed by explicit fixture id; prompt hash stored only to warn on drift; clock injected) | Routine tests cost $0; deterministic CI | Mocking SDK per test | Brittle; drifts from real outputs |
| Rate limiting | `express-rate-limit` in-memory | Persistent single process | Redis | No egress, no need |
| Logs | JSON lines to stdout (`log(level, event, fields)` helper) + `requestId` | Visible in `gddy hosting log list`; no dep | pino | Unneeded dep |

## 5. Core flows

### 5.1 Launch flow (launcher)

```
describe ─▶ compile(v1) ─▶ clarify? (1 round) ─▶ review & approve rules ─▶ rehearse
   ▲                                                    │                       │
   └─────────── owner edits / answers ◀─────────────────┘◀── gaps: fix → new version ┘
rehearse clean + all approved ─▶ gate: sign launch record(policyHash, rehearsalHash) ─▶ deploy ─▶ smoke ─▶ live
```

Policy versions are immutable files `.agentdoor/policies/v{n}.json`. Any edit (owner edit, gap fix, clarification) creates v{n+1}, resets rehearsal status to `stale`, and resets approval on the changed paths only.

### 5.2 Quote → order (shop; identical for human form and MCP)

```
get_quote(request) ─▶ zod parse ─▶ engine.evaluate(policy, request, now)
   QUOTED  ─▶ sign token {qid, policyHash, request, lines, total, units, fulfilmentDate, exp} ─▶ return
   REFUSED / NEEDS_OWNER ─▶ return reasons (codes + human text in EN/HI). No token
place_order(token, contact, idempotencyKey)
   ─▶ verify sig, exp, policyHash == boot policyHash
   ─▶ re-evaluate engine on token.request at token.iat (defense in depth: total must match)
   ─▶ (autocommit, outside txn) INSERT IGNORE capacity_ledger(fulfil_date, 0, 0)      -- row exists before any locking txn
   ─▶ (autocommit) SELECT by idempotency_key → exists: same request_hash ⇒ return original order (200); different ⇒ 409
   ─▶ TX BEGIN
        INSERT quote_redemptions(qid, order_id)              -- duplicate key ⇒ ROLLBACK → go to DUPLICATE
        UPDATE capacity_ledger
           SET reserved_units = reserved_units + u, rush_units = rush_units + r     -- r = u if rush else 0
         WHERE fulfil_date = ? AND reserved_units + u <= cap AND rush_units + r <= rushCap   -- ONE statement, one row lock
                                                             -- 0 rows ⇒ ROLLBACK, CAPACITY_FULL / RUSH_CAP_REACHED (re-read row to tell which)
        INSERT orders(... status='PENDING_OWNER', idempotency_key, request_hash, access_token_hash)  -- dup idem key ⇒ ROLLBACK → DUPLICATE
        INSERT audit_events
      COMMIT
   ─▶ return {orderId, status, accessToken (once)}
   DUPLICATE: re-read orders by idempotency_key; same request_hash ⇒ return that order (200, concurrent retry succeeded);
              otherwise ⇒ QUOTE_ALREADY_USED (409)
```

**Global lock order (every write transaction): `quote_redemptions` → `capacity_ledger` → `orders` → `audit_events`.** `placeOrder` follows it as above. `transitionOrder` reads the order's date without locking, then `BEGIN` → `SELECT … FROM capacity_ledger WHERE fulfil_date=? FOR UPDATE` → `UPDATE orders SET status=? WHERE id=? AND status=?` (0 rows → ROLLBACK, 409) → release units on the ledger → audit → `COMMIT`. Isolation: InnoDB REPEATABLE READ. The ledger row exists before any txn, so no shared-lock upgrades happen. **Bounded retry:** on `ER_LOCK_DEADLOCK` or `ER_LOCK_WAIT_TIMEOUT`, explicitly `ROLLBACK`, wait 20–80 ms jitter, retry; at most 3 attempts, then `RETRY_LATER` (503). Every exit path (error, refusal, duplicate) rolls back in `finally` before releasing the connection. Pool `connectionLimit: 5` (managed MySQL limit recorded by T01). Quote consumption, capacity reservation and order creation commit or roll back together.

### 5.3 Order lifecycle

```
PENDING_OWNER ──owner confirm──▶ CONFIRMED ──owner cancel──▶ CANCELLED (release capacity)
      └────────owner decline───▶ DECLINED (release capacity)
```

Transitions live in `core/orders/stateMachine.ts`. The DB update is `UPDATE orders SET status=? WHERE id=? AND status=?` (optimistic). Capacity release happens in the same txn. Terminal states are immutable.

### 5.4 Boot guard (shop)

On start: parse env (Zod) → load `bundle/policy.json` + `bundle/launch-record.json` → recompute `policyHash` → verify launch-record signature with `QUOTE_SIGNING_PUBLIC_KEY` → check `record.gate.criticalGaps === 0` and `record.policyHash === computed`. If any check fails, the shop serves pages and the report with a "Not launched" banner, and `get_quote`/`place_order` return `SHOP_NOT_LAUNCHED`. This is fail-closed: a hand-edited policy cannot take orders.

Migrations run at boot under `GET_LOCK('agentdoor_migrate', 10)`, `CREATE TABLE IF NOT EXISTS` only (additive; PREVIEW and PUBLISH share the DB). On failure: log and `process.exit(1)`.

### 5.5 Environments and deployment pipeline (GoDaddy)

| Env | Where | DB | Cost | Used for |
|---|---|---|---|---|
| `local` | laptop, `npm run shop` | docker `mysql:8` | $0 | all development and automated tests |
| `preview` | GoDaddy PREVIEW variant of the **single** app `agentdoor-shop` (owner-login only) | the app's managed MySQL (**shared with publish**) | $0, no plan needed | build/start verification, read-only smoke, visual check |
| `publish` | PUBLISH variant of the same app on the Economy slot, own domain + HTTPS | same managed MySQL | Economy $4.99/mo (from credit) | judges, MCP connector, demo, `[TEST]` order acceptance |

Rules:
1. **Exactly one hosting app for the whole hackathon.** Its id is stored in `.agentdoor/deploy.json` after T01. The deploy adapter refuses to `app create` when a state file or an existing app named `agentdoor-shop` exists. Every deployment reuses that app and its Economy slot.
2. Pipeline: `pack` → `source upload` (PREVIEW) → poll import → `secret sync` (PREVIEW) → preview smoke (owner session via `gddy`; read-only checks reachable through `gddy hosting log list` + `app status` when the private URL can't be curled) → `deployment publish` → poll → public smoke (`/healthz` hash, `/api/business`, `POST /api/quotes`, MCP `tools/list`) → record.
3. `subscription attach` runs once, on the first publish (T01). `domain attach` runs once, after the domain exists.
4. Redeploy = upload + publish only. Same app id, same URL, same DB (data survives).
5. The `--publish` step requires the launch gate (`05` §6) for shop deploys. The spike is exempt (it's not the shop).

### 5.6 Credential boundary

| Credential | Lives in | Never in |
|---|---|---|
| GoDaddy OAuth (`gddy`) | macOS keychain + `~/Library/Application Support/gddy/` | repo, `.agentdoor/`, zip, shop env, logs |
| GoDaddy PAT | not used (OAuth suffices); if ever needed: `gddy pat add` from stdin | same |
| Claude dev key | macOS keychain, read by Claude Code `apiKeyHelper` | shell env, history, repo, shop, zip, logs |
| Claude runtime key (launcher) | repo `.env.local` (gitignored) | shop, zip, logs (except `TRY_ANTHROPIC_API_KEY` hosting secret if optional T14 is enabled) |
| Shop secrets (signing key, session secret, owner token hash, recipient) | `.agentdoor/secrets/` (chmod 600) → `gddy hosting secret sync` | repo, zip, DB, logs |

The deployed shop needs **no GoDaddy credentials at all**: it only talks to its own MySQL and the loopback mail gateway.

**Secrets to GoDaddy (never in CLI arguments).** GoDaddy's official `PATCH /v1/hosting/apps/{appId}/secrets` (operation `updateSecrets`) takes an RFC 6902 JSON Patch array **in the request body**, with `variant` as a query parameter. `scripts/set-secrets.mjs` (local Node helper) reads values from `.agentdoor/secrets/preview.json` or `publish.json` (mode 600, gitignored), writes the JSON Patch body to a mode-600 temp file in `.agentdoor/tmp/`, and runs `execFile('gddy', ['api','call','-X','PATCH','updateSecrets','--param',`appId=${id}`,'--param',`variant=${v}`,'--file',tmp])`. Authentication is gddy's keychain OAuth (no PAT). The temp file is deleted in `finally`, and only secret **names** are logged. **PREVIEW and PUBLISH are configured separately** (two files, two calls; PREVIEW gets its own `SESSION_SECRET` and `OWNER_TOKEN_HASH`). Fallback: enter values in the GoDaddy hosting dashboard. `gddy hosting secret create/sync` are not used because they take values as argv.

## 6. Error handling and recovery

| Layer | Rule |
|---|---|
| Domain errors | Typed codes (`04` §6), never raw strings. Engine returns results, never throws, for business outcomes |
| HTTP | Envelope `{data, error, meta:{requestId}}`; 400 validation, 401/403 auth, 404, 409 conflict/idempotency, 410 quote expired, 422 business refusal, 429, 503 not launched; no stack traces |
| MCP | Tool errors returned as `isError: true` with code + message; never throw protocol errors for business outcomes |
| Claude calls | SDK `maxRetries: 2`; per-call timeout 90 s; budget guard aborts before a call if session spend + estimated max cost > cap; invalid structured output gets one repair attempt (same call with validation errors appended), then fails visibly to the owner |
| Deploy | Every step checks remote state first, so rerunning the script continues safely; polls with backoff 2→15 s, max 5 min per async op; on failure show the step and the last `gddy` error line, then "Run again". Parse **stdout only** as JSON (gddy prints update notices on stderr) |
| Email | Contact message is stored in DB first, then emailed; on gateway failure the user sees a generic message, the full error is logged, and the message stays in the dashboard |
| DB | Deadlock: retry once. Pool exhausted or DB down: 503 `RETRY_LATER` |

## 7. Security model

Threat model, tests and controls are in `08` §3. Architecture-level invariants:

1. Price path contains no model and no owner-free text interpretation; `notes` is stored and displayed (escaped), never interpreted.
2. Secrets exist only in the launcher's local env and GoDaddy hosting secrets: `QUOTE_SIGNING_PRIVATE_KEY`, `SESSION_SECRET`, `OWNER_TOKEN_HASH`, `CONTACT_FORM_RECIPIENT_EMAIL`. No secret in repo, bundle, DB or logs. A pre-commit/CI grep for key patterns plus `.gitignore` for `.agentdoor/` and `.env*`.
3. Launcher binds `127.0.0.1` only.
4. All inputs are Zod-parsed with size limits (body 16 KB, notes 500 chars, ≤20 line items).
5. Three independent launch-gate checks: launcher UI, deploy adapter, shop boot.

## 8. Observability and cost tracking

- Shop: JSON log line per request (`requestId, route, status, ms`), per order event, per refusal code. `GET /healthz` gives `{ok, launched, policyHash, version}`.
- Launcher: `.agentdoor/usage.jsonl` per Claude call: `{ts, flow, model, input, output, cache_read, cache_write, usd}`. A header widget shows session spend; `npm run cost` totals it. These numbers go into `private/COST_LEDGER.md` runtime rows.
- Deploy: `.agentdoor/deploy-log.jsonl` with each `gddy` call, duration and result. The deploy progress screen reads it.
