#!/usr/bin/env bash
# Curl wrapper for Takaro API with automatic auth refresh.
# Usage: ./takaro-api.sh METHOD /path [json-body]
# Example: ./takaro-api.sh GET /gameserver/search '{}'
# Example: ./takaro-api.sh POST /module/search '{}'
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source .env for TAKARO_HOST and TAKARO_DOMAIN_ID
if [[ -z "${TAKARO_HOST:-}" || -z "${TAKARO_DOMAIN_ID:-}" ]]; then
  if [[ -f "$REPO_DIR/.env" ]]; then
    set -a
    source "$REPO_DIR/.env"
    set +a
  fi
fi

METHOD="${1:?Usage: takaro-api.sh METHOD /path [json-body]}"
PATH_ARG="${2:?Usage: takaro-api.sh METHOD /path [json-body]}"
BODY="${3:-}"

TOKEN_FILE="/tmp/takaro-token"

ensure_token() {
  if [[ ! -f "$TOKEN_FILE" ]]; then
    "$SCRIPT_DIR/takaro-auth.sh" >&2
  fi
}

do_request() {
  local token
  token=$(cat "$TOKEN_FILE")

  local args=(
    -s -w "\n%{http_code}"
    -X "$METHOD"
    -H "Authorization: Bearer $token"
    -H "x-takaro-domain: ${TAKARO_DOMAIN_ID}"
    -H "Content-Type: application/json"
  )

  if [[ -n "$BODY" ]]; then
    args+=(-d "$BODY")
  fi

  curl "${args[@]}" "${TAKARO_HOST}${PATH_ARG}"
}

ensure_token

RESPONSE=$(do_request)
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
RESP_BODY=$(echo "$RESPONSE" | sed '$d')

# Auto-refresh on 401 and retry once
if [[ "$HTTP_CODE" == "401" ]]; then
  echo "Token expired, refreshing..." >&2
  "$SCRIPT_DIR/takaro-auth.sh" >&2
  RESPONSE=$(do_request)
  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  RESP_BODY=$(echo "$RESPONSE" | sed '$d')
fi

if [[ "$HTTP_CODE" -ge 400 ]]; then
  echo "ERROR: HTTP $HTTP_CODE" >&2
  echo "$RESP_BODY" | jq . 2>/dev/null || echo "$RESP_BODY" >&2
  exit 1
fi

echo "$RESP_BODY" | jq . 2>/dev/null || echo "$RESP_BODY"
