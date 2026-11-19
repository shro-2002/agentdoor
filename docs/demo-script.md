# Demo script (3 minutes, live, with recorded backup)

Persona on screen: Meera's Kitchen, Pune, "Illustrative persona based on common home-bakery practices". Story: the owner types in Hinglish; the customer asks in Hinglish or English. Numbers below were measured on 19 Nov 2026 in the real run.

## Pre-flight checklist

- [ ] Launcher running locally in the mode used for the recorded session (`npm run launcher`, http://127.0.0.1:4321); seeded Hinglish transcript ready to paste.
- [ ] For a live Claude run: `.env.local` present with the key and `AGENTDOOR_LLM_MODE=live`. Otherwise run in fixture mode and say so.
- [ ] gddy CLI logged in. Deploy needs `--live` plus the documented confirmation variable; confirm it works in a dry check before going on stage.
- [ ] https://agentdoor.shop loads, /try and /launch-report load, `https://agentdoor.shop/mcp` answers.
- [ ] Claude.ai: custom connector added with URL https://agentdoor.shop/mcp, and a test chat already succeeded.
- [ ] Owner dashboard login works in a second tab; mailbox hello@agentdoor.shop open in a third.
- [ ] Recorded backup video open, paused at the segment starts; /try open in a tab.
- [ ] Notifications off, window 1440x900, browser zoom 100 percent, network checked.
- [ ] Re-check the demo date with a get_quote call before recording: lines [{itemId "eggless-vanilla-cake", qty 1, optionIds []}], fulfilment {kind "delivery", area "Hinjewadi"}, date YYYY-MM-DD at least 3 days ahead and not a Monday. Expected: quote Rs 800 (650 plus 150 delivery). If the date is refused, choose a later non-Monday date and use it everywhere below. Do not use a Saturday or Sunday when recording on a Friday afternoon (the 48-hour lead time refuses them), and do not use a variant spelling of the area (it is refused with AREA_NOT_SERVED).
- [ ] Clean state: no leftover pending orders you do not want shown.

## Timeline

| Time | Beat | On screen, exact steps | Say |
|---|---|---|---|
| 0:00-0:15 | Problem | Slide or chat mock: "Kal 25 cakes milenge? Wakad delivery, 4000 tak". | "Home bakers lose money on rush orders and over-commit. Soon AI assistants will order for customers. Will her business be ready?" |
| 0:15-0:40 | Describe | Launcher L1: paste the Hinglish description, submit; answer the inline questions. | "She describes her bakery in her own words. Claude asks only what is missing." |
| 0:40-1:05 | Rules with evidence | L2: open two rule cards, point at "You said" quotes on the rules she stated and at the "AgentDoor suggested this" label on the rest, approve the rules. | "Rules she stated carry her exact words. Anything AgentDoor suggested is labelled: the owner did not say it." |
| 1:05-1:45 | Rehearsal | L3: run the rehearsal; the receipt prints; point at the 10 critical gaps on the first run; approve the rules, apply the three typed fixes (10 units a day, rush capped at 2 a day, unlisted areas refused); accept the 3 remaining scenario gaps as her intent; the final run shows 0 critical and the door unlocks. | "Before any customer arrives, AgentDoor attacks her rules with probes and tricky customers. It found 10 critical gaps on the first run. Launch stays locked until she fixes them, and now it is open." |
| 1:45-2:05 | Deploy | L4: click launch with the confirmation; the step timeline runs (ten steps, from pack to smoke test). | "One action deploys to GoDaddy on her own domain. The whole deploy takes about 30 seconds." |
| 2:05-2:45 | Customer agent | Claude.ai with the connector: "Order an eggless vanilla cake for Tuesday 24 Nov to Hinjewadi, under 900 rupees" (or the same in Hinglish; use the date confirmed in the pre-flight check). Show the signed quote Rs 800 (650 plus 150 delivery), a haggle attempt, the refusal, then place_order: the order shows PENDING_OWNER with a status link. Switch to the owner dashboard: order pending. | "A customer's AI orders through MCP. Prices are code, not conversation: it cannot haggle a discount and cannot overbook her. The order waits for her confirmation." |
| 2:45-3:00 | Proof and close | Open /try and /launch-report briefly; submit the contact form on /contact; switch to the mailbox and show the email. | "Every launch publishes its proof, and judges can replay this exact session at /try. AgentDoor: the first mile into agentic commerce." |

If time is short, drop the second rule card and the haggle attempt first.

## Fallback plan

- Connector or Claude.ai fails: say so in one sentence, play the recorded MCP segment, then open the owner dashboard and show the pending order from the earlier test.
- Network fails entirely: play the recorded video; if even that is unavailable, serve /try from a cached tab and narrate the timeline.
- Live Claude slow or key problem: continue in fixture mode (recorded Claude outputs), and state that the segment is recorded.
- Deploy fails: show the deploy timeline in /try (RECORDED · deployment evidence) and the live site that is already published.
- Contact email late: show the earlier message already in the mailbox and the accepted-form confirmation on /contact.
- Always label what is recorded and what is live. Do not present a recording as live.

## Reference numbers (19 Nov 2026)

Real live Hinglish launch: 3 Claude calls (claude-sonnet-5-5), $0.1467 total (about $0.15). Rehearsal: 10 critical gaps on the first run, 3 after the typed fixes (scenario gaps accepted as the owner's intent), final 0. Deploy of the whole shop: ten steps, 30.3 s (pack 1.2 s, app check 3.1 s, subscription check 1.0 s, upload 8.7 s, secrets (preview) 1.6 s, preview restart 5.0 s, secrets (publish) 1.0 s, publish 6.9 s, domain check 0.9 s, smoke test 0.9 s). Claude-written scenarios do not always match weekdays; a person judges those gaps.
