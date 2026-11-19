# Demo script (3 minutes, live, with recorded backup)

Persona on screen: Meera's Kitchen, Pune, "Illustrative persona based on common home-bakery practices". Numbers below were measured on 19 Nov 2026 in the real run.

## Pre-flight checklist

- [ ] Launcher running locally in the mode used for the recorded session (`npm run launcher`, http://127.0.0.1:4321); seeded Hinglish transcript ready to paste.
- [ ] For a live Claude run: `.env.local` present with the key and `AGENTDOOR_LLM_MODE=live`. Otherwise run in fixture mode and say so.
- [ ] gddy CLI logged in. Deploy needs `--live` plus the documented confirmation variable; confirm it works in a dry check before going on stage.
- [ ] https://agentdoor.shop loads, /try and /launch-report load, `https://agentdoor.shop/mcp` answers.
- [ ] Claude.ai: custom connector added with URL https://agentdoor.shop/mcp, and a test chat already succeeded.
- [ ] Owner dashboard login works in a second tab; mailbox hello@agentdoor.shop open in a third.
- [ ] Recorded backup video open, paused at the segment starts; /try open in a tab.
- [ ] Notifications off, window 1440x900, browser zoom 100 percent, network checked.
- [ ] Clean state: no leftover pending orders you do not want shown.

## Timeline

| Time | Beat | On screen, exact steps | Say |
|---|---|---|---|
| 0:00-0:15 | Problem | Slide or chat mock: "Kal 25 cakes milenge? Wakad delivery, 4000 tak". | "Home bakers lose money on rush orders and over-commit. Soon AI assistants will order for customers. Will her business be ready?" |
| 0:15-0:40 | Describe | Launcher L1: paste the Hinglish description, submit; answer the inline questions. | "She describes her bakery in her own words. Claude asks only what is missing." |
| 0:40-1:05 | Rules with evidence | L2: open two rule cards, point at "You said" quotes, approve the rules. | "Every rule carries her exact words. Nothing she did not say gets in." |
| 1:05-1:45 | Rehearsal | L3: run the rehearsal; the receipt prints; point at the 12 critical gaps; apply typed fixes; re-run until 0 critical; the door unlocks. | "Before any customer arrives, AgentDoor attacks her rules with 40 probes and 10 tricky customers. It found 12 critical gaps. Launch stays locked until she fixes them, and now it is open." |
| 1:45-2:05 | Deploy | L4: click launch with the confirmation; the step timeline runs (pack, upload, preview, publish, smoke). | "One action deploys to GoDaddy on her own domain. The whole deploy takes about 26 seconds." |
| 2:05-2:45 | Customer agent | Claude.ai with the connector: "Order an eggless cake for Saturday to Hinjawadi, under 500 rupees." Show the signed quote, a haggle attempt, the refusal, then place_order. Switch to the owner dashboard: order pending. | "A customer's AI orders through MCP. Prices are code, not conversation: it cannot haggle a discount and cannot overbook her. The order waits for her confirmation." |
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

Real launch: 3 Claude calls, $0.1496 total. Rehearsal: 12 critical gaps before fixes, 0 after. Deploy about 26 s (pack 1.2 s, upload 8.7 s, preview restart 5.0 s, publish 6.9 s, smoke 0.9 s).
