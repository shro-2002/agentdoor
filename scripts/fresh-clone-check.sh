#!/usr/bin/env bash
# SUB-2: proves the repository works from a clean clone.
#   1. clones HEAD (committed files only; commit first) into a temp directory
#   2. npm ci
#   3. starts its OWN MySQL: docker compose project "agentdoor-fresh" on a free host port
#   4. npm test and npm run e2e against that database
#   5. removes the temp directory and brings down only the "agentdoor-fresh" project
# It never touches other containers or the main project's database on 3307.
set -euo pipefail

PROJECT="agentdoor-fresh"
MAIN_DB_PORT=3307
E2E_PORT="${AGENTDOOR_FRESH_E2E_PORT:-4398}" # the default e2e port 4399 may be in use by a working session
SOURCE="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/agentdoor-fresh.XXXXXX")"
COMPOSE_STARTED=0

cleanup() {
  status=$?
  if [ "$COMPOSE_STARTED" = 1 ]; then
    # -p scopes this to our own project; -v drops only its volume.
    docker compose -p "$PROJECT" -f "$WORK/repo/docker-compose.yml" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
  if [ "$status" = 0 ]; then echo "fresh-clone-check: PASSED"; else echo "fresh-clone-check: FAILED (exit $status)"; fi
}
trap cleanup EXIT

free_port() {
  node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'
}

DB_PORT="${AGENTDOOR_FRESH_DB_PORT:-$(free_port)}"
if [ "$DB_PORT" = "$MAIN_DB_PORT" ]; then echo "refusing to use the main project's port $MAIN_DB_PORT" >&2; exit 2; fi

echo "== clone HEAD ($(git -C "$SOURCE" rev-parse --short HEAD)) into $WORK/repo"
git clone --quiet "$SOURCE" "$WORK/repo"
cd "$WORK/repo"

echo "== npm ci"
npm ci --no-audit --no-fund

echo "== MySQL (project $PROJECT, host port $DB_PORT)"
COMPOSE_STARTED=1
AGENTDOOR_DB_PORT="$DB_PORT" docker compose -p "$PROJECT" up -d --wait mysql

export DB_HOST=127.0.0.1
export DB_PORT
echo "== npm test"
npm test

echo "== npm run e2e (port $E2E_PORT)"
AGENTDOOR_E2E_PORT="$E2E_PORT" npm run e2e
