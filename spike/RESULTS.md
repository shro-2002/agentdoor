# T01 spike results (complete)

## Done (2026-11-18, gddy 0.2.37)
| Step | Command | Result / timing |
|---|---|---|
| Pre-check | `hosting app list --app-type NODEJS`, `subscription list`, `domain list`, `email list` | all empty; `totalAvailableSlots: 0` |
| Create app | `hosting app create --app-type NODEJS --name agentdoor-shop` | async op, `data.operationId`, COMPLETED on first poll (~10 s); id at `data.app.id` of `operation get` |
| Upload | `hosting source upload --app-id <id> --file spike.zip` | `data.importId`, IN_PROGRESS → COMPLETED in ~10 s |
| App URLs | `hosting app get` | `data.urls.preview` (host.godaddy.com dashboard link), `data.urls.publish` (PREFIX hostname `*.airoapp.ai`) |
| Subscription | `hosting subscription get --app-id` | error `SUBSCRIPTION_NOT_ATTACHED` (404) |
| Local spike check | `spike/check.sh http://127.0.0.1:4999` | healthz, ip, env, MCP init/tools/ping, SSE all OK (DB endpoints need DB_*) |

## Notes
- gddy prints update notices on stderr/stdout preamble; parse JSON only from stdout (use `2>/dev/null`).
- `email.md` ships only a TS helper; `spike/email.js` is that file with type annotations stripped, nothing else changed.
- `scripts/set-secrets.mjs` written, untested against the live API (needs `.agentdoor/secrets/<variant>.json`).

## Conclusions
- **`trust proxy` = 1.** Rate-limit key = `req.ip` (rightmost XFF entry, appended by the edge). Do not use the leftmost XFF entry. `CF-Connecting-IP` is an acceptable alternative key.
- Publish health probe hits `/`; every app version must serve `GET /` with 200 or publish fails after ~2 min.
- Secrets need `Content-Type: application/json-patch+json` and are set per variant.
- Redeploy wall time ≈ 125 s (install + build); restart ≈ 5 s; MySQL data survives both.
- One app only (`<app-id>`), confirmed after every step.

## Owner confirmations (2026-11-19, from screenshots)
- Phone on mobile data, PREFIX URL `/spike/ip`: `remoteAddress` `::ffff:127.0.0.1`, `xForwardedFor` and `cfConnectingIp` both one IP (different from the laptop), no X-Real-IP/Forwarded/Via. Same one-hop pattern on two networks, so `trust proxy = 1` is confirmed.
- Inbound mail: a Gmail message to hello@agentdoor.shop arrived in the Titan inbox at 9:09 am IST. The GoDaddy `secureserver.net` MX records deliver to the mailbox; no DNS change needed.

- App-sent mail: both `POST /spike/mail` messages (12:46 am and 9:05 am IST) arrived in the hello@agentdoor.shop inbox (not spam), subject and body as sent. Sender display name is the app host id (`jf133lqfzu`), so the contact form should set an explicit, readable subject/name in the body.

## Still open
- gddy 0.2.38 is available; not installed (needs owner consent).
