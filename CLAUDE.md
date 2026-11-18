# AgentDoor — Implementation Agent Instructions

AgentDoor turns a home baker's description (English/Hindi/Hinglish) into an owner-approved, rehearsed business policy, then deploys a storefront (human + MCP) to GoDaddy Node.js hosting. GoDaddy Inclusive Innovation Hackathon 2026. **Deadline 20 Nov 2026.**

## Start of every session
1. Read `STATUS.md` (current state, decisions, open issues) and your task card in `planning/07_IMPLEMENTATION_TASKS.md`.
2. Read **only** the `planning/` sections your prompt cites. Do not scan the whole repo.
3. Confirm your lane's directories (below) and stay inside them.

## Repository map
- `packages/core`: schemas (Zod), canonical hash, pure engine, probes/lint, Ed25519 tokens, order state machine. **No I/O, no clock reads.**
- `apps/shop`: deployed Express app: pages, REST, MCP (`/mcp`), owner dashboard, launch report, contact form, MySQL.
- `packages/ui`: shared HTML components (launcher + shop `/try`).
- `apps/launcher`: local-only (127.0.0.1:4321): Claude orchestration, rehearsal, gate, `gddy` deploy adapter, UI.
- `spike/`: T01 throwaway. `e2e/`: Playwright. `planning/`: frozen design docs.

Lanes: **A** = `packages/core`, `apps/shop`, `spike`, `e2e` · **B** = `apps/launcher`, `packages/ui` (separate git worktree). Lane B requests core changes via STATUS.

## Commands
- `npm ci` · `docker compose up -d mysql` · `npm test` (unit+property+integration, replay mode) · `npm run e2e`
- `npm run launcher` (fixture mode without key) · `npm run shop` (local, needs DB) · `npm run deploy` (gated)
- `scripts/check-secrets.sh` before every commit

## Non-negotiable rules
- Policy is declarative JSON validated by Zod. **Never generate or eval code from model output.**
- No model call anywhere in `apps/shop`. Prices/capacity/refusals are `packages/core` pure functions.
- Money = integer paise. Time = injected `nowMs`, IST (+05:30, no DST).
- Validate every external input with strict Zod schemas and size limits. Escape all HTML output.
- Order writes: one transaction for quote consumption + capacity reservation + order creation; lock order `quote_redemptions → capacity_ledger → orders → audit_events`; bounded retry ≤3 with explicit ROLLBACK.
- MySQL: parameterized queries only, via `apps/shop/src/db/`. Migrations additive (`CREATE TABLE IF NOT EXISTS`) under `GET_LOCK`. PREVIEW and PUBLISH **share one DB**.
- GoDaddy contract (C1–C14): listen on `process.env.PORT`; runtime deps in `dependencies`; egress only 80/443/MySQL; **email only via the vended `sendEmail()` helper to 127.0.0.1:2525**. No nodemailer, no SMTP. Recipient from `CONTACT_FORM_RECIPIENT_EMAIL`; `.npmrc` with public registry.
- Secrets only in env / GoDaddy hosting secrets. Never log, print, commit, or render them. `.agentdoor/`, `.env*`, `out/` are gitignored.
- Claude API (launcher): TypeScript SDK; `output_config.format` for structured output; **no temperature/top_p, no prefill, no forced tool_choice**; adaptive thinking (default) + explicit `effort`; Sonnet calls use `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`; check `stop_reason` before parsing; go through `ClaudeClient` (budget guard + record/replay).
- Tests never call Claude (`AGENTDOOR_LLM_MODE=replay`). Recording fixtures only in T07/T08.
- Never run purchase commands (`gddy domain purchase`, `shopping checkout complete`, `email create`, `payment-method add`). The human approves every GoDaddy purchase (`private/GODADDY_LEDGER.md`, cap $40).
- **One GoDaddy hosting app only** (`agentdoor-shop`, id in `.agentdoor/deploy.json`). Never `app create` a second app; redeploy = upload + publish to the same app. Dev checks on free PREVIEW; PREVIEW and PUBLISH share one DB, so preview checks never write orders.
- GoDaddy credentials stay in the OS keychain (gddy). The shop needs none; never copy them into the repo, zip, env or logs. Shop secrets reach GoDaddy **only in a JSON request body** via `scripts/set-secrets.mjs` (`updateSecrets` through `gddy api call --file`, mode-600 temp file, deleted after). **Never put a secret in CLI arguments.** PREVIEW and PUBLISH are configured separately.
- `private/` (ledgers, account facts) is gitignored. Never copy account ids, billing or spend details into public files.
- `/try` (public replay) must never call Claude or write to the DB.
- Error responses use the envelope `{data, error:{code,message}, meta:{requestId}}`; no stack traces to clients.

## Style
TypeScript strict, ESM, 2-space, Prettier defaults. kebab-case files (PascalCase not used: no React). Functions ≤ 40 lines where practical; no magic numbers (named constants); no dead code. Comments explain *why*. Prefer stdlib and existing helpers before adding a dependency; pin exact versions (`save-exact`).

## Definition of done (per task)
Task's test IDs (`planning/08`) pass · `npm test` green · secret scan clean · conventional commit `type(scope): subject` authored by the repo identity **shro-2002** · `STATUS.md` updated (≤10 lines: done / decisions / issues / next).

## When unsure
Contracts win: `planning/04`. Then `planning/03`. If the docs are silent, choose the simplest correct option and record it in STATUS → Decisions. Ask the human before anything irreversible or outward-facing (deploys to PUBLISH outside T09/T13, purchases, deleting data).
