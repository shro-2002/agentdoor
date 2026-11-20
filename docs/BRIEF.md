Judges: start at https://agentdoor.shop/launch, the live AgentDoor workspace (no access code). The approved storefront is https://agentdoor.shop and the MCP endpoint is https://agentdoor.shop/mcp. Demo video (2:50): https://youtu.be/ES2aL0BVhkI.

**AgentDoor: rehearse your business against tough customers before your first order.** Other tools build you a website. AgentDoor makes sure the business behind it survives its first customers: its rules are rehearsed, enforced in code and signed before anyone can order.

**Problem and who benefits.** A home baker takes orders over WhatsApp, quotes from memory and over-commits. Customers' AI assistants will soon order for them, and unenforced rules lose money faster. Small food sellers benefit most.

**What it does.** At /launch anyone describes their own bakery in English, Hindi or Hinglish. Claude asks clarifying questions live. They edit products and rules, run the rehearsal, fix issues in place, rerun the free checks and open a private preview of their storefront. Early access is for home bakeries only, and publishing a preview to a live domain is not self-serve: the one live shop, Meera's Kitchen, was deployed by AgentDoor's scripted GoDaddy deploy. Drafts are private to their browser; previews are read-only.

**What is novel.**
- Rehearsal: probes plus Claude-written customer scenarios try to break the rules before launch. Results come in four categories, never summed: business-policy gaps, pending approvals, scenario mismatches, engine failures.
- Your busiest day: 50 festival-rush orders run against the draft's own rules with the live shop's booking rule, showing accepted, refused by reason, revenue and "Oversold: 0" (no model calls, no real orders).
- Money at stake: each issue shows the rupees involved, taken only from engine quotes of concrete orders; fixed issues count as protected.
- Provenance: stated rules carry the owner's words; defaults are labelled as AgentDoor's suggestion. Readiness means decisions made and customer cases survived, not fields filled in.
- No model in the price path: deterministic code, Ed25519-signed expiring quotes and atomic MySQL capacity, so an AI shopper cannot talk the price down or oversell a day.
- Trust: a "Rehearsed before launch" badge links to /how-we-work (rules in plain words, owner quotes, signed policy fingerprint), also published for AI shoppers in /.well-known/agentdoor.json.

**How Claude is used.** claude-sonnet-5-5 with structured output, live calls only: compile (description to schema-validated policy with provenance), clarify (questions in the owner's language) and scenarios (customer cases for the rehearsal). Storefront, ordering, quotes, MCP and owner pages make zero model calls; a test enforces that only the workspace module may use the Claude client.

**How GoDaddy is used.** Node.js Hosting (one app, redeployed), managed MySQL, the agentdoor.shop domain with HTTPS via the platform CDN, and a Titan mailbox with the mail gateway for the contact form. A preview is not a deployment: publishing needs the owner's authorization and runs through the GoDaddy deploy, so credentials never live on the server.

**Measured results** (19 Nov 2026, production).
- Each Claude step takes about 15 to 19 s; model cost is $0.03 to $0.10 per call, roughly $0.10 to $0.20 per business setup.
- Two unseen live journeys, each ending in a preview (gaps / pending / mismatches / engine failures): English, Kolkata cakes, pickup only, 2 / 15 / 2 / 0; Hinglish, Delhi gift boxes, questions asked in Hinglish, 0 / 18 / 3 / 0.
- Recorded Meera launch: first run 2 / 28 / 1 / 0, final 0 open. The two policy gaps were the omissions planted in the Hinglish description (no daily limit, no rule for unlisted areas); both were caught before launch.
- Busy day, live on a new Kolkata bakery limited to 4 cakes a day: 2 of 50 orders accepted (₹3,800), the rest refused with reasons, oversold 0.
- 608 unit and integration and 67 end-to-end tests pass; zero serious or critical accessibility issues; 20 concurrent orders oversell zero.

**Spend controls.** $10 global runtime cap, $0.60 and 3 setup rounds per business, 2 scenario runs, 6 new businesses per network hourly. At a cap the workspace says so; free checks keep working.

**Reviews.** An independent three-reviewer security and conformance review of the shop (found no critical issue; its ten fixes are in) and an independent judge-style audit of the submission (its fixes are in).

**Honesty note.** Meera's Kitchen in Pune is an illustrative persona, not a real customer; storefront photos are Pexels-licensed. /launch-report and /try document the first recorded launch, kept as evidence only.

**Limitations.** Home bakeries only. Publishing to a domain is owner-only; others get a preview. Compile occasionally needs one automatic repair; failed jobs retry. Claude's scenarios sometimes miss weekdays, so a person judges mismatches. Unpaid orders hold capacity until declined. The daily cutoff time is not enforced. No online payments.

**What comes next.** Owner one-click publish, payments, more business types. hello@agentdoor.shop.
