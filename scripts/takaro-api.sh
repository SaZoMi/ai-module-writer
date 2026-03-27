#!/usr/bin/env bash
# Curl wrapper for Takaro API with automatic auth refresh.
# Usage: ./takaro-api.sh METHOD /path [json-body-or-@file]
# Examples:
#   ./takaro-api.sh GET /gameserver/search '{}'
#   ./takaro-api.sh POST /module/import @/tmp/module.json
#   echo '{}' | ./takaro-api.sh POST /module/search -
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

METHOD="${1:?Usage: takaro-api.sh METHOD /path [json-body-or-@file]}"
PATH_ARG="${2:?Usage: takaro-api.sh METHOD /path [json-body-or-@file]}"
BODY_ARG="${3:-}"

TOKEN_FILE="/tmp/takaro-token"

ensure_token() {
  if [[ ! -f "$TOKEN_FILE" ]]; then
    "$SCRIPT_DIR/takaro-auth.sh" >&2
  fi
}

# If body is "-", read from stdin into a temp file
# If body starts with "@", it's already a file reference for curl
# Otherwise, write to a temp file to avoid shell interpolation issues
BODY_FILE=""
CLEANUP_BODY=""

if [[ "$BODY_ARG" == "-" ]]; then
  BODY_FILE=$(mktemp /tmp/takaro-body-XXXXXX.json)
  CLEANUP_BODY="$BODY_FILE"
  cat > "$BODY_FILE"
elif [[ "$BODY_ARG" == @* ]]; then
  BODY_FILE="${BODY_ARG#@}"
elif [[ -n "$BODY_ARG" ]]; then
  BODY_FILE=$(mktemp /tmp/takaro-body-XXXXXX.json)
  CLEANUP_BODY="$BODY_FILE"
  printf '%s' "$BODY_ARG" > "$BODY_FILE"
fi

cleanup() {
  [[ -n "$CLEANUP_BODY" ]] && rm -f "$CLEANUP_BODY"
}
trap cleanup EXIT

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

  if [[ -n "$BODY_FILE" ]]; then
    args+=(--data-binary "@$BODY_FILE")
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
