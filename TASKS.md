# TASKS — ordered tracker

Details: `planning/07_IMPLEMENTATION_TASKS.md`. Status: `todo` · `doing` · `done` · `blocked` · `cut`. Updated after R0 (CONDITIONAL GO, P0 fixes applied).

| ID | Task | Lane | Deps | Model / effort | Exp $ | Cap $ | Time | Target window (IST) | Status |
|---|---|---|---|---|---|---|---|---|---|
| T00 | Human: submission time, Console keys/limits; **approve + buy Economy 1-mo, domain, mailbox tonight** (GODADDY_LEDGER) | Human | — | — | 0 | 0 | 45m | **Wed 19:45** (credit expires 23 Nov) | todo |
| T01 | Spike: single app `agentdoor-shop`, preview → publish, MCP via CDN, MySQL (+`max_connections`), mail, proxy hops, restart/redeploy | A | T00 | S / medium | 3.00 | 4.00 | 2h | Wed 21:00 | todo |
| T02 | Monorepo scaffold (all deps up front, `packages/ui` stub), Zod domain + wire schemas, canonical hash, compose, secret scan | A | — | S / medium | 3.00 | 4.00 | 60m | Wed 19:45 | todo |
| T03 | Deterministic engine, probes, gap linter, property tests | A | T02 | S / high | 4.00 | 5.00 | 90m | Wed 23:00 | todo |
| T04 | Ed25519 quote tokens, launch record, order state machine | A | T02 | S / medium | 2.00 | 2.50 | 45m | Thu 00:30 | todo |
| T05 | Shop data layer: migrations, deadlock-free order txn, capacity, idempotency, boot guard | A | T01,T03,T04 | S / **high** | 6.00 | 9.00 | 2h | Thu 08:30 | todo |
| T06 | Shop HTTP: REST, MCP (3 tools), owner auth, contact (gateway), proxy-aware rate limits, security middleware | A | T05 | S / high | 6.00 | 8.00 | 2h | Thu 12:30 | todo |
| T07 | Claude client (fixture-id replay, clock, budget) + compiler (wire schema) + 1 clarify round + fixtures | B | T02 | S / high | 6.00 | 8.00 | 2h | Wed 23:30 / Thu 08:30 | todo |
| T08 | Rehearsal, scenarios (`daysAhead`), template gap text, fixes, launch gate, `export-demo` | B | T03,T04,T07 | S / high | 5.00 | 6.00 | 2h | Thu 11:00 | todo |
| T09 | Deploy script: pack, gddy, linear idempotent steps, body-based secrets (PREVIEW/PUBLISH separately), smoke; **deployment gate I-DEP-4..7** | A | T01,T04,T06 | S / medium | 4.00 | 5.00 | 90m | Thu 17:00 | todo |
| T10 | `packages/ui` components + launcher L1–L4 | B | T07,T08,(T09) | S / medium + H sub | 6.00 | 8.00 | 2.5h | Thu 17:00 | todo |
| T11 | Shop UI S1–S5, S7 + **S8 `/try` public replay** (badges, video, nav) + ribbon | A | T06,T10 | S / medium | 5.00 | 7.00 | 2.5h | Thu 21:00 | todo |
| T12 | E2E (incl. E2E-5), security pass, a11y, fresh-clone, fixes | A | T06,T08–T11 | S / high | 5.00 | 6.00 | 2–3h | Fri 08:00 | todo |
| T13 | Live launch, `export-demo` (real session), deploy, **mandatory video**, README, brief, submit | A+Human | T12,T00 | S / low-med | 3.00 | 4.00 | 3h | Fri 11:00 → submit ≤ 18:00 | todo |
| RT | Runtime Claude (fixtures, live runs, demo) | — | — | S | 5.00 | 6.00 | — | — | todo |
| T14 | OPTIONAL `/try/live`: access code, hard $5 app budget (only if R1–R20 pass and ledger ≤ $75) | A | T13 | S / medium | (2.00) | (3.00) | 90m | after submit-ready | optional |
| | **Totals** | | | | **63.00** | **82.50** | | | |

GoDaddy spend is tracked separately in `private/GODADDY_LEDGER.md` (cap $40; every purchase needs your explicit approval).

Each task runs in a fresh Claude Code session (`claude-sonnet-5-5`, effort high; medium for T01, T02, T04, T09–T11, T13, T14). Totals exclude the optional T14.

Reviews: R0 done (CONDITIONAL GO) · **R2 after T06** · **R4 before submit**. R1 and R3 skipped (time cut).

Milestones: **M1** Thu 01:00: spike passed, core green · **M2** Thu 16:00: shop takes MCP orders locally; compiler + rehearsal green · **M3** Thu 21:00: real deploy on own domain passes I-DEP-4..7 · **M4** Fri 11:00: feature freeze, E2E green, `/try` live · **M5** Fri ≤18:00: submitted.
