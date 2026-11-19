Judges: start at https://agentdoor.shop/try (replay of the real launcher session) and https://agentdoor.shop/launch-report.

**Problem and who benefits.** A home baker takes orders over WhatsApp, quotes from memory, under-charges rush jobs and over-commits. Soon customers' AI assistants will order for them, and a shop with no enforced rules will lose money faster. Small food sellers who cannot hire a developer benefit most.

**What it does.**
1. Describe: the owner writes in English, Hindi or Hinglish (the demo owner types Hinglish), and Claude compiles a declarative policy and asks only what is missing.
2. Rehearse and approve: she approves each rule, then a rehearsal attacks the policy and she fixes the gaps.
3. Launch: once every rule is approved and no critical gap is open, the gate signs a launch record and the shop deploys to GoDaddy on her own domain with a storefront and an MCP endpoint for customers' AI assistants.

**What is novel.**
- Rehearsal: probes plus Claude-written tricky customer scenarios try to break the policy before any customer arrives.
- Provenance: stated rules carry the owner's quoted words; defaults and inferences are labelled "AgentDoor suggested this: the owner did not say it".
- Launch gate: the signed record is bound to the policy hash.
- No model in the price path: deterministic code, Ed25519-signed expiring quotes, atomic capacity reservation in MySQL.

**How Claude is used.** In the launcher only: compile (description to schema-validated policy with provenance), clarify (missing questions) and scenarios (tricky customer cases for the rehearsal). Claude reads mixed-language informal text and returns structured output a strict schema can check. The deployed shop makes zero model calls.

**How GoDaddy is used.** Node.js Hosting deployed with the gddy CLI and Hosting API, managed MySQL, and a registered domain with HTTPS via the platform CDN. A Titan mailbox and the platform mail gateway serve the contact form.

**Measured results** (19 Nov 2026, our own measurements).
- 3 live Claude calls (claude-sonnet-5-5), $0.1467 for the whole launch.
- Rehearsal: 10 critical gaps on the first run, 3 scenario gaps accepted as the owner's intent, final 0.
- Deploy: 10 steps, 30.3 s.
- Live MCP quote, order, restart and redeploy persistence, and stale-quote refusal.
- 464 unit and integration and 54 end-to-end tests, zero serious or critical accessibility violations, 20 concurrent orders oversold zero, 18 of 19 security checklist items with evidence.
- Compile accuracy 100 percent on four transcripts, scored in replay against team-written expected outputs.

**Reviews.** An independent three-reviewer security and conformance review of the shop (found no critical issue; its ten fixes are in) and an independent judge-style audit of the submission (its fixes are in).

**Honesty note.** The bundled shop, Meera's Kitchen in Pune, is an illustrative persona based on common home-bakery practices, not a real customer. /try replays a recorded launcher session without a key; blocks are badged RECORDED · Claude, LIVE · deterministic (runs now) or RECORDED · deployment evidence.

**Limitations.** The demo bakery is an illustrative persona; /try replays a recorded session and only blocks badged LIVE run on load; unpaid orders hold capacity until the owner declines them; schedule.dailyCutoff is stored but not enforced; delivery area names must match a published name or owner-listed alias (a variant spelling is refused, the safe behaviour); Claude-written scenarios do not always match weekdays, producing scenario gaps a person must judge; live Claude on /try is not built; the Hindi interface covers headings and main actions only.

**What comes next.** More business types, payment collection, the daily cutoff and live Claude on /try. Contact: hello@agentdoor.shop.
