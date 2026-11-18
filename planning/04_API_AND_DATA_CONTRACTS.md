# 04 — API and Data Contracts

These are binding for implementation. Types are written as TypeScript and implemented as Zod schemas in `packages/core/src/schema/`. Every object schema is `.strict()`, every string has `.max()`, and every number is `.int()` unless stated otherwise.

## 1. Business policy (schemaVersion 1)

```ts
type Lang = 'en' | 'hi' | 'hinglish';
type Paise = number;            // int >= 0
type LocalDate = string;        // 'YYYY-MM-DD' (IST)
type HHMM = string;             // '18:00'

interface BusinessPolicy {
  schemaVersion: 1;
  business: { name: string; slug: string /* ^[a-z0-9-]{3,40}$ */; ownerFirstName: string;
              city: string; languages: Lang[]; timezone: 'Asia/Kolkata'; currency: 'INR' };
  catalog: CatalogItem[];                   // 1..30
  capacity: { unitsPerDay: number /* 1..500 */; overrides: { date: LocalDate; units: number }[] };
  schedule: { closedWeekdays: number[] /* 0=Sun..6 */; closedDates: LocalDate[];
              minLeadHours: number /* 0..336 */; dailyCutoff: HHMM | null; maxAdvanceDays: number /* 1..90 */ };
  rush: null | { withinHours: number; surcharge: { kind: 'flat'; paise: Paise } | { kind: 'percent'; bp: number /* basis points */ };
                 maxRushUnitsPerDay: number };
  fulfilment: {
    pickup: { enabled: boolean; areaLabel: string | null };
    delivery: { enabled: boolean; areas: DeliveryArea[]; unlistedArea: 'REFUSE' | 'ASK_OWNER' };
  };
  orderRules: { minOrderPaise: Paise; maxLinesPerOrder: number /* 1..20 */; customRequests: 'REFUSE' | 'ASK_OWNER';
                quoteValidityMinutes: number /* 5..1440 */; negotiation: 'NEVER' /* literal: discounts are not a policy option */ };
  cancellation: { freeCancelHours: number; note: Localized };
  provenance: Record<PolicyPath, RuleProvenance>;
}

interface CatalogItem { id: string /* ^[a-z0-9-]+$ */; name: Localized; unit: 'piece' | 'kg' | 'box' | 'dozen';
  unitPricePaise: Paise /* >0 */; minQty: number; maxQtyPerOrder: number; prepHours: number;
  capacityUnitsPerQty: number /* >=1 */; options: { id: string; label: Localized; surchargePaise: Paise }[];
  dietary: ('eggless' | 'vegan' | 'contains_nuts' | 'gluten_free')[] }
interface DeliveryArea { id: string; name: string; aliases: string[] /* lowercase, for exact match only */; feePaise: Paise }
interface Localized { en: string; hi?: string }

type PolicyPath = string;   // dotted path into policy, e.g. 'rush.withinHours', 'catalog[choco-cake].unitPricePaise'
interface RuleProvenance {
  source: { kind: 'transcript'; quote: string /* verbatim substring of transcript */; turn: number }
        | { kind: 'owner_edit'; note: string } | { kind: 'gap_fix'; gapId: string; note: string };
  readback: { lang: Lang; text: string };       // one sentence, owner's language
  confidence: 'high' | 'medium' | 'low';        // from compiler
  status: 'proposed' | 'approved';
  approvedAt: string | null;                    // ISO 8601
}
```

**Required paths** (each needs provenance with `status: 'approved'` before launch): every `catalog[*].unitPricePaise`, `catalog[*].maxQtyPerOrder`, `catalog[*].prepHours`, `capacity.unitsPerDay`, `schedule.minLeadHours`, `schedule.closedWeekdays`, `rush` (a null value also needs provenance: "no rush orders"), `fulfilment.delivery.enabled`, every `fulfilment.delivery.areas[*].feePaise`, `fulfilment.delivery.unlistedArea`, `orderRules.minOrderPaise`, `orderRules.customRequests`, `orderRules.quoteValidityMinutes`. Defaults filled by AgentDoor (not stated by owner) get `source.kind='owner_edit'` with note "AgentDoor default — confirm", status `proposed`.

