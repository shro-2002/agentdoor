# 01 — Requirements and Scope

Status: FROZEN 2026-11-18. Changes need an entry in `STATUS.md` → Decisions.

## 1. Product statement

AgentDoor is the first-mile on-ramp to agentic commerce. A nontechnical home baker describes her business in English, Hindi or Hinglish. Claude draws out the rules she never stated and compiles them into a validated, declarative **business policy**. A deterministic **rehearsal** attacks that policy before launch, and launch stays blocked until every critical gap is fixed and every rule has been approved by the owner. AgentDoor then deploys a storefront through the GoDaddy Hosting API. People and AI agents (over MCP) can request signed quotes from it and place pending orders, and every quote follows the approved rules exactly.

Pitch line: *"GoDaddy's agent chain of trust stops rogue agents at transaction time. AgentDoor stops bad business rules before launch, and it gets a first-time seller into that chain."*

## 2. Requirements

Each requirement maps to tasks in `07_IMPLEMENTATION_TASKS.md`. The full matrix is §5.

### Product requirements (from brief, non-negotiable)

| ID | Requirement | Acceptance (summary; full criteria in task) |
|---|---|---|
| R1 | Multilingual onboarding: English, Hindi (Devanagari), Hinglish (romanized) | 3 fixture transcripts compile; read-back in input language |
| R2 | Claude-powered requirement discovery and clarification | ≤5 questions, 1 round; every question targets a missing critical slot |
| R3 | Compile to validated declarative policy, never executable code | Output is Zod-validated JSON; the engine is fixed code; no `eval`/codegen anywhere |
| R4 | Source evidence + owner approval for every rule | Every policy path has provenance; source quote is a verbatim substring of the transcript or is marked `owner_edit`; launch requires all `approved` |
| R5 | Deterministic pricing, capacity, delivery, preparation, order policies | Pure function; same input gives same output (property test); integer paise only |
| R6 | Pre-launch rehearsal: deterministic probes + Claude-generated hard scenarios | Seeded leaky policy: ≥3 known gaps found; after fixes: 0 critical |
| R7 | Launch blocked while critical gaps remain | Gate refuses in launcher, deploy script and shop boot (three independent checks) |
| R8 | Approved policy + rehearsal results bound to a policy hash | Canonical SHA-256; hash in launch record, quotes, report; shop verifies at boot |
| R9 | Real GoDaddy Hosting API deployment (gddy CLI) | One command: reuse the single app → upload (preview) → secrets → publish → smoke. **Deployment gate:** live public storefront, working MCP endpoint, DB persistence across restart and redeploy, successful same-app redeploy (I-DEP-4..7) |
| R10 | Human-accessible storefront | Menu, quote, order request, order status, contact form; WCAG 2.2 AA basics |
| R11 | Agent-accessible storefront over MCP (subject to feasibility) | Claude custom connector lists 3 tools and completes quote → order; fallback in `02` |
| R12 | Signed quotes + durable pending-order requests | Ed25519 quote tokens; orders persisted in MySQL in status `PENDING_OWNER` |
| R13 | Atomic capacity reservation, replay prevention, idempotency | 20 concurrent orders on capacity 5 → exactly 5 succeed; reused quote rejected; same idempotency key gives the same order |
| R14 | Owner dashboard + public launch-readiness report | Owner can confirm/decline; report shows rules, sources, rehearsal results, hash, public key |

### Organizer-mandated deliverables (kickoff deck, 13 Nov 2026, pages 4–6, 8, 12)

These were missing from the earlier frozen MVP, which cut the domain and email. They are **mandatory for submission**.

| ID | Requirement | Source |
|---|---|---|
| R15 | App deployed and **published** on GoDaddy Node.js hosting | Deck p.6, p.12 checklist |
| R16 | **Own domain** bought on godaddy.com, DNS pointing at app, **HTTPS** | Deck p.6, p.8 |
| R17 | **Mailbox on that domain** (e.g. `hello@domain`) that receives a test email | Deck p.6, p.8 |
| R18 | **Working contact form** delivering to that mailbox; no passwords in code/repo | Deck p.6, p.8, p.12 |
| R19 | Submit via HackerEarth: **live link, GitHub repository, project brief** | Deck p.6, p.11 |
| R20 | **Mandatory public `/try` replay:** judges experience the Claude-powered launcher from the submitted URL; recorded Claude output, live deterministic execution and recorded deployment evidence are clearly badged; embedded demo video; persistent navigation to storefront and launch report; ribbon on every shop page | R0-1: the live link otherwise shows only the generated storefront; Impact + Demo = 70% |

