# 02 — Feasibility: Facts, Assumptions, Blockers, Spikes

Verified 2026-11-18 18:30 IST. **C** = confirmed from a primary source. **S** = secondary source only. **A** = assumption.

## 1. Hackathon facts

| Fact | Status | Source |
|---|---|---|
| Challenge: "agentic business solutions leveraging Claude and GoDaddy technologies to help entrepreneurs, creators, and small businesses go from idea to launch" | C | Kickoff deck p.6 (organizer email 13 Nov) |
| Mandatory: published app on GoDaddy, own domain + HTTPS, mailbox on domain receiving a test email, contact form delivering to it, no passwords in code/repo | C | Deck p.6, p.8, p.12 |
| Submit via HackerEarth: live link, GitHub repo, project brief | C | Deck p.6, p.11, p.12 |
| Submissions close 20 Nov 2026; **exact time "to be confirmed"** | C | Deck p.5; "2 days left" email 18 Nov 06:06 UTC |
| Rubric: Impact 35, Demo 35, Tech usage 15, Execution 15 | C | Deck p.10 |
| Top 10 announced 30 Nov; Pune finale 11 Dec | C | Deck p.5, p.11 |
| Node.js participants received **$40 GoDaddy credit** (domains, hosting, email) | C | Organizer email 18 Nov |
| Recommended purchases: Economy plan 1-month, Titan Pro Light 1-month: "should come to $0" | C (deck claim) | Deck p.7–9. The CLI catalog shows Titan Pro Light as **1-year only ($23.88)**, see §3.1 |
| Claude credits: $100; claim link open until **20 Nov 23:59 IST**; credits usable **90 days** after claim; new accounts wait 24 h | C | Deck p.4; Anthropic email 13 Nov |
| Office hours daily 16:00–17:00 IST until 20 Nov | C | Organizer emails |
| Video not listed as mandatory | C (absence) | Deck p.6, p.12. We still make one (demo = 35%) |

## 2. Claude platform facts

| Fact | Status | Source |
|---|---|---|
| Sonnet 5.5 `claude-sonnet-5-5`: $2 in / $10 out per MTok; cache read $0.10 | C | claude-api skill (cached 2026-11-03); deck p.2 |
| Opus 5.5 `claude-opus-5-5`: $4 / $20; cache read $0.20; effort default `medium`; thinking cannot be disabled | C | claude-api skill |
| Haiku 5.5 `claude-haiku-5-5`: $0.10 / $0.50 (≤100K-token prompts) | C | claude-api skill |
| Cache write 1.25× (5-min TTL) or 2× (1-h); min cacheable prefix 512 tokens on 5.5 models | C | claude-api skill, prompt-caching ref |
| Forced `tool_choice` any/tool → 400 on Sonnet/Opus 5.5. Use `output_config.format` or `auto` + `strict: true` | C | claude-api skill |
| `thinking: {type:"disabled"}` → 400 on Sonnet 5.5 / Opus 5.5 (use effort `low`, or Sonnet `between_tools`) | C | claude-api skill |
| `temperature`/`top_p` → 400 on API version `2026-10-21`. Do not send them | C | claude-api skill |
| Server-side fallback: beta `server-side-fallback-2026-07-01` + `fallbacks: "default"` on Sonnet 5.5 | C | claude-api skill |
| Console spend limits per workspace | **A** (Admin docs mention spend limits in early-access preview for Console orgs) | Verify in Console UI in T00 |

## 3. GoDaddy platform facts