**Compiler draft wrapper** (Claude structured output; not stored as policy until validated).

**Wire-schema rules (R0-4).** Structured outputs accept only objects with `additionalProperties: false` and fixed keys. They reject dynamic-key maps, `minimum`/`maximum`, `minLength`/`maxLength`, recursion and complex array constraints. So:
- Claude returns `policyDraft` = `BusinessPolicy` **without** `provenance`, plus an `evidence[]` array. Code builds the `provenance` map from `evidence`.
- The JSON Schema sent to Claude is generated from a separate `wire` Zod schema with no numeric/length bounds. Bounds live only in the domain Zod schemas, applied **after** parsing (failures go to the one repair attempt).
- `catalog`, `areas`, `overrides` are arrays (no keyed maps). Nullable fields use `anyOf [T, null]`.

```ts
interface CompileResult {                       // wire shape
  detectedLanguage: Lang;
  policyDraft: Omit<BusinessPolicy, 'provenance'> | null;   // null only if the transcript has no business at all
  evidence: { path: PolicyPath; quote: string | null /* verbatim, null if inferred */; turn: number;
              readback: string /* owner's language */; confidence: 'high' | 'medium' | 'low' }[];
  missing: { path: PolicyPath; why: string }[];
  questions: { id: string; path: PolicyPath; text: string; choices: string[] }[];   // code truncates to 5 questions, 4 choices
  assumptions: { path: PolicyPath; value: string; why: string }[];
}
```

Code maps each `evidence` item to `provenance[path] = { source: quote ? {kind:'transcript', quote, turn} : {kind:'owner_edit', note:'AgentDoor default — confirm'}, readback:{lang: detectedLanguage, text: readback}, confidence, status:'proposed', approvedAt:null }`, then runs the verbatim check (`05` §4).

## 2. Engine I/O

```ts
interface QuoteRequest {
  lines: { itemId: string; qty: number; optionIds: string[] }[];   // 1..20
  fulfilment: { kind: 'pickup' } | { kind: 'delivery'; area: string /* free text, max 80; matched exact/alias, case-insensitive, trimmed */ };
  date: LocalDate;
  notes?: string;                    // max 500; NEVER interpreted
}
type EngineResult =
  | { outcome: 'QUOTED'; lines: PricedLine[]; deliveryFeePaise: Paise; rushSurchargePaise: Paise; totalPaise: Paise;
      capacityUnits: number; isRush: boolean; reasons: Reason[] /* informational, e.g. RUSH_APPLIED */ }
  | { outcome: 'REFUSED'; reasons: Reason[] }
  | { outcome: 'NEEDS_OWNER'; reasons: Reason[] };
interface PricedLine { itemId: string; qty: number; unitPricePaise: Paise; optionsPaise: Paise; lineTotalPaise: Paise }
interface Reason { code: ReasonCode; params: Record<string, string | number>; ruleRef: PolicyPath }
```

`evaluate(policy, request, nowMs)` is pure. Order of checks (first refusal wins, all applicable reasons collected for NEEDS_OWNER): schema → unknown item → qty bounds → line count → closed date/weekday → beyond maxAdvanceDays → lead time (`fulfil at 10:00 IST on date`, minus `max(minLeadHours, max line prepHours)`) → rush window → rush units cap → delivery area → min order → capacity hint (engine reports units; the DB enforces). Capacity and rush units use the day's existing reservations only in the DB transaction. The engine is stateless.

### Reason codes (stable; UI text keyed by code in EN + HI)

