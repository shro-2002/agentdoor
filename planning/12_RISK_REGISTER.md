# 12 — Risk Register

Likelihood/impact: H/M/L. Every CRITICAL/HIGH risk has a mitigation and a test or spike.

| ID | Risk | L | I | Mitigation | Detection / test | Trigger → contingency |
|---|---|---|---|---|---|---|
| K1 | Run out of time (≈24 build hours) | H | H | Two parallel lanes; strict critical path; cut list `07` §4; feature freeze 20 Nov 11:00 | STATUS vs schedule at each task end | >2 h behind at Thu 21:00 → apply cuts 1–4 |
| K2 | Submission time earlier than assumed | M | H | User confirms time today; plan to submit by 18:00 | B1 | If earlier: move T13 forward, freeze immediately |
| K3 | MCP blocked/buffered by GoDaddy CDN | M | H | Stateless JSON transport; T01 spike first | I-MCP via curl + connector in T01 | Fallback REST + local MCP shim (`02` B3) |
| K4 | Managed MySQL missing or behaves differently | L | H | Contract C12 confirms; spike verifies | `/spike/db` | In-process repo + snapshot; document |
| K5 | Mail gateway doesn't reach Titan mailbox | M | H (mandatory) | Use vended helper exactly; recipient via env | `/spike/mail` | Office hours; keep DB copy; show external test email |
| K6 | Purchases exceed $40 credit (tax, Titan yearly-only) | M | H | Plan worst case $35.23; checkout total reviewed before each approval; free mailbox trial preferred | GODADDY_LEDGER | Drop Titan yearly → trial; cheaper TLD; ask organizers; never pay out of pocket without your decision |
| K6b | **Credit expires 23 Nov 2026** before purchases are made | L | H | Purchases happen tonight in T00 (R0-3) | GODADDY_LEDGER | — |
| K6c | Auto-renewals charge later (domain renews $59.99) | L | M | Turn off auto-renew after purchase; no card on file | Account UI | — |
| K6d | Managed MySQL not auto-provisioned / low connection limit | M | H | Spike checks `DB_*` and `max_connections`; pool of 5 | T01 | Enable in dashboard; ask office hours |
| K20 | Judges never see the launcher (public URL = storefront only) | H | H | `/try` replay + ribbon + mandatory video (R0-1) | E2E-5 | — |
| K21 | Rate limits misfire behind CDN (shared bucket or spoofed XFF) | M | H | Measured hop count; exact `trust proxy` (R0-7) | I-API-7 | Global per-route limits ×10 |
| K23 | `updateSecrets` via `gddy api call --file` rejected or variant param misrouted | M | M | Verified operation schema; T01 tests both variants | T01 | Enter secrets in the GoDaddy hosting dashboard |
| K24 | Private billing/account data published with the repo | L | M | `private/` gitignored; public docs keep hackathon-level facts | SEC-19 | Rewrite history before making the repo public |
| K7 | Domain DNS/HTTPS slow | M | M | Attach domain right after first publish (T01) | `verificationStatus` | Submit PREFIX URL temporarily; keep polling |
| K8 | Compiler quality weak for Hindi/Hinglish | M | M | Few-shot, verbatim guard, owner approval, clarify loop; accuracy tests | U-CMP-1..3 | Demo in Hinglish (strongest); Hindi as secondary |
| K9 | Rehearsal looks like noise / fake | M | H (demo) | Gap catalog tied to real money/over-commit harms; concrete examples in owner's words | R3 review | Reduce to the 3 strongest gaps in demo |
| K10 | Pitch collision with GoDaddy's Oct "chain of trust" demo | M | M | Lead with the owner and the rehearsal; frame quotes as "following the chain-of-trust pattern" | R0/R4 review | — |
| K11 | Credit overrun | L | H | Caps, ledger, alerts, no payment method, stop at $85 | COST_LEDGER | stop at $85 |
| K13 | Secret committed (mailbox password, keys) | L | H | gitignore, secret scan, secrets only in hosting | SUB-3 | Rotate immediately; force-push is not enough. Rotate first |
| K14 | Live demo network failure at finale | M | H | Recorded backup video; fixture mode runs offline | Rehearse twice | Switch to video |
| K15 | Lane collisions (two sessions editing same files) | M | M | Directory ownership per lane; STATUS requests for core changes | git conflicts | Serialize remaining tasks |
| K16 | No real user evidence (impact 35%) | M | M | Ask 1–2 bakers today; honest persona labelling otherwise | B9 | Persona + "who benefits" grounded in public descriptions of home-bakery work; no invented stats |
| K17 | Claude Sonnet 5.5 API shape errors (temperature, forced tool, disabled thinking → 400) | M | L | Contract notes in `05` §2; replay tests; one live smoke | First live record in T07 | Fix per claude-api skill |
| K18 | GoDaddy platform changes/outage during demo | L | H | Health check before judging; video backup | `/healthz` | Video |
| K19 | Shared PREVIEW/PUBLISH DB: preview tests pollute live orders | M | L | Demo data reset by declining test orders; migrations additive only | Owner dashboard | Soft "test" flag on orders placed with `notes` starting `[TEST]` (optional) |
