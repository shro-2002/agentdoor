# 06 — UI/UX Specification

All product-facing decisions are made here so the implementation agent does not redesign screens. Where this spec is silent, choose the simplest option that matches the tokens below.

## 1. Visual identity: "The Bakery Ledger"

Concept: a warm, editorial **order-book** aesthetic. Cream paper, ink type, saffron accents. Rehearsal results print like **receipt slips**, and the launch gate is a literal **door** that unlocks. The look is trustworthy, Indian-small-business warm, and distinct from SaaS gradients.

### Tokens (`public/tokens.css`, shared by launcher and shop)

```css
:root{
  --paper:#FBF6EE; --paper-2:#F3EADB; --card:#FFFFFF; --ink:#1F1B16; --ink-2:#5C5247; --line:#E4D8C6;
  --saffron:#B45309;  /* accent text/links, 4.8:1 on paper */  --saffron-bg:#FDE7C8;
  --leaf:#2F6B45;     /* pass */ --leaf-bg:#E3F1E7;
  --chili:#B42318;    /* gap / critical */ --chili-bg:#FDE4E1;
  --turmeric:#8A5A00; /* warning */ --turmeric-bg:#FFF1CC;
  --focus:#1D4ED8;    /* focus ring, 3:1+ vs paper and card */
  --radius-s:6px; --radius-m:12px; --radius-l:20px;
  --shadow-1:0 1px 2px rgba(31,27,22,.08); --shadow-2:0 8px 24px rgba(31,27,22,.10);
  --font-display:'Fraunces', Georgia, serif;
  --font-body:'Noto Sans','Noto Sans Devanagari', system-ui, sans-serif;
  --font-mono:ui-monospace,'SF Mono',Menlo,monospace;   /* hashes, receipts */
  --step--1:clamp(.83rem,.8rem+.15vw,.9rem); --step-0:clamp(1rem,.95rem+.25vw,1.1rem);
  --step-1:clamp(1.25rem,1.1rem+.6vw,1.5rem); --step-2:clamp(1.6rem,1.3rem+1.2vw,2.2rem);
  --step-3:clamp(2.2rem,1.6rem+2.5vw,3.6rem);
  --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-5:24px; --space-6:40px; --space-7:64px;
  --dur:180ms; --ease:cubic-bezier(.2,.8,.2,1);
}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
```

- Fonts: Google Fonts link, `display=swap`: Fraunces (600, 700) + Noto Sans (400, 600) + Noto Sans Devanagari (400, 600). Devanagari is required for Hindi. Line-height 1.6 body, 1.15 display.
- Dark mode: the launcher is local and the demo is shot in light, so ship light only and set `color-scheme: light`. (`prefers-color-scheme` support is optional; skip it.)
- Icons: inline SVG, 20 px, `aria-hidden="true"` with text labels. Set: door, lock, check, alert, receipt, globe, clock, truck, rupee.
- Status is never conveyed by color alone. Every status chip has an icon + word (`PASS`, `GAP`, `FAILED`, `NEEDS YOU`).
- Motion: only transforms/opacity. Receipt lines slide in (120 ms stagger); door unlock is a 400 ms rotate of the door panel. Both are disabled under reduced motion.

### Components (build once, reuse)

| Component | Spec |
|---|---|
| `Button` | primary (ink bg, paper text), secondary (outline ink), danger (chili). Min 44×44, radius-s, visible focus ring 3 px `--focus` offset 2 px. Disabled: 50% opacity + `aria-disabled` + reason text nearby |
| `RuleCard` | Left: rule title (bold) + value in big type (e.g. "₹600 / kg"). Under it: "**You said:** “…quote…”" in a quote block with saffron left border; read-back line in owner language. Right: status chip + `Approve` / `Edit`. Low-confidence variant: turmeric border + "Please check" |
| `ReceiptSlip` | Mono font, dashed top/bottom borders (perforation), one line per probe: `✓ PASS  Lead time 47h → refused (needs 48h)`. GAP lines: chili bg, bold, "See fix" link |
| `GapCard` | Title, plain explanation, concrete example ("A customer orders 30 cakes for Saturday — you'd have to bake all night"), 2–4 choice buttons as radio-group, "Apply fix" |
| `DoorGate` | SVG door + lock with count badge ("3 gaps open"). Checklist beside it. When `canLaunch`, the lock opens and the primary "Launch my shop" button enables |
| `StepTimeline` | Vertical steps: icon, label, state (`waiting / running / done / failed`), elapsed time, and on failure an error line + "Retry from here" |
| `StatusChip` | icon + text, bg token per status |
| `Toast / live region` | `aria-live="polite"` region at top of main for async updates |
| `LangSwitch` | segmented control EN / हिंदी / Hinglish; persists in `localStorage` (try/catch) |

