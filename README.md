# AgentDoor

AgentDoor turns a home baker's description into an owner-approved, rehearsed business policy, then opens a shop on her own domain that people and AI assistants can order from.

- Live: https://agentdoor.shop (also www)
- Judge entry points: https://agentdoor.shop/try (replay of the real launcher session) and https://agentdoor.shop/launch-report
- Pages: `/` storefront, `/order`, `/contact`, `/launch-report`, `/try`; MCP endpoint at https://agentdoor.shop/mcp
- Contact: hello@agentdoor.shop
- Demo video: link added at submission

The bundled shop, "Meera's Kitchen" in Pune, is an illustrative persona based on common home-bakery practices. It is not a real customer.

## Why

A home baker often takes orders over WhatsApp, quotes from memory, under-charges rush jobs and accepts more than she can bake. As customers start sending AI assistants to order for them, a shop without written, enforced rules is exposed. AgentDoor gives a first-time seller those rules in her own words (English, Hindi or Hinglish), proves they hold up before launch, and enforces them in code.

## How it works

![Architecture](docs/architecture.svg)

1. Describe. Claude compiles the description into a declarative policy. Every rule carries provenance: rules the owner stated carry her own quoted words, and defaults or inferences are labelled "AgentDoor suggested this: the owner did not say it". Claude asks only what is missing.
2. Rehearse and approve. The owner approves every rule. A rehearsal runs deterministic probes and Claude-written tricky customer scenarios against the policy and lists gaps. She fixes them and re-runs.
3. Launch. The launch gate blocks until every rule is approved and no critical gap is open, then signs a launch record bound to the policy hash. The shop deploys to GoDaddy Node.js hosting with a storefront and an MCP endpoint (`get_business_info`, `get_quote`, `place_order`).

At runtime there is no model in the price path. Pricing, capacity and refusals are pure functions in `packages/core`. Quotes are Ed25519-signed and expire. Orders go to a durable pending state that the owner confirms. Capacity is reserved atomically in managed MySQL.

## Quick start

A fresh clone can run the tests and the launcher in fixture mode. It cannot reproduce the live shop or `/try` without running the launch script and the deploy (see Live mode and deploy), because `bundle/` and `.agentdoor/` are gitignored generated folders.

Requires Node.js 22 and Docker.

```
npm ci
docker compose up -d mysql
npm test            # unit, property and integration tests, replay mode (no key needed)
npm run e2e         # Playwright end-to-end and accessibility tests
npm run launcher    # launcher at http://127.0.0.1:4321, fixture (replay) mode without a key
```

`npm run shop` starts the shop locally and needs the database. `npm run typecheck` runs the TypeScript build check. `scripts/fresh-clone-check.sh` tests the committed files from a fresh clone. `scripts/check-secrets.sh` scans for secrets before a commit.

## Live mode and deploy

Live Claude needs a local `.env.local` at the repository root containing `ANTHROPIC_API_KEY`. Never commit it; it is gitignored. Start the launcher with `AGENTDOOR_LLM_MODE=live npm run launcher`. Modes are `live`, `record` and `replay` (default). Tests never call Claude.

The launch script writes the bundle the shop serves: `npx tsx scripts/launch-demo.ts --transcript seeded-leaky-hinglish` makes a live launch and needs the key in `.env.local`; add `--replay` to rebuild from recorded fixtures instead. The recorded launch used the Hinglish transcript. Then run `npm run export-demo` to build the `/try` session, and deploy.

Deployment needs the `gddy` CLI logged in on your machine and the documented confirmation: both the `--live` flag and the environment variable `AGENTDOOR_LIVE_DEPLOY=I-CONFIRM-LIVE-DEPLOY`.

```
AGENTDOOR_LIVE_DEPLOY=I-CONFIRM-LIVE-DEPLOY npm run deploy -- --live --domain <your-domain>
```

Without both, the script exits before doing anything. Shop secrets are sent to the platform only in a request body by `scripts/set-secrets.mjs`, never as command-line arguments. A redeploy reuses the same single hosting app and URL. `npm run export-demo` builds the `/try` session from a launch.

## Architecture and security patterns

- Policy is declarative JSON validated by Zod; model output is never executed.
- `packages/core` has no I/O and no clock reads; time is injected; money is integer paise.
- Order creation is one transaction (quote consumption, capacity reservation, order) with a fixed lock order and bounded retry.
- Quotes are Ed25519-signed with expiry; a quote signed under an older policy is refused on the live site (`QUOTE_STALE_POLICY` when the hash changed; `QUOTE_EXPIRED` after 30 minutes). A boot guard puts the shop in read-only mode if the policy hash does not match the launch record.
- Strict input schemas with size limits, escaped HTML output, parameterized SQL, rate limiting, a uniform error envelope with no stack traces.
- Secrets live only in the environment or platform secrets and are never logged or rendered.
- `/try` never calls Claude and never writes to the database.