| Fact | Status | Source |
|---|---|---|
| `gddy` v0.2.37 installed, prod OAuth with hosting/domain/dns/email scopes | C | Local `gddy --version`, earlier login output |
| Lifecycle: `hosting app create` (async op) → `source upload` (zip → PREVIEW) → `subscription attach` (first time) → `deployment publish` → `domain attach` | C | `gddy guide hosting-nodejs` |
| PREVIEW URL is private (owner login); public needs PUBLISH | C | Earlier verification (memory 17 Nov); deck p.7 |
| Economy plan = **1 publish slot**; redeploy to the same app | C | Memory 17 Nov (GoDaddy docs) |
| `package.json`: name, version, main (file exists), build, start; listen on `process.env.PORT`; runtime deps in `dependencies`; no `node_modules`/`.env` in zip; zip < 100 MB; `.npmrc` with public registry | C | contract.md C1–C14 (github.com/godaddy/nodejs-hosting-agent-skill) |
| **Egress: only HTTP 80, HTTPS 443, managed MySQL** | C | contract.md C11 |
| **No SMTP. Email via loopback gateway `http://127.0.0.1:2525/api/email/send` using vended `sendEmail()` helper; omit `from`; recipient from env (`CONTACT_FORM_RECIPIENT_EMAIL`)** | C | contract.md C13, email.md |
| Managed MySQL injected via `DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD`; use `mysql2` + parameterized queries | C | contract.md C12 |
| **PREVIEW and PUBLISH share one database**; startup schema steps must be idempotent and concurrency-safe; restores don't roll back schema | C | SKILL.md (MySQL section) |
| Secrets per variant via JSON Patch; values never returned; secret changes land on PREVIEW; publish promotes | C | Hosting concepts doc |
| Node 22 persistent process; WebSockets behave normally | S | GoDaddy launch post; webhosting.today |
| Filesystem persistence across deploys (only `/public/assets/` per one article) | S | webhosting.today. **We do not rely on disk**: MySQL for state |
| Request timeouts, SSE buffering through CDN | **A** unknown | T01 spike |
| Domain purchase: `gddy domain quote` → `purchase` (or godaddy.com with in-store credit) | C | `gddy tree`, deck p.8 |
| Mailbox: `gddy email check-eligibility` → `create` → poll `get` | C | `gddy guide email` |
| Deck SMTP tip (`smtpout.secureserver.net`) contradicts contract C11/C13 | C conflict | **Follow the contract** (gateway). The SMTP tip applies to VPS users |

### 3.1 GoDaddy account state and plan choice (verified 2026-11-18 18:55 IST, read-only)

| Fact | Status | Source |
|---|---|---|
| Organizer in-store credit **$40.00**, non-recurring, expires 23 Nov 2026 | C | Organizer email; account billing page |
| **No hosting subscription exists**; `totalAvailableSlots: 0`. The credit did not activate a plan, so **checkout is required** | C | `gddy hosting subscription list --hosting-product=WEB_HOSTING` |
| No apps, domains or mailboxes yet | C | `gddy hosting app list --app-type NODEJS`, `domain list`, `email list` |
| Node.js plans: Economy $4.99/mo (1 app), Deluxe $7.99 (10), Ultimate $12.99 (25); 1-month terms, auto-renew | C | `gddy shopping catalog search --category webHosting` |
| **Cheapest eligible plan for the full MVP = Economy 1-month ($4.99)**: one published app (we redeploy it), managed MySQL per published app, custom domain, HTTPS | C (plan) / S (MySQL per plan tier) | Catalog + GoDaddy launch post |
| `agentdoor.shop` available, $0.99 first year (renews $59.99) | C (non-definitive price) | `gddy domain available` |
| Titan Pro Light in CLI catalog is **yearly only**, $23.88; a free-trial mailbox may be offered after a domain exists | C / A | `catalog search --category email`; `gddy guide email` |
| Taxes at checkout | **A** unknown | Checkout preview (needs your approval: it sends buyer details) |
| Free PREVIEW works without a plan, owner-login only; at most 2 preview apps | C | `gddy guide hosting-nodejs`; deck p.7; memory (GoDaddy docs, 17 Nov) |
| PREVIEW and PUBLISH of one app **share one database** | C | GoDaddy skill SKILL.md (MySQL) |
| Whether managed MySQL is auto-provisioned (the GoDaddy skill calls it "optional"; `gddy` has no DB command, so it may need a dashboard toggle), its version and `max_connections` | **A** unknown | Spike T01 |
| `gddy hosting secret create/sync` take values as argv (not used). Official `PATCH /v1/hosting/apps/{appId}/secrets` (`updateSecrets`) takes an RFC 6902 JSON Patch **body**, `variant` as a query param (default PREVIEW), ≤50 ops, values ≤8 KB, never returned. `gddy api call -X PATCH updateSecrets --param appId=… --param variant=… --file body.json` sends it with keychain OAuth | C | `gddy hosting secret sync --help`; `gddy api operation get updateSecrets`; `gddy api call --help` |
| `gddy` credentials stored in OS keychain; config `~/Library/Application Support/gddy/config.toml` (outside repo) | C | `gddy config path`, `gddy guide auth` |

