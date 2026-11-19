# T01 spike results (complete except two owner confirmations, see "Still open")

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
- One app only (`NODEJS-jf133lqfzu`), confirmed after every step.

## Still open (owner input)
1. Phone-hotspot `/spike/ip` JSON (second network sample; expected to match the one-hop pattern above).
2. Confirm a mail from the test POSTs arrived in hello@agentdoor.shop.
3. gddy 0.2.38 is available; not installed (needs owner consent).

## Resumed 2026-11-19 (after T00 purchases)
| Step | Result |
|---|---|
| `hosting subscription attach --app-id <id> --subscription-id <sub>` | ACTIVE immediately |
| `scripts/set-secrets.mjs PREVIEW` / `PUBLISH` | needed `-H "Content-Type: application/json-patch+json"` (plain JSON → 400 VALIDATION_FAILED); script fixed; both variants set, response lists names only |
| `deployment publish` #1 | FAILED after ~123 s, "Health check failed after restart" although app listened; cause assumed: probe hits `/` (spike had no route) |
| Fix: added `GET /`, re-upload (import ~10 s), `deployment publish` #2 | COMPLETED in 13 s |
| Public URL (PREFIX) | https://jf133lqfzu.c37.airoapp.ai |
| check.sh public | healthz 200 (0.73 s), `DB_*` all present, MySQL 8.4.8-8 `max_connections` 200, FOR UPDATE txn ok, MCP init/tools/call OK via CDN (curl), SSE ticks 1 s apart (streaming not buffered) |
| Proxy (laptop only so far) | remoteAddress `127.0.0.1`; `X-Forwarded-For` = single client IP (1 hop); `CF-Connecting-IP` = client IP; no X-Real-IP/Forwarded. Phone-hotspot sample pending |
| `claude mcp add --transport http spike <url>/mcp` | `claude mcp list` → ✔ Connected (Claude Code → CDN → MCP works) |
| `hosting domain attach --app-id <id> --hostname agentdoor.shop` | domainType CUSTOM, `verificationStatus` PENDING (polled ~2 min, unchanged). Needs A → anycastIp `160.153.0.104` and `_acme-challenge` CNAME → `agentdoor.shop.<hash>.dcv.cloudflare.com` (value in `domain get`). Nameservers are GoDaddy (domaincontrol.com); apex A currently parking IPs |
| `hosting app list --app-type NODEJS` | 1 app |
| Claude.ai custom connector (no auth) | added by owner, connected, `ping` → "pong" |
| `POST /spike/mail` | `{"ok":true,"messageId":...}` (gateway accepted); inbox delivery pending owner confirmation |
| `app restart --variant PUBLISH` | healthz 200 within 5 s; DB rows intact (3 rows) |
| Redeploy: `source upload` (11 s) + `deployment publish` | COMPLETED, 125 s total wall time (full install/build); DB rows intact (4 rows) |
| `app list --app-type NODEJS` | 1 app |
| Custom domain (after owner set DNS) | `domain list` → `verificationStatus: ACTIVE`. A → `160.153.0.104`, `_acme-challenge` CNAME present |
| HTTPS on https://agentdoor.shop | healthz 200 in 0.75 s, HTTP/2, cert Google Trust Services (WE1), SANs `agentdoor.shop` + `*.agentdoor.shop`, valid 2026-11-18 → 2027-02-16; `http://` → 301 to https; `www` resolves and returns 200 |
| check.sh on custom domain | healthz, `DB_*`, MySQL txn (5 rows), MCP init/tools/ping, SSE 1 s ticks: all OK, same as PREFIX URL |
| Proxy, spoof test (laptop) | `X-Forwarded-For` sent as `1.2.3.4, 9.9.9.9` arrives as `1.2.3.4, 9.9.9.9,<real ip>`: the CDN **appends** the real IP last and keeps client values. A spoofed `CF-Connecting-IP` is rejected by the edge (`error code: 1000`), so the genuine value is unforgeable. |
| `POST /spike/mail` via custom domain | `{"ok":true,"messageId":...}` at 2026-11-19T03:35:53Z (09:05 IST). Inbox delivery awaiting owner confirmation |