`UNKNOWN_ITEM, QTY_BELOW_MIN, QTY_ABOVE_MAX, TOO_MANY_LINES, CLOSED_DAY, TOO_FAR_AHEAD, LEAD_TIME_NOT_MET, RUSH_APPLIED, RUSH_NOT_OFFERED, RUSH_CAP_REACHED, AREA_NOT_SERVED, AREA_NEEDS_OWNER, DELIVERY_NOT_OFFERED, BELOW_MIN_ORDER, CUSTOM_REQUEST_NEEDS_OWNER, CAPACITY_FULL, QUOTE_EXPIRED, QUOTE_INVALID, QUOTE_STALE_POLICY, QUOTE_ALREADY_USED, IDEMPOTENCY_CONFLICT, SHOP_NOT_LAUNCHED, RATE_LIMITED, VALIDATION_FAILED, RETRY_LATER`

## 3. Signed artifacts

```ts
interface QuoteTokenPayload { v: 1; qid: string /* uuid v4 */; shop: string /* slug */; policyHash: string /* hex64 */;
  request: QuoteRequest /* notes excluded */; totalPaise: Paise; capacityUnits: number; isRush: boolean;
  iat: number; exp: number /* unix s */ }
// token = base64url(canonicalJson(payload)) + '.' + base64url(ed25519Sign(privKey, utf8(firstPart)))

interface LaunchRecord { v: 1; shop: string; policyVersion: number; policyHash: string;
  rehearsal: { runId: string; ranAt: string; probes: number; scenarios: number; passed: number;
               gapsFound: { id: string; severity: 'critical' | 'warning'; code: GapCode; fixedInVersion: number | null }[];
               criticalOpen: number /* must be 0 */; resultsHash: string /* sha256 of canonical results */ };
  approvals: { required: number; approved: number };
  publicKey: string /* base64 raw ed25519 */; signedAt: string }
// launch-record.json = { record: LaunchRecord, signature: base64url(ed25519Sign(canonicalJson(record))) }
```

`policyHash = sha256hex(canonicalJson(policy))`. This includes `provenance`, because approvals are part of what was launched. `canonicalJson` means: object keys sorted by UTF-16 code unit, no whitespace, arrays in order, only string/int/bool/null allowed (the schema forbids floats).

## 4. Shop HTTP API (envelope `{ data, error, meta: { requestId } }`)

| Method + path | Auth | Body / query | 2xx | Errors |
|---|---|---|---|---|
| `GET /healthz` | none | — | `{ok, launched, policyHash, version}` | — |
| `GET /api/business` | none | — | public policy view: name, catalog, areas, schedule, rush, rules summary (localized) | — |
| `POST /api/quotes` | none, `quote-rest` | `QuoteRequest` | 201 `{quote: {token, totalPaise, lines, expiresAt, isRush}, reasons}` | 422 `{reasons}` REFUSED/NEEDS_OWNER; 400; 429; 503 |
| `POST /api/orders` | none, `order-create` | `{quoteToken, customer:{name≤60, phone (E.164 or 10-digit IN), address?≤200}, notes?≤500, idempotencyKey (uuid)}` | 201 `{orderId, status, accessToken}` (200 on idempotent replay) | 409 used/conflict, 410 expired/stale, 422 capacity, 400, 429, 503 |
| `GET /api/orders/:id?t=<accessToken>` | access token | — | `{orderId, status, summary}` | 404 (same response for wrong token: no existence oracle) |
| `POST /contact` | none, `contact`, honeypot field | form: name, email, message≤2000 | 303 → `/contact?sent=1` | 400; generic failure text |
| `POST /owner/login` | none, `owner-auth` | `token` | 303 + cookie | 401 generic |
| `POST /owner/logout` | session | — | 303 | — |
| `GET /owner` | session | — | dashboard HTML | 303 → login |
| `POST /owner/orders/:id/transition` | session + Origin check | `{to: 'CONFIRMED'|'DECLINED'|'CANCELLED'}` | 303 | 409 invalid transition |
| `GET /launch-report` | none | — | HTML | — |
| `GET /.well-known/agentdoor.json` | none | — | `{shop, policyHash, publicKey, mcp: '/mcp', launchRecord}` | — |
| `POST /mcp` | none, per tool: `mcp-read` / `order-create` | MCP JSON-RPC | MCP | — |
| `GET /.well-known/oauth-*`, `/.well-known/openid-configuration` | none | — | — | JSON 404 `{error:{code:'NOT_FOUND'}}` (never HTML), so MCP clients don't misread auth discovery |
| `GET /try`, `/try/:step` | none, `try` | — | public replay launcher (§9) | — |

