Judges: start at https://agentdoor.shop/try (replay of the real launcher session) and https://agentdoor.shop/launch-report.

**Problem.** A home baker takes orders over WhatsApp, quotes from memory, under-charges rush jobs and over-commits. Soon customers' AI assistants will order for them, and a shop with no enforced rules will lose money faster. Small food sellers who cannot hire a developer benefit most.

**What it does.**
1. Describe: the owner writes in English, Hindi or Hinglish. Claude compiles a declarative policy and asks only what is missing.
2. Rehearse and approve: every rule shows the owner's own quoted words. She approves each one. A rehearsal attacks the policy and she fixes the gaps.
3. Launch: once every rule is approved and no critical gap is open, the gate signs a launch record and the shop deploys to GoDaddy on her own domain, with a storefront and an MCP endpoint (get_business_info, get_quote, place_order) so a customer's AI assistant can order.

**What is novel.**
- Rehearsal: probes plus Claude-written tricky customer scenarios try to break the policy before any customer arrives.
- Compiler with provenance: every rule quotes the owner's words.
- Launch gate: blocks launch until every rule is approved and no critical gap is open; the signed record is bound to the policy hash.
- No model in the price path: pricing, capacity and refusals are deterministic code. Quotes are Ed25519-signed and expire; orders wait for the owner to confirm; capacity is reserved atomically in MySQL.

**How Claude is used.** In the launcher, before launch: compile (description to schema-validated policy with provenance), clarify (missing questions) and scenarios (tricky customer cases for the rehearsal). Claude reads mixed-language informal text and returns structured output a strict schema can check. The deployed shop makes zero model calls.

**How GoDaddy is used.** Node.js Hosting deployed with the gddy CLI and Hosting API (upload, preview, secrets, publish, smoke test); managed MySQL; a registered domain with HTTPS via the platform CDN; a Titan mailbox; the platform mail gateway for the contact form.

**Measured results** (19 Nov 2026, our own measurements).
- One real launch with live Claude (claude-sonnet-5-5): 3 calls, $0.1496 in total.
- Rehearsal on the seeded Hinglish transcript: 12 critical gaps before fixes, 0 after typed fixes (first run: 40 probes, 10 scenarios); the signed launch record verifies.
- Deploy: about 26 s end to end. A quote signed under an older policy is refused (QUOTE_STALE_POLICY) on the live site.
- Live site: MCP lists 3 tools, get_quote returns a signed quote, place_order creates a pending order in the owner dashboard that survives a restart and a full redeploy.
- Tests: 441 unit and integration and 51 end-to-end, all passing; zero serious or critical axe violations on checked pages; 20 concurrent orders against capacity oversold zero; 18 of 19 security checklist items ticked with evidence (1 not applicable).
- Compile accuracy: 100 percent of required rules correct on four transcripts (English, Hinglish, Hindi, seeded-leaky), scored in replay of the recorded Claude outputs. The transcripts and expected outputs were written by the team.

**Honesty note.** The bundled shop, Meera's Kitchen in Pune, is an illustrative persona based on common home-bakery practices, not a real customer. /try replays a recorded launcher session without a key; blocks are badged RECORDED · Claude, LIVE · deterministic (runs now) or RECORDED · deployment evidence.

**Limitations.** Unpaid orders hold capacity until the owner declines them. schedule.dailyCutoff is stored but not enforced by the engine. Optional live Claude on /try is not built. The Hindi interface covers headings and main actions only.

**What comes next.** More business types, payment collection, the daily cutoff, live Claude on /try. Contact: hello@agentdoor.shop.