### Layout and responsiveness

- Launcher: max width 960 px, 16 px gutters on mobile. Top bar: logo (door glyph + "AgentDoor"), progress stepper (Describe → Rules → Rehearsal → Launch), cost meter (small mono "Claude: $0.12"), LangSwitch.
- Shop: max width 1080 px; mobile-first; single column under 720 px; menu grid 2–3 columns above.
- Breakpoints tested: 320, 375, 768, 1024, 1440. No horizontal scroll.

### Copy voice

Warm, short, second person. Owner language follows LangSwitch, and **all owner-facing strings ship in EN + Hinglish** (Hindi Devanagari for read-backs from Claude plus key headings). Customer-facing shop strings ship in EN with Hindi item names when present. Never say "AI magic"; say what happened ("I found 3 situations your rules don't cover yet").

## 2. Launcher screens (local, `http://127.0.0.1:4321`): four pages (R0-2 cut)

Components come from `packages/ui` so the public replay `/try` (S8) renders the same screens. Each page lists: purpose · layout · actions · states · a11y · data · acceptance.

### L1 Describe (`/`): welcome + description + questions
- **Purpose:** frame the promise and capture the owner's own words (the provenance source); ask the ≤5 questions inline.
- **Layout:** hero line (Fraunces step-3): "Tell me about your bakery. I'll make sure it's ready for customers — people and AI." LangSwitch (EN / हिंदी / Hinglish). Large textarea (min 8 rows, `lang` from LangSwitch, ≤6,000 chars) with prompt chips ("What do you bake?", "Prices?", "How much notice?", "Where do you deliver?", "How many per day?"). After compile, if there are questions, they appear **below on the same page** as cards (fieldset/legend, 2–4 choice chips + "Other"), with `Continue` (one recompile) and `Skip` (defaults stay marked "confirm").
- **Actions:** primary `Read my rules`; secondary `Use the demo bakery` (loads the seeded transcript).
- **States:** API key missing → banner "Demo mode: recorded responses" (replay); compiling: skeleton + "Reading your words…" + elapsed seconds; errors (budget, API, unparseable) inline with retry; empty submit blocked.
- **A11y:** one `h1`; LangSwitch radiogroup with arrow keys; counter announced politely only at 90%/100%.
- **Data:** `POST /api/session`, `/compile`, `/answers`.
- **Acceptance:** Hinglish fixture → compile → questions inline → continue → `/rules`.

### L2 Your rules (`/rules`)
- **Purpose:** owner sees every rule with **her own words as evidence** and approves it.
- **Layout:** sections (Menu & prices · Notice & capacity · Rush orders · Delivery · Order rules), each rule a RuleCard. Sticky footer: "12 of 15 approved" + `Approve all high-confidence` (skips low-confidence and defaults) + primary `Rehearse my shop`.
- **Actions:** per card `Approve`, `Edit` (inline typed editor: ₹ number, hours, weekday chips, area list), `Show source` (highlights the quote in a collapsible transcript panel).
- **States:** default-valued card in turmeric ("AgentDoor suggested this — you didn't say it"); low confidence turmeric "Please check"; edited "Edited by you".
- **A11y:** each card an `article` with heading; approvals announced via live region.
- **Acceptance:** `Rehearse` enabled even with unapproved rules (they show as gaps); the gate requires approval.