## Testing

| Suite | Result on 19 Nov 2026 |
|---|---|
| Unit and integration | 464 passing |
| End-to-end (Playwright) | 54 passing |
| Accessibility (axe) | zero serious or critical violations on checked pages |
| Concurrency C-CAP-1 | 20 concurrent orders against capacity, zero oversold in repeated runs |
| Dependency audit | `npm audit` reports 0 vulnerabilities |
| Security checklist | 18 of 19 items ticked with evidence, 1 not applicable |

The plan had an independent three-reviewer security and conformance review of the shop (found no critical issue; its ten fixes are in) and an independent judge-style audit of the submission (its fixes are in). Compile accuracy was scored against hand-written expected outputs for four transcripts (English, Hinglish, Hindi, seeded-leaky): 100 percent of required rules correct in replay of the recorded Claude outputs. The transcripts and expected outputs were written by the team.

## GoDaddy usage

- Node.js Hosting, deployed with the `gddy` CLI and Hosting API: upload, preview, secrets through the official `updateSecrets` endpoint (value in the request body), publish, domain attach check, smoke test.
- Managed MySQL for orders, capacity and quote redemptions.
- A registered domain with HTTPS through the platform CDN.
- A Titan mailbox on the domain, and the platform mail gateway for the contact form.

Measured deploy steps from the real deploy log: pack 1.2 s, app check 3.1 s, subscription check 1.0 s, upload 8.7 s, secrets (preview) 1.6 s, preview restart 5.0 s, secrets (publish) 1.0 s, publish 6.9 s, domain check 0.9 s, smoke test 0.9 s: ten steps, 30.3 s in total. The upload endpoint is behind a platform bot filter that sometimes answers 403 for an archive; the deploy repacks and retries (up to three attempts).

## Claude usage

Claude is used in the launcher only: the compiler (policy with provenance), the clarifier, and the scenario writer for rehearsal. The recorded session replayed on `/try` is a real live launch of the illustrative persona Meera's Kitchen (Pune), where the owner's description is in Hinglish (Roman script). It made 3 live calls with claude-sonnet-5-5 (compile round 1 $0.0739, compile round 2 $0.0386, scenarios $0.0341), $0.1467 in total (about $0.15) for the whole launch. In that launch the first rehearsal run found 10 critical gaps (the three deliberate omissions: no daily capacity limit, no rush cap, no handling for unlisted delivery areas, plus rules awaiting the owner's approval and three scenario gaps). After the owner approved the 24 rules she stated and applied three typed fixes (10 units a day, rush capped at 2 a day, unlisted areas refused), 3 critical gaps remained, all scenario gaps, accepted as the owner's intent; the final run has 0. The signed launch record verifies. The pages label "First rehearsal run" and "Final rehearsal run". The shop makes zero model calls at runtime. `/try` replays the recorded session; its blocks are badged RECORDED · Claude, LIVE · deterministic, or RECORDED · deployment evidence.

## Known limitations

- The demo bakery is an illustrative persona.
- `/try` replays a recorded session; only the blocks badged LIVE run when the page loads.
- Unpaid orders hold capacity until the owner declines them.
- `schedule.dailyCutoff` is stored but not enforced by the engine.
- Delivery area names must match the published spelling or an alias the owner listed. A variant spelling such as "Hinjawadi" for "Hinjewadi" is refused with `AREA_NOT_SERVED`, which is the safe behaviour.
- The Claude-written scenarios do not always line up with weekdays (for example a case aimed at a Monday), which produces scenario gaps that a person has to judge.
- The optional live Claude on `/try` is not built.
- The Hindi interface covers headings and main actions only.

## Repository layout

| Path | Contents |
|---|---|
| `packages/core` | schemas, canonical hash, deterministic engine, probes, signing, order state machine |
| `packages/ui` | shared HTML components used by the launcher and `/try` |
| `apps/launcher` | local launcher: Claude orchestration, rehearsal, gate, deploy adapter, fixtures |
| `apps/shop` | deployed Express app: pages, REST, MCP, owner dashboard, launch report, contact form, MySQL |
| `scripts` | deploy, secrets, key generation, launch and verification scripts |
| `e2e` | Playwright tests |
| `docs` | brief, architecture diagram, demo script, screenshots |
| `planning` | design documents |
| `bundle` | launch bundle shipped to the shop (gitignored, generated) |

## License

MIT. See the `LICENSE` file.