**Rate-limit buckets (separate by risk).**

| Bucket | Applies to | Limit |
|---|---|---|
| `mcp-read` | MCP `initialize`, `tools/list`, `get_business_info`, `get_quote`; REST `GET /api/business` | 120/min/IP |
| `quote-rest` | REST `POST /api/quotes` | 60/min/IP |
| `order-create` | MCP `place_order` **and** REST `POST /api/orders` (one shared bucket) | 20/min/IP |
| `contact` | `POST /contact` (+ honeypot) | 5/min/IP |
| `owner-auth` | `POST /owner/login` | 5/15min/IP **and** 30/15min global |
| `try` | `/try/*` pages | 60/min/IP |

The MCP route parses the JSON-RPC body (method and tool name) **before** dispatch and charges the matching bucket, so `place_order` can't ride on the read budget.

**Trusted proxy topology (determined in T01, never assumed).** Forwarded headers are ignored unless the immediate peer is a verified proxy. T01 records the socket peer address(es) and header chain seen from two client networks. Express then gets `app.set('trust proxy', <exact list of observed proxy addresses/CIDRs>)`, or the exact hop count if the peers vary but the chain length is fixed and verified. Never `true`. If no trustworthy client IP can be derived, every per-IP bucket falls back to a global per-route bucket (limits ×10) and `owner-auth` keeps its global cap. Owner tokens are 256-bit, so brute force is infeasible either way.

Security headers on every response: CSP `default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`; on `/try` only, add `frame-src https://www.youtube-nocookie.com` for the embedded demo video, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`. Set HSTS only once the custom domain serves HTTPS.

## 5. MCP tools (server name `agentdoor-<slug>`, stateless, JSON responses)

Tool descriptions are written **for the customer's agent** and state the binding rules: prices are fixed, negotiation is impossible, and every quote expires.

| Tool | Input (zod, strict) | Output (`structuredContent` + text summary) |
|---|---|---|
| `get_business_info` | `{}` | name, catalog (ids, names, prices in ₹, units, dietary), delivery areas + fees, lead time, rush rule, closed days, quote validity, policyHash |
| `get_quote` | `QuoteRequest` | QUOTED: `{token, totalRupees, lines, expiresAt, isRush, reasons}`; else `{outcome, reasons[{code, message}]}` |
| `place_order` | `{quoteToken, customerName, customerPhone, deliveryAddress?, notes?, idempotencyKey}` | `{orderId, status:'PENDING_OWNER', statusUrl (includes access token), message:"The owner will confirm"}`; errors as `isError` + code |

Three tools only (R0-2 cut: `get_order_status` dropped; the `statusUrl` covers it).

Annotations: `get_*` `readOnlyHint: true`; `place_order` `destructiveHint: false, idempotentHint: true` (with the same key).

## 6. Database (MySQL 8, InnoDB, utf8mb4). Migrations are additive and run at boot under `GET_LOCK`.

```sql
CREATE TABLE IF NOT EXISTS orders (
  id CHAR(26) PRIMARY KEY,                  -- ULID-like, time-sortable; generated in app
  quote_id CHAR(36) NOT NULL,
  policy_hash CHAR(64) NOT NULL,
  status ENUM('PENDING_OWNER','CONFIRMED','DECLINED','CANCELLED') NOT NULL,
  fulfil_date DATE NOT NULL,
  capacity_units INT NOT NULL,
  is_rush TINYINT(1) NOT NULL,
  total_paise INT NOT NULL,
  request_json JSON NOT NULL,               -- QuoteRequest (validated)
  customer_name VARCHAR(60) NOT NULL, customer_phone VARCHAR(20) NOT NULL, delivery_address VARCHAR(200) NULL,
  notes VARCHAR(500) NULL,
  channel ENUM('web','mcp') NOT NULL,
  idempotency_key CHAR(36) NOT NULL, request_hash CHAR(64) NOT NULL,
  access_token_hash CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_orders_idem (idempotency_key),
  KEY idx_orders_status_date (status, fulfil_date)
);
CREATE TABLE IF NOT EXISTS quote_redemptions (quote_id CHAR(36) PRIMARY KEY, order_id CHAR(26) NOT NULL,
  redeemed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3));