### L3 Rehearsal (`/rehearsal`) ★ signature screen (includes gap fixing)
- **Layout:** left: ReceiptSlip printing results grouped "Timing · Capacity · Delivery · Prices · Tricky customers · Fake/altered quotes"; right: counters (PASS · GAP · FAILED) and DoorGate with open-gap count. Below: GapCards (critical first) with the triggering example (probe or Claude scenario `customerMessage`) and 2–4 option buttons → `Apply`; warnings also offer `This is fine`.
- **Actions:** `Apply` (new version, rehearsal stale) → `Run again`; when clean, primary `Go to launch`.
- **States:** running (progress bar with label + aria-valuenow); clean (door unlocks, leaf banner); gaps (chili banner "3 situations need your decision"); FAILED (engine bug: "This is our fault, not yours", blocks).
- **A11y:** receipt is a list; live region announces group completion only.
- **Acceptance:** seeded fixture shows ≥3 GAP lines (NO_CAPACITY_LIMIT, RUSH_UNBOUNDED, UNLISTED_AREA_POLICY); after fixes + re-run, 0 critical.

### L4 Launch (`/launch`): gate + deploy + live
- **Layout:** DoorGate + checklist (rules approved n/n · rehearsal clean on this version · policy fingerprint (mono, copy) · domain · mailbox · "prices can never be negotiated"). Primary `Launch my shop` (enabled only when `canLaunch`; server re-checks → 409 `GATE_BLOCKED`). After click: StepTimeline (Package · GoDaddy app · Upload to preview · Secrets · Publish · Domain/HTTPS · Smoke test · Live) with a redacted log tail. On success: URL card (copy/open), "Let AI assistants order" card (MCP URL + 3-step Claude connector instructions), owner dashboard link + owner token shown **once** with copy button.
- **States:** blocked (reasons as links); deploying 60–180 s; step failure shows the error line + `Run again` (the script is idempotent).
- **Acceptance:** real gddy steps shown; no secret value ever displayed or logged; owner token shown once.

## 3. Shop screens (public, GoDaddy, own domain)

Global: header (bakery name in Fraunces, nav: Menu · Order · Contact · Launch report), persistent top ribbon (R0-1): "**Generated by AgentDoor** · Try the launcher → `/try` · Launch report · Demo video". It's visible on every shop page, including mobile (wraps to two lines). Demo notice in the order form: "Demo shop — please don't enter real phone numbers." Footer: contact, hours, "Prices set by the owner; quotes are signed".

### S1 Storefront home / menu (`/`)
- Hero with bakery name + one line + "Order for {nearest available date}". Menu grid: item cards (name EN + HI, price per unit, dietary chips with text, prep time). "How ordering works" 3 steps. Delivery areas list with fees. Notice & capacity line ("Order at least 48 hours ahead · up to 10 cakes a day").
- Acceptance: content rendered from `bundle/policy.json` only; no hardcoded business data in templates.

### S2 Get a quote & request order (`/order`)
- Form: items (qty steppers), options, date (native `<input type=date>` min/max from policy), pickup/delivery radio, area (select of listed areas + "Other area" text), notes. `Get quote` → quote panel: line items, fees, rush note, total, "Valid until 18:42". Then customer details (name, phone, address if delivery) → `Request order`.
- Refusals: inline reasons in plain text with the rule ("We need 48 hours' notice. The earliest date is Fri 21 Nov").
- Success → S3 (status page link with access token).
- States: quote expired → "This quote expired, get a new one" (no silent re-price).
- A11y: errors linked via `aria-describedby`; qty steppers are buttons with labels; form usable with keyboard only.
- Progressive enhancement: works without JS (POST round-trips); JS adds inline updates.

### S3 Order status (`/orders/:id?t=…`)
- Status chip (Waiting for {owner} to confirm / Confirmed / Declined), order summary, "Save this link". No polling (R0-2 cut); a `Refresh` link.

### S4 Contact (`/contact`) — mandatory deliverable
- Name, email, message, honeypot (visually hidden `website` field, `tabindex=-1`, `aria-hidden`). Success message; generic failure message.

### S5 Launch report (`/launch-report`) ★ judges will click this
- **Purpose:** public proof that this business was rehearsed and its rules are the owner's.
- Layout: title "How {Bakery} was prepared for launch". Summary row: rules approved 15/15 · checks run 44 · gaps found 3 · gaps fixed 3 · launched {date}. Section "The rules" (RuleCards read-only: rule + owner's words + read-back). Section "What the rehearsal caught" (gap timeline: found → owner's decision → version). Section "Verify" (policy fingerprint, public key, link to `/.well-known/agentdoor.json`, one-paragraph explanation of signed quotes). Section "For AI agents" (MCP URL, tool list).
- Privacy: shows the owner's first name only; no customer data.