### Judging rubric (deck p.10). It drives every trade-off.

| Criterion | Weight | What it means for us |
|---|---|---|
| Impact | 35% | Real person, real pain (under-pricing, over-committing); show who benefits |
| Demo | 35% | Working live demo that proves the impact; three clear beats |
| Tech usage | 15% | Claude and GoDaddy used **beyond basic integration**: compiler + rehearsal + Hosting API + domain + email + MCP |
| Execution | 15% | Code quality, design patterns, **security patterns**, engineering practice |

70% sits in impact and demo. Spend polish on the launcher flow and the live customer-agent moment, not on breadth.

## 3. Scope

### In (MVP)

- Single business per deployment (one bakery). The launcher can be rerun to redeploy.
- Local launcher app (owner's machine) holding the Claude key and the GoDaddy credentials.
- Deployed shop app on GoDaddy: storefront, MCP endpoint, owner dashboard, launch report, contact form, managed MySQL.
- One vertical: home bakery (cakes, cookies, boxes; per-day capacity; named delivery areas).

### Out (do not build)

Payments; ANS registration; multiple verticals; multi-tenancy; hosted launcher; voice input; customer accounts; geocoding (named areas only); inventory; notifications beyond the mandatory contact form; a separate admin SPA; Kubernetes/queues/Redis; and any LLM in the quote/price path.

### Stretch (only after T12 passes, timeboxed)

1. Order-received email to owner via the same mail gateway (30 min).
2. Hindi UI strings on the storefront (45 min).
3. ANS: excluded; mention as roadmap only.
4. **R21 (optional, T14):** live Claude on `/try/live` behind an access code with a hard $5 application budget. Only after R1–R20 pass and the Claude ledger is ≤ $75.

## 4. Assumptions (verify in `02`)

| ID | Assumption | Verified by |
|---|---|---|
| A1 | Submission closes 20 Nov 2026; exact time is "to be confirmed" (deck p.5). **Plan to submit by 20 Nov 18:00 IST.** | User checks HackerEarth dashboard / office hours 19 Nov 16:00 |
| A2 | $40 GoDaddy credit (email 18 Nov) covers Economy 1-month + Titan Pro Light 1-month + one domain | T00 checkout preview shows ₹0/$0 |
| A3 | Claude custom connector reaches an MCP endpoint behind GoDaddy's CDN | T01 spike |
| A4 | Managed MySQL env vars `DB_*` are injected on the published app | T01 spike (contract C12 says yes) |
| A5 | Mail gateway `127.0.0.1:2525` delivers to our Titan mailbox | T01 spike (contract C13 says yes) |
| A6 | Real baker input available (2–3 real order messages or her rules) with consent | User, 19 Nov morning. Otherwise label demo persona as illustrative |

## 5. Traceability matrix

| Req | Tasks | Test IDs (`08`) |
|---|---|---|
| R1 | T07, T10 | U-CMP-1..3, E2E-1 |
| R2 | T07, T10 | U-CMP-4, E2E-1 |
| R3 | T02, T07 | U-SCH-1..4, SEC-9 |
| R4 | T02, T07, T10 | U-CMP-5, U-GATE-2 |
| R5 | T03 | U-ENG-*, P-ENG-1..4 |
| R6 | T08 | U-REH-1..4 |
| R7 | T08, T09, T05 | U-GATE-1..4, SEC-8 |
| R8 | T02, T04, T09, T11 | U-HASH-1..3, U-SIG-3 |
| R9 | T01, T09, T13 | I-DEP-1..8 |
| R10 | T06, T11 | E2E-2, A11Y-1..3 |
| R11 | T01, T06 | I-MCP-1..4, E2E-3 |
| R12 | T04, T05, T06 | U-SIG-1..4, I-ORD-1 |
| R13 | T05 | I-ORD-2..5, C-CAP-1 |
| R14 | T06, T11 | E2E-4, SEC-3..4 |
| R15–R18 | T00, T01, T06, T13 | I-MAIL-1, I-DEP-3, SUB-1 |
| R19 | T13 | SUB-1..3 |
| R20 | T08, T10, T11, T13 | E2E-5, U-DEMO-1, SUB-1 |
| R21 (optional) | T14 | I-TRY-1..3 |
