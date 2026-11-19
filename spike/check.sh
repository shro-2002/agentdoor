#!/usr/bin/env bash
# Usage: spike/check.sh https://<public-url>   (no trailing slash)
set -u
BASE="${1:?base url}"
H=(-H 'content-type: application/json' -H 'accept: application/json, text/event-stream')
step() { printf '\n== %s\n' "$1"; }
step healthz;  curl -sS -w '\nHTTP %{http_code} %{time_total}s\n' "$BASE/healthz"
step ip;       curl -sS "$BASE/spike/ip"; echo
step env;      curl -sS "$BASE/spike/env"; echo
step db;       curl -sS "$BASE/spike/db"; echo
step mcp-init
curl -sS "${H[@]}" -X POST "$BASE/mcp" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}'; echo
step mcp-tools
curl -sS "${H[@]}" -X POST "$BASE/mcp" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'; echo
step mcp-ping
curl -sS "${H[@]}" -X POST "$BASE/mcp" -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"ping","arguments":{}}}'; echo
step sse-timing
curl -sSN "$BASE/spike/sse" | while IFS= read -r l; do [ -n "$l" ] && printf '%s  t=%s\n' "$l" "$(date +%s)"; done
echo
echo "(mail is manual: curl -X POST $BASE/spike/mail)"
