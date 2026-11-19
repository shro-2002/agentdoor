Judges: start at https://agentdoor.shop/try (replay of the real launcher session) and https://agentdoor.shop/launch-report.

**Problem.** A home baker takes orders over WhatsApp, quotes from memory, under-charges rush jobs and over-commits. Soon customers' AI assistants will order for them, and a shop with no enforced rules will lose money faster. Small food sellers who cannot hire a developer benefit most.

**What it does.**
1. Describe: the owner writes in English, Hindi or Hinglish (the demo owner types Hinglish). Claude compiles a declarative policy and asks only what is missing.
2. Rehearse and approve: rules the owner stated carry her own quoted words; defaults or inferences are labelled "AgentDoor suggested this: the owner did not say it". She approves each one. A rehearsal attacks the policy and she fixes the gaps.
3. Launch: once every rule is approved and no critical gap is open, the gate signs a launch record and the shop deploys to GoDaddy on her own domain, with a storefront and an MCP endpoint (get_business_info, get_quote, place_order) so a customer's AI assistant can order.

**What is novel.**
- Rehearsal: probes plus Claude-written tricky customer scenarios try to break the policy before any customer arrives.
- Compiler with provenance: rules the owner stated carry her own quoted words; defaults and inferences are labelled "AgentDoor suggested this: the owner did not say it".
- Launch gate: blocks launch until every rule is approved and no critical gap is open; the signed record is bound to the policy hash.
- No model in the price path: pricing, capacity and refusals are deterministic code. Quotes are Ed25519-signed and expire; orders wait for the owner to confirm; capacity is reserved atomically in MySQL.

**How Claude is used.** In the launcher, before launch: compile (description to schema-validated policy with provenance), clarify (missing questions) and scenarios (tricky customer cases for the rehearsal). Claude reads mixed-language informal text and returns structured output a strict schema can check. The deployed shop makes zero model calls.

**How GoDaddy is used.** Node.js Hosting deployed with the gddy CLI and Hosting API (upload, preview, secrets, publish, smoke test); managed MySQL; a registered domain with HTTPS via the platform CDN; a Titan mailbox; the platform mail gateway for the contact form.

**Measured results** (19 Nov 2026, our own measurements).
- One real live launch of Meera's Kitchen with the owner's description in Hinglish (claude-sonnet-5-5): 3 calls (compile round 1 $0.0739, compile round 2 $0.0386, scenarios $0.0341), $0.1467 in total, about $0.15.
- Rehearsal in that launch: 10 critical gaps on the first run (the three deliberate omissions plus rules awaiting approval and three scenario gaps). After the owner approved the 24 rules she stated and applied three typed fixes (10 units a day, rush capped at 2 a day, unlisted areas refused), 3 critical gaps remained, all scenario gaps accepted as her intent; final 0. The signed launch record verifies. The pages label "First rehearsal run" and "Final rehearsal run".
- Deploy of the whole shop, from the real deploy log: ten steps, 30.3 s in total (pack 1.2 s, app check 3.1 s, subscription check 1.0 s, upload 8.7 s, secrets (preview) 1.6 s, preview restart 5.0 s, secrets (publish) 1.0 s, publish 6.9 s, domain check 0.9 s, smoke test 0.9 s). The upload endpoint is behind a platform bot filter that sometimes answers 403 for an archive; the deploy repacks and retries, up to three attempts.
- A quote signed under an older policy is refused on the live site (QUOTE_STALE_POLICY when the hash changed; QUOTE_EXPIRED after 30 minutes).
- Live site: MCP lists 3 tools, get_quote returns a signed quote, place_order creates a pending order in the owner dashboard that survives a restart and a full redeploy.
- Tests: 464 unit and integration and 54 end-to-end, all passing; zero serious or critical axe violations on checked pages; 20 concurrent orders against capacity oversold zero; 18 of 19 security checklist items ticked with evidence (1 not applicable).
- Compile accuracy: 100 percent of required rules correct on four transcripts (English, Hinglish, Hindi, seeded-leaky), scored in replay of the recorded Claude outputs. The transcripts and expected outputs were written by the team.

**Reviews.** An independent three-reviewer security and conformance review of the shop (found no critical issue; its ten fixes are in) and an independent judge-style audit of the submission (its fixes are in).

**Honesty note.** The bundled shop, Meera's Kitchen in Pune, is an illustrative persona based on common home-bakery practices, not a real customer. /try replays a recorded launcher session without a key; blocks are badged RECORDED · Claude, LIVE · deterministic (runs now) or RECORDED · deployment evidence.

**Limitations.**
- The demo bakery is an illustrative persona.
- /try replays a recorded session; only the blocks badged LIVE run when the page loads.
- Unpaid orders hold capacity until the owner declines them.
- schedule.dailyCutoff is stored but not enforced by the engine.
- Delivery area names must match the published spelling or an alias the owner listed; a variant spelling such as "Hinjawadi" for "Hinjewadi" is refused with AREA_NOT_SERVED, which is the safe behaviour.
- The Claude-written scenarios do not always match weekdays (for example a case aimed at a Monday), which produces scenario gaps that a person has to judge.
- The optional live Claude on /try is not built.
- The Hindi interface covers headings and main actions only.

**What comes next.** More business types, payment collection, the daily cutoff, live Claude on /try. Contact: hello@agentdoor.shop.