GoDaddy spending follows `private/GODADDY_LEDGER.md` (separate $40 cap). It is independent of the Claude budget.

### 3.2 Managed MySQL design consequences

- Durable orders, replay prevention (`quote_redemptions` PK) and atomic capacity (conditional `UPDATE`) all use the app's managed MySQL (`04` §6). No disk persistence assumed.
- **PREVIEW and PUBLISH share the DB.** So (a) migrations are additive only; (b) preview smoke tests are read-only plus quotes; they never place orders; (c) order-path acceptance on the live app uses orders with notes prefixed `[TEST]`, which are declined afterwards (capacity released, rows kept for audit).
- Local development and all automated tests use docker `mysql:8`, never the GoDaddy DB.

## 4. Dependency and license check

Exact versions are pinned at install time (`save-exact=true`). Pin what npm resolves; do not guess version numbers in docs.

| Package | Purpose | License | Why not stdlib |
|---|---|---|---|
| `express` | HTTP server (shop + launcher) | MIT | Boring, known to the agent; stdlib `http` costs more code |
| `zod` | Schemas and validation at every boundary | MIT | Security rule: schema validation at trust boundaries |
| `zod-to-json-schema` (only if Zod's native JSON Schema export is missing) | Structured-output schema for Claude | ISC | Prefer Zod's built-in `z.toJSONSchema` if the installed version has it |
| `mysql2` | Managed MySQL | MIT | Required by contract C12 |
| `@modelcontextprotocol/sdk` | MCP server (streamable HTTP, stateless) | MIT | Protocol correctness |
| `@anthropic-ai/sdk` | Claude calls (launcher only) | MIT | Required by skill rules |
| `express-rate-limit` | Per-IP limits | MIT | Small; single process, so in-memory is fine |
| `vitest`, `fast-check` (dev) | Unit + property tests | MIT | — |
| `esbuild` (dev) | Bundle shop + core into one `dist/index.js` for the zip | MIT | Avoids workspace resolution on the platform |
| `typescript`, `tsx` (dev) | Types; run launcher | Apache-2.0 / MIT | — |
| `@playwright/test` (dev) | E2E + axe a11y smoke | Apache-2.0 | — |
| `@axe-core/playwright` (dev) | A11y check | MPL-2.0 | Dev-only, not distributed. Acceptable; note in README |
| Node built-ins | `crypto` (Ed25519, SHA-256, randomUUID), `child_process.execFile` (gddy, zip), `fetch` | — | — |

No GPL/AGPL. Zip is made with the system `zip` binary through `execFile`, so no zip library is needed.

## 5. Blockers and cheapest resolving experiment

| # | Blocker | Severity | Cheapest experiment | Owner | Fallback if it fails |
|---|---|---|---|---|---|
| B1 | Exact submission time unknown | HIGH | Look at the HackerEarth challenge dashboard now; ask at office hours 19 Nov 16:00 | User | Assume 20 Nov 18:00 IST; feature freeze 20 Nov 10:00 |
| B2 | No hosting plan; credit expires 23 Nov | HIGH (blocks public URL) | **Buy Economy 1-month + domain tonight (T00, R0-3)** on godaddy.com with the in-store credit, after you approve the INR cart total. Waiting for a spike gains nothing because both are mandatory | User | — |
| B2b | Checkout tax pushes total over $40 | MED | Checkout preview shows the final total before `complete` | User | Drop Titan yearly and use the free trial, or a cheaper TLD |
| B2c | Mailbox option: free trial vs Titan $23.88 | MED | `gddy email check-eligibility` after the domain exists (read-only) | Agent | Titan Pro Light 1 yr (P3b) |
| B3 | MCP through GoDaddy CDN to Claude connector | HIGH | T01: 40-line Express + MCP stateless JSON app; `curl` initialize + tools/list; add as Claude.ai custom connector | Agent + user | Use REST `/api/quote` + `/api/orders` with an OpenAPI doc, plus a local MCP shim (`npx agentdoor-mcp --url`) for the demo. The concept survives |
| B4 | MySQL env injection + transactions on published app | HIGH | T01: `/spike/db` endpoint runs `SELECT 1` and one `FOR UPDATE` txn | Agent | External DB is impossible (egress). Use a single-process in-memory store plus a JSON snapshot written to `/public/assets/` (S). Document as a known limit |
| B5 | Mail gateway delivery to Titan mailbox | HIGH (mandatory R18) | T01: `/spike/mail` sends via `sendEmail()` to `CONTACT_FORM_RECIPIENT_EMAIL` | Agent + user checks inbox | Ask office hours; contact form still stores messages in DB; show mailbox test email separately |
| B6 | Secrets reach PUBLISH after publish | MED | T01: create secret on PREVIEW, publish, read `/spike/env` (prints secret names only, never values) | Agent | Re-publish; bake non-secret config into bundle |
| B7 | Domain attach + HTTPS time | MED | T01 attaches domain right after first publish; poll `verificationStatus` | Agent | Submit the platform PREFIX URL as a temporary live link; keep polling |
| B8 | Claude credits claimed and API key works | HIGH | T00: Console shows $100 balance; one 10-token call with Haiku | User | Email `hackathon+godaddy-...@anthropic.com` (they replied within 8 h before) |
| B9 | Real entrepreneur input | MED (impact 35%) | Message 1–2 home bakers (friends/family/Instagram), ask for 3 real order chats and their rules; get consent to quote | User | Label persona "illustrative, based on common home-bakery practices"; never claim a real user |
| B10 | Time: ~24 effective build hours remain | CRITICAL | Follow critical path in `00`; two parallel Claude Code lanes | User | Cut list in `07` §4 |

## 6. Spike T01 definition (≤90 min, ≤$5), split by purchase gate

One session after T00 purchases (merged, R0-3): create (or reuse) the **one** app `agentdoor-shop` → upload to PREVIEW → attach Economy → secrets on both variants → publish → public checks → domain attach → mail → restart + redeploy. The app id is reused for every later deployment.

Deploy `spike/` (throwaway, never merged into `apps/shop`):

```
GET  /healthz              -> {"ok":true}
POST /mcp                  -> MCP stateless, JSON responses, tool `ping` returns "pong"
GET  /spike/db             -> SELECT 1 + txn with SELECT ... FOR UPDATE on a temp table
POST /spike/mail           -> sendEmail({to: env.CONTACT_FORM_RECIPIENT_EMAIL, subject:"spike", text:"ok"})
GET  /spike/env            -> names of DB_* and custom secrets present (booleans only), MySQL version + max_connections
GET  /spike/ip             -> socket remoteAddress, X-Forwarded-For, X-Real-IP, Forwarded (to set trust proxy hops)
GET  /spike/sse            -> 5 events at 1 s intervals (observe CDN buffering)
```

Pass criteria, each recorded in `STATUS.md`:
1. External `curl` to `https://<publish-url>/mcp` initialize + `tools/list` + `tools/call ping` succeeds.
2. Claude.ai **custom connector** (Settings → Connectors → Add custom, no auth) lists `ping` and runs it. Also try Claude Code `claude mcp add --transport http`.
3. `/spike/db` returns ok; `/spike/mail` email arrives in Titan inbox within 2 min.
4. Full redeploy (upload → publish) wall time measured. Same app id, same URL, still one slot used.
5. `/spike/sse` behavior noted (buffered or streamed). The design uses JSON responses only, so this is informational.
6. **Proxy topology:** `/spike/ip` called from two different networks shows the proxy peer addresses, chain length and which header carries the real client IP, which determines the exact `trust proxy` value (never `true`).
7. **Persistence:** a row written via `/spike/db` survives `gddy hosting app restart --variant PUBLISH` and a full redeploy.

Spike kill-switch: if B3 fails twice, take the fallback immediately and do not debug the CDN.
