Judges: start at https://agentdoor.shop/launch, the live AgentDoor workspace (no access code). The approved storefront is https://agentdoor.shop and the MCP endpoint is https://agentdoor.shop/mcp.

**Problem and who benefits.** A home baker takes orders over WhatsApp, quotes from memory and over-commits. Customers' AI assistants will soon order for them, and unenforced rules lose money faster. Small food sellers benefit most.

**What it does.** At /launch anyone describes their own bakery in English, Hindi or Hinglish. Claude asks clarifying questions live. They edit products and rules, run the rehearsal, fix issues in place, rerun the free checks and open a preview of their storefront. Drafts are private to their browser; previews are read-only.

**What is novel.**
- Rehearsal: probes plus Claude-written customer scenarios try to break the policy before launch.
- Provenance: stated rules carry the owner's quoted words; defaults are labelled "AgentDoor suggested this: the owner did not say it".
- Four rehearsal categories, never summed: business-policy gaps (missing decisions), pending approvals (rules awaiting the owner), scenario mismatches (engine differs from what the owner wants), engine failures (real correctness failures).
- No model in the price path: deterministic code, Ed25519-signed expiring quotes, atomic MySQL capacity.

**How Claude is used.** Model claude-sonnet-5-5, structured output, live calls only, in the workspace and local launcher: compile (description to schema-validated policy with provenance), clarify (questions, in the owner's language) and scenarios (customer cases for the rehearsal). The storefront, ordering, quotes, MCP and owner pages make zero model calls, and a test enforces that only the workspace module may use the Claude client.

**How GoDaddy is used.** Node.js Hosting (one app, redeployed), managed MySQL, the agentdoor.shop domain with HTTPS via the platform CDN, a Titan mailbox and mail gateway for the contact form. A preview is not a deployment: publishing needs the owner's authorization and runs through the GoDaddy deploy, so credentials never live on the server and no visitor can overwrite the live storefront.

**Measured results** (19 Nov 2026, our own measurements, production).
- Timings: compile about 19 s; clarify 15 to 19 s; rehearsal about 19 s.
- Model cost per call (local smoke runs): compile $0.035 to $0.097, clarify $0.031 to $0.046, scenarios $0.027 to $0.034, so a full setup is roughly $0.10 to $0.20.
- Two unseen live journeys, each ending in a preview (gaps / pending / mismatches / engine failures). English, Kolkata cakes, pickup only: 5 questions; rehearsal 2 / 15 / 2 / 0. Hinglish, Delhi gift boxes: asked in Hinglish; 0 / 18 / 3 / 0.
- Recorded Meera launch: first run 2 / 28 / 1 / 0, final 0 open.
- 534 unit and integration and 62 end-to-end tests pass; zero serious or critical accessibility issues on workspace screens; 20 concurrent orders oversell zero.

**Spend controls** (server-side): $10 global cap, $0.60 and 3 setup rounds per business, 2 scenario runs, 2 concurrent Claude jobs, 6 new businesses per network hourly. At a cap the workspace says so; free checks keep working.

**Reviews.** An independent three-reviewer security and conformance review of the shop (found no critical issue; its ten fixes are in) and an independent judge-style audit of the submission (its fixes are in).

**Honesty note.** Meera's Kitchen in Pune is an illustrative persona based on common home-bakery practices, not a real customer. Storefront photos are Pexels-licensed. /launch-report and /try document the first recorded launch, kept as evidence only.

**Limitations.** The workspace covers home bakeries only. Publishing to a domain is owner-only; others get a preview. Compile sometimes needs one automatic repair; failed jobs retry. Claude-written scenarios sometimes miss weekdays, so a person judges the mismatches. Unpaid orders hold capacity until declined. schedule.dailyCutoff is stored but not enforced. Delivery areas must match a listed name or alias. No online payments.

**What comes next.** Owner one-click publish, payments, more business types. hello@agentdoor.shop.
