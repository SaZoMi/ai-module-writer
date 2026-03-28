#!/usr/bin/env bash
# Authenticate with the Takaro API and cache the token.
# Reads: TAKARO_HOST, TAKARO_USERNAME, TAKARO_PASSWORD from env or .env
# Writes: /tmp/takaro-token
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source .env if vars aren't already set
if [[ -z "${TAKARO_HOST:-}" || -z "${TAKARO_USERNAME:-}" || -z "${TAKARO_PASSWORD:-}" ]]; then
  if [[ -f "$REPO_DIR/.env" ]]; then
    set -a
    source "$REPO_DIR/.env"
    set +a
  else
    echo "ERROR: Missing TAKARO_HOST, TAKARO_USERNAME, or TAKARO_PASSWORD and no .env found" >&2
    exit 1
  fi
fi

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${TAKARO_HOST}/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${TAKARO_USERNAME}\",\"password\":\"${TAKARO_PASSWORD}\"}")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "ERROR: Login failed (HTTP $HTTP_CODE)" >&2
  echo "$BODY" >&2
  exit 1
fi

TOKEN=$(echo "$BODY" | jq -r '.data.token // empty')
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: No token in response" >&2
  echo "$BODY" >&2
  exit 1
fi

echo "$TOKEN" > /tmp/takaro-token
echo "Authenticated successfully. Token cached at /tmp/takaro-token"