CREATE TABLE IF NOT EXISTS capacity_ledger (fulfil_date DATE PRIMARY KEY, reserved_units INT NOT NULL DEFAULT 0,
  rush_units INT NOT NULL DEFAULT 0, CHECK (reserved_units >= 0), CHECK (rush_units >= 0));
CREATE TABLE IF NOT EXISTS contact_messages (id CHAR(26) PRIMARY KEY, name VARCHAR(60) NOT NULL, email VARCHAR(120) NOT NULL,
  message VARCHAR(2000) NOT NULL, email_status ENUM('SENT','FAILED') NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3));
CREATE TABLE IF NOT EXISTS audit_events (id BIGINT AUTO_INCREMENT PRIMARY KEY, at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actor ENUM('customer','agent','owner','system') NOT NULL, event VARCHAR(40) NOT NULL, order_id CHAR(26) NULL, detail JSON NULL,
  KEY idx_audit_order (order_id));
```

Capacity for a date is `policy.capacity.overrides[date] ?? unitsPerDay`, passed as a parameter. Rush units use the same conditional-update pattern on `rush_units`. The policy has no money/PII in logs; phone numbers are masked in logs (`******1234`).

Transaction boundaries: (1) **place order**: `INSERT IGNORE capacity_ledger` runs **before** `BEGIN` (autocommit), then the redemption insert, one conditional capacity update, order insert and audit run in one txn (exact sequence `03` §5.2). (2) **owner transition**: status update + capacity release + audit in one txn. (3) **contact**: insert, then email outside the txn, then update status.

## 7. Shop configuration (env, Zod-validated at boot, fail closed)

| Var | Kind | Notes |
|---|---|---|
| `PORT` | platform | required |
| `DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD` | platform | required in production; local from docker-compose |
| `QUOTE_SIGNING_PRIVATE_KEY` | secret | base64 PKCS8 Ed25519 |
| `QUOTE_SIGNING_PUBLIC_KEY` | secret (not sensitive) | base64 SPKI; must match private |
| `SESSION_SECRET` | secret | ≥32 random bytes base64 |
| `OWNER_TOKEN_HASH` | secret | sha256 hex of owner token |
| `CONTACT_FORM_RECIPIENT_EMAIL` | secret | e.g. hello@domain |
| `PUBLIC_BASE_URL` | config | `https://domain` (for links, Origin check) |
| `NODE_ENV` | config | `production` on GoDaddy |

## 9. Public replay launcher `/try` (R0-1)

Judges must be able to experience the Claude-powered launcher from the public URL. The shop serves a **read-only replay** of a real recorded launcher session:

