#!/usr/bin/env bash
# Fails if tracked or staged-to-be-tracked files contain obvious secret material.
set -u
cd "$(git rev-parse --show-toplevel)"
PATTERN='PRIVATE KEY|sk-ant-|DB_PASSWORD='
# Untracked-but-not-ignored files count too: they are about to be committed.
FILES=$(git ls-files --cached --others --exclude-standard | grep -v -e '^scripts/check-secrets.sh$' -e '^planning/' -e 'package-lock.json$')
HITS=$(printf '%s\n' "$FILES" | xargs grep -nIE "$PATTERN" 2>/dev/null | grep -v 'process\.env\.DB_PASSWORD' | grep -v 'DB_VARS')
if [ -n "$HITS" ]; then
  # Print locations only, never the matching text.
  echo "$HITS" | cut -d: -f1,2 | sed 's/^/secret-like match: /'
  exit 1
fi
echo "check-secrets: clean"
