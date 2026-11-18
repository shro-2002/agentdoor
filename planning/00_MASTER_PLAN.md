# 00 — AgentDoor Master Plan (index)

Prepared 2026-11-18 ~19:00 IST. No product code written yet.

## Situation in five lines

1. **Deadline: Fri 20 Nov 2026** (exact time "to be confirmed" per organizers). About **24 effective build hours** remain. Time, not money, is the binding constraint.
2. **Organizers mandate** a published GoDaddy app on **your own domain with HTTPS**, a **mailbox on that domain**, and a **contact form that delivers to it**. Submit **live link + GitHub repo + project brief**. The earlier frozen MVP had cut the domain and email; they are back in scope.
3. **Scoring:** Impact 35 · Demo 35 · Tech usage 15 · Execution 15. Polish goes into the owner flow, the rehearsal moment and the live AI-customer order.
4. **GoDaddy hosting rules** (official contract): egress only 80/443/MySQL; email only via a loopback gateway; managed MySQL via `DB_*`; one publish slot on Economy. The architecture is built around these.
5. **Budget (corrected after R0):** expected **$63**, worst case with every task at its cap **$82.50**, against a $90 target and $95 ceiling. It fits without cuts. The live shop spends $0 on Claude.
6. **GoDaddy budget (separate, cap $40, in [`private/GODADDY_LEDGER.md`](../private/GODADDY_LEDGER.md)):** the credit has **not** activated a plan, so checkout is required, and it **expires 23 Nov**. Plan: buy **tonight** (R0-3) Economy 1-month + `agentdoor.shop` + mailbox on godaddy.com; you approve the INR cart total. Every deploy reuses the single app's one Economy slot.
7. **R0 review: CONDITIONAL GO.** Nine P0 fixes have been applied: public `/try` replay so judges can experience the launcher; scope cuts; purchases tonight; structured-output wire schema; date-independent fixtures; deadlock-free order transaction; proxy-aware rate limits; human-checked Claude Code spend; argv-only GoDaddy secrets accepted with controls.

## Documents

| # | File | Read when |
|---|---|---|
| 01 | [Requirements and scope](01_REQUIREMENTS_AND_SCOPE.md) | Scope questions; traceability |
| 02 | [Feasibility](02_FEASIBILITY_PLAN.md) | Facts vs. assumptions; blockers; spike |
| 03 | [Architecture](03_ARCHITECTURE.md) | Components, flows, decisions + alternatives |
| 04 | [API and data contracts](04_API_AND_DATA_CONTRACTS.md) | Schemas, endpoints, MCP tools, DDL, env |
| 05 | [Agent design](05_AGENT_DESIGN.md) | Claude calls, compiler, rehearsal, gate |
| 06 | [UI/UX specification](06_UI_UX_SPECIFICATION.md) | Tokens, components, every screen |
| 07 | [Implementation tasks](07_IMPLEMENTATION_TASKS.md) | Task cards, schedule, cut list |
| 08 | [Test and security plan](08_TEST_AND_SECURITY_PLAN.md) | Test IDs, fixtures, threat model |
| 11 | [Demo and submission](11_DEMO_AND_SUBMISSION.md) | 3-minute script, brief, checklist |
| 12 | [Risk register](12_RISK_REGISTER.md) | Risks and contingencies |

Root operating files: [`CLAUDE.md`](../CLAUDE.md) · [`TASKS.md`](../TASKS.md) · [`STATUS.md`](../STATUS.md) · [`private/COST_LEDGER.md`](../private/COST_LEDGER.md) (Claude) · [`private/GODADDY_LEDGER.md`](../private/GODADDY_LEDGER.md) (GoDaddy)

## Critical path

**T00** keys + approved GoDaddy purchases (tonight) → **T01** spike (preview → publish; MCP, MySQL, mail, proxy hops, redeploy) → **T05** shop data layer → **T06** shop HTTP + MCP → **T09** deploy adapter → **T12** E2E/hardening → **T13** launch + submit.
T02→T03→T04 (core) run in parallel with T00/T01 and must land before T05. Lane B (T07→T08→T10) and T11 run beside it.

## Top decisions (with reasons in `03` §4)

- Local launcher + one GoDaddy-published shop. Keys stay local, no model in the price path, fits one publish slot.
- Declarative policy + pure engine + three-layer launch gate (launcher, deploy, shop boot).
- MySQL conditional UPDATE for capacity; PK for replay; UNIQUE for idempotency.
- MCP stateless JSON over Streamable HTTP; REST fallback if the CDN interferes.
- `gddy` CLI as the Hosting API client; GoDaddy's vended email helper.
- Sonnet 5.5 for every task (T05 at high effort, backed by concurrency tests and the R2 review); Haiku 5.5 only for string-table subagents.
- Public replay `/try` gives judges the launcher experience without exposing keys or credits.

## Unresolved blockers (owner: you)

1. Exact submission time: check the HackerEarth dashboard / office hours 19 Nov 16:00.
2. GoDaddy purchases **tonight**: Economy 1-month, `agentdoor.shop`, mailbox. The cart total incl. GST must be covered by the $40 credit.
3. Claude Console: confirm $100 balance, create dev/runtime keys, check whether a workspace spend limit exists, add no card.
4. Real baker input with consent (by 19 Nov 11:00), or use the labelled illustrative persona.
5. Spike outcomes (MCP via CDN, mail gateway, MySQL) are unknown until T01 runs.
