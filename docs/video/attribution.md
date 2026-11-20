# AgentDoor demo video: asset attribution and provenance

## Footage (all real, recorded 20 Nov 2026)
- Live workspace https://agentdoor.shop/launch: a fresh business ("Home Baker HSR Layout", Bengaluru), created on camera with live Claude calls (claude-sonnet-5-5). Recorded with Playwright at 1920x1080. Three Claude waits were shortened in the edit; each cut shows an on-screen chip with the real measured time (34 s, 21 s, 18 s).
- The busy-day simulations are labelled simulations by the app ("A simulation using your rules. No real orders were placed."). The two runs use different simulated orders: the seed includes the policy hash, which changes when the limit changes.
- Live storefront https://agentdoor.shop (Meera's Kitchen, an illustrative persona) and /how-we-work.
- Claude.ai conversation using the custom connector https://agentdoor.shop/mcp, captured as screenshots from Chrome. It placed one real order on the live shop (demo customer details: "Demo Customer", 9876543210), which is pending the owner. Screenshot of the owner dashboard, cropped to the orders area.
- The placeholder capacity seen in the footage (10 units a day) is AgentDoor's default, filled in when the owner gave no number.

## Images
- Pexels license (free to use, attribution not required), from the repository's apps/shop/public/photos:
  - kitchen-flour-hands.jpg, https://www.pexels.com/photo/4048421/ (hook)
  - eggless-vanilla-cake.jpg, https://www.pexels.com/photo/4110001/ (Polina Tankilevitch) (close)
  - Storefront photos visible in screen recordings: see apps/shop/public/photos/CREDITS.md
- Chat messages in the hook are illustrative (labelled on screen).

## Audio
- Narration: ElevenLabs text-to-speech, account of the team, voice UM3TOcm5kcELI84GFoAz, model eleven_multilingual_v2.
- Music: ElevenLabs Music (music_v2), instrumental, generated for this video (40 s track, crossfade-looped), ducked under narration. Mix normalized to -16 LUFS.

## Fonts and software
- Inter (SIL Open Font License); Iowan Old Style (macOS system font) for headlines.
- Pipeline: Ultrademo (Apache-2.0: Playwright capture, Remotion render), FFmpeg.

## Facts shown and their sources (checked 20 Nov 2026)
- "583 tests passing, unit and integration": `npm test`, 62 files, 583 tests, run 20 Nov 2026.
- "20 orders at once, 0 oversold": concurrency test C-CAP-1 in the test suite (README, Testing).
- Badge "Rehearsed before launch · 49 checks · rules approved by the owner" and fingerprint c07d234a7bfc: live pages.
- Quote ₹800 (₹650 + ₹150 delivery) for an eggless vanilla cake, Hinjewadi, Tue 24 Nov: live get_quote.
