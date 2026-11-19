# Demo script (3 minutes, live)

Flow: the judge-facing live workspace at https://agentdoor.shop/launch, then the approved storefront (Meera's Kitchen, "Illustrative persona based on common home-bakery practices") and an order through Claude.ai over MCP.

Note: each workspace step waits about 15 to 20 seconds for Claude (compile 18.5 to 19.1 s, clarify 15 to 19 s, rehearsal 18.8 to 19.0 s on production). Cut the waits in editing, or narrate over them. Say that the waits are real model calls.

## Pre-flight checklist

- [ ] https://agentdoor.shop/launch loads and the composer accepts a description (workspace open; spend caps not reached, so Claude calls work).
- [ ] https://agentdoor.shop, /order and https://agentdoor.shop/mcp answer.
- [ ] Use a fresh browser profile or a private window: drafts are private to the browser that made them.
- [ ] Claude.ai: custom connector added with URL https://agentdoor.shop/mcp, and a test chat already succeeded.
- [ ] Owner dashboard login works in a second tab; mailbox hello@agentdoor.shop open in a third.
- [ ] Notifications off, window 1440x900, browser zoom 100 percent, network checked. A phone-width view ready (browser device mode).
- [ ] Re-check the demo date with a get_quote call before recording: lines [{itemId "eggless-vanilla-cake", qty 1, optionIds []}], fulfilment {kind "delivery", area "Hinjewadi"}, date YYYY-MM-DD at least 3 days ahead and not a Monday. Expected: quote Rs 800 (650 plus 150 delivery). If the date is refused, choose a later non-Monday date and use it everywhere below. Do not use a Saturday or Sunday when recording on a Friday afternoon (the 48-hour lead time refuses them), and do not use a variant spelling of the area (it is refused with AREA_NOT_SERVED).
- [ ] Clean state: no leftover pending orders you do not want shown.

## The prompt

Click the Hinglish example on /launch, or paste exactly:

```
Main Bengaluru ke HSR Layout se ghar par custom cakes aur cupcakes banati hoon. Chocolate truffle cake ₹750 per kg, eggless red velvet ₹850 per kg, cupcake box (6 pieces) ₹420. Delivery HSR Layout, Koramangala aur BTM Layout mein karti hoon, ₹80 charge. Pickup bhi chalega. Normally 2 din pehle order chahiye, lekin urgent order ho toh ₹250 extra leke kal tak de deti hoon. Monday ko band rehta hai.
```

## Timeline

| Time | Beat | On screen, exact steps | Say |
|---|---|---|---|
| 0:00-0:15 | Problem | Slide or chat mock: "Kal 25 cakes milenge? Delivery, 4000 tak". | "Home bakers lose money on rush orders and over-commit. Soon AI assistants will order for customers. Will her business be ready?" |
| 0:15-0:45 | Describe | Open /launch, click the Hinglish example (or paste the prompt), submit. Answer Claude's Hinglish questions. For the daily-capacity question type "Pata nahi, baad mein decide karungi" to keep a decision open. | "She describes her bakery in her own words, in Hinglish. Claude asks only what is missing, in her language. I leave capacity open on purpose." |
| 0:45-1:10 | Rules | Rules step: show the "You said" quotes and the "AgentDoor suggested this" label; approve what she said. | "Rules she stated carry her exact words. Anything suggested is labelled: the owner did not say it." |
| 1:10-1:50 | Rehearse | Rehearse step: run it. Show the four categories (business-policy gaps, pending approvals, scenario mismatches, engine failures), never summed. Fix the capacity with Set limit, choose Refuse for other areas, click Run checks again (free, instant). | "AgentDoor attacks her rules with probes and Claude-written tricky customers. Four separate counts: missing decisions, rules awaiting her, scenarios that differ from what she would want, and real engine failures. She fixes in place and the free checks rerun." |
| 1:50-2:10 | Storefront | Storefront step: open the preview at desktop width, then at phone width. | "A preview of her own storefront. A preview is not a deployment: publishing to a real domain needs the owner's authorization." |
| 2:10-2:50 | Customer agent | Switch to https://agentdoor.shop (Meera's Kitchen). In Claude.ai with the connector https://agentdoor.shop/mcp: "Order an eggless vanilla cake for Tuesday 24 Nov to Hinjewadi, under 900 rupees" (use the date confirmed in pre-flight). Show the signed quote Rs 800 (650 plus 150 delivery), a haggle attempt and the refusal, then place_order: PENDING_OWNER with a status link. Show the owner dashboard: order pending. | "A customer's AI orders through MCP. Prices are code, not conversation: it cannot haggle a discount and cannot overbook her. The order waits for her confirmation." |
| 2:50-3:00 | Close | Back to the workspace tab. | "Describe it, rehearse it, preview it, and then let AI assistants order. AgentDoor: the first mile into agentic commerce." |

If time is short, drop the phone-width preview and the haggle attempt first.

## Fallback plan

- A Claude step is slow or fails: say so in one sentence and use the retry button (a failed job is retryable). If a spend cap is reached the workspace says so; the free checks still work, so continue from an existing draft.
- Connector or Claude.ai fails: say so, then show the quote and order through https://agentdoor.shop/order and the owner dashboard.
- Network fails entirely: play the recorded video.
- Contact email late: show the earlier message already in the mailbox and the accepted-form confirmation on /contact.
- Technical documentation of the first recorded launch is at /launch-report and /try (evidence only); label anything recorded as recorded.

## Reference numbers (19 Nov 2026, production)

Timings: compile 18.5 to 19.1 s; one clarify round 15 to 19 s; rehearsal 18.8 to 19.0 s. Model cost per call (local smoke runs): compile $0.035 to $0.097, clarify $0.031 to $0.046, scenarios $0.027 to $0.034; a full setup is roughly $0.10 to $0.20. Rehearsal categories are reported separately (gaps / pending approvals / mismatches / engine failures): English Kolkata journey 2 / 15 / 2 / 0; Hinglish Delhi journey 0 / 18 / 3 / 0; recorded Meera launch first run 2 / 28 / 1 / 0, final 0 open. Claude-written scenarios do not always match weekdays; a person judges those mismatches.