### S6 (cut, R0-2)
The product explainer moves into S8 `/try` (intro panel) and the README.

### S7 Owner login (`/owner/login`) and dashboard (`/owner`)
- Login: single token field (`type=password`, `autocomplete=off`), rate-limited.
- Dashboard: tabs **Pending** (default, count badge) · Confirmed · All. Order rows: date, items summary, total, channel icon (web / AI agent), customer (name, masked phone revealed on click), notes (escaped), actions `Confirm` / `Decline` (decline asks for confirmation). Side panel: policy fingerprint + "Change rules → rerun AgentDoor launcher". Contact messages tab. (Capacity bars cut, R0-2.)
- A11y: table with `th scope`, action buttons labelled with order id.
- Acceptance: unauthenticated GET → redirect to login; POST without session → 401; cross-origin POST → 403.

### S8 Try AgentDoor (`/try`, `/try/describe|rules|rehearse|launch`) ★ judges' entry to the launcher (mandatory)
- **Purpose:** let anyone experience the Claude-powered launcher from the public URL without a key, account or spend, while making clear what was recorded and what runs live.
- **Persistent nav (sticky, every `/try` page):** Storefront · Launch report · Watch demo · step indicator (Describe → Rules → Rehearsal → Launch).
- **Intro:** problem in 2 lines, the embedded demo video (16:9, `youtube-nocookie`, title attribute, text link fallback), a legend of the three badges, then `Start the replay →`.
- **Provenance badges (component `ProvenanceBadge`, icon + text, never color alone):**
  - `RECORDED · Claude`: saffron outline, quote icon. "Claude's real output, recorded {date} · {model} · {latency} · ${cost}".
  - `LIVE · deterministic`: leaf fill, pulse dot (static under reduced motion). "Computed now by AgentDoor's rule engine — no AI involved".
  - `RECORDED · deployment evidence`: ink outline, server icon. "Real GoDaddy deployment log from {date}" next to the live `/healthz` hash of this shop.
- **Steps:** L1–L4 rendered read-only from `bundle/try/session.json` with `packages/ui`. Each block wears its badge: transcript, questions and rule evidence are RECORDED · Claude; receipt, gap detection, gate checklist and a "try a quote" mini-form (calls the live engine, no order) are LIVE; the deploy timeline is RECORDED · deployment evidence. The final step links to this shop and its MCP URL.
- **States:** session missing → "Replay unavailable" + video; video blocked → text link.
- **A11y:** badges as text; iframe titled; works without JS (each step is a page; mini-form posts).
- **Acceptance:** E2E-5.
- **Optional `/try/live` (stretch, T14):** access-code form → owner-style description box → live compile result with RECORDED/LIVE badges replaced by **LIVE · Claude** (saffron fill) and a visible "$x.xx of $5.00 demo budget used" meter.

## 4. States catalog (applies everywhere)

| State | Pattern |
|---|---|
| Loading > 400 ms | skeleton + elapsed timer for Claude calls |
| Empty | illustration-free sentence + next action ("No orders yet. Share your link →") |
| Error (recoverable) | inline alert, what happened + what to do, retry button |
| Error (fatal) | full-panel message with support code (`requestId`) |
| Not launched (shop) | top banner chili: "This shop isn't taking orders yet" and order form disabled |

## 5. Accessibility checklist (blocking for T10/T11)

WCAG 2.2 AA targets: contrast ≥4.5:1 text (tokens chosen to pass); visible focus on every interactive element; logical heading order; landmarks (`header/nav/main/footer`); form labels; errors announced; `lang` attributes on mixed-language text (`lang="hi"` spans); 44 px targets; reduced motion; no info by color only; keyboard-only completion of L1→L4, S8 and S2. Automated: axe via Playwright on S1, S2, S5, S7, S8, L2, L3 with zero serious/critical violations.

## 6. Demo-critical polish (do these first in UI tasks)

1. L3 receipt animation + door unlock (it's the screenshot judges remember), shared by S8.
2. L2 RuleCard with "You said: …" quotes.
3. S8 `/try` replay and S5 launch report (judges' path from the public URL).
4. L4 step timeline with real GoDaddy steps.
Everything else: clean defaults with tokens; no extra animation.