```ts
interface DemoSession { v: 1; recordedAt: string /* ISO */; language: Lang; transcript: string;
  compile: { result: CompileResult; costUsd: number; model: string; latencyMs: number };      // real recorded Claude output
  answers: { questionId: string; text: string }[];
  policyVersions: BusinessPolicy[];                 // v1..vN as recorded (provenance included)
  scenarios: ScenarioWire[];                        // real recorded Claude output (daysAhead, not dates)
  gapFixes: { gapId: string; choice: string; fromVersion: number; toVersion: number }[];
  deployLog: { step: string; ms: number; ok: boolean }[];   // from the real T13 deploy, secrets redacted
  usage: { calls: number; totalUsd: number } }
```

- Stored at `bundle/try/session.json`, produced by `npm run export-demo` from the launcher's `.agentdoor/` after the real live run in T13. It's copied by `pack`. It contains no secrets and no customer data.
- `/try/:step` (steps: `describe`, `rules`, `rehearse`, `launch`) renders with the same `packages/ui` components as the launcher. Every content block carries one of three provenance badges, both visual and in text:
  - **RECORDED · Claude** (saffron outline): transcript, Claude's questions, compile result, evidence quotes, scenarios, with the model, timestamp, latency and cost from the recording.
  - **LIVE · deterministic** (leaf): engine quotes, probe results, gap linter output and the launch-gate checklist, recomputed on every request by the bundled core with the real current time.
  - **RECORDED · deployment evidence** (ink outline): the real `gddy` step log and timings from the T13 deploy (secrets redacted), plus the live `/healthz` policy hash of this running shop beside the recorded one.
- Persistent top navigation on every `/try` page: **Storefront** (`/`) · **Launch report** (`/launch-report`) · **Watch demo** (anchor to the embedded video). The intro step embeds the ≤3-min demo video (`youtube-nocookie.com` iframe with a title and a text link fallback).
- No Claude calls, no DB writes, no deploy. A missing session file shows "Replay unavailable" plus the video, never a 500.

**Optional live mode `/try/live` (stretch S-LIVE, `07` T14).** Built only after every mandatory requirement (R1–R20) passes. Disabled unless `TRY_LIVE_ENABLED=1`. Requires an access code (`TRY_ACCESS_CODE_HASH`, sha256; code given to judges in the brief), runs **compile only** with the runtime key secret `TRY_ANTHROPIC_API_KEY`, never touches the shop's policy, DB orders or deploy, and enforces a **hard $5.00 application budget**: before each call it atomically reserves the worst-case cost (`UPDATE try_budget SET reserved_micros = reserved_micros + ? WHERE id=1 AND reserved_micros + ? <= 5000000`; 0 rows → "Live demo budget used up"), then settles to the actual cost after the call. Limit 3 compiles per access code per hour. Table: `CREATE TABLE IF NOT EXISTS try_budget (id TINYINT PRIMARY KEY, reserved_micros BIGINT NOT NULL DEFAULT 0, CHECK (reserved_micros <= 5000000))`.

## 8. Launcher internal API (127.0.0.1 only, JSON)

| Method + path | Purpose |
|---|---|
| `POST /api/session` | start: `{language, transcript}` → `{sessionId}` |
| `POST /api/session/:id/compile` | run compile → `{version, compileResult, validation}` |
| `POST /api/session/:id/answers` | `{answers:[{questionId,text}]}` → recompile → new version |
| `POST /api/session/:id/rules/:path/approve` · `/edit` | approve or edit one rule → new version on edit |
| `POST /api/session/:id/rehearse` | start run → `{runId}`; `GET /api/runs/:runId` → progress + results (poll every 700 ms) |
| `POST /api/session/:id/gaps/:gapId/fix` | `{choice}` → patch → new version (rehearsal becomes stale) |
| `GET /api/session/:id/gate` | gate status: checklist + `canLaunch` |
| `POST /api/session/:id/deploy` | gate re-checked server-side → deploy job → `{jobId}`; `GET /api/deploy/:jobId` → steps |
| `GET /api/usage` | session + total Claude spend |
