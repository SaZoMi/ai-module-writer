#!/usr/bin/env bash
# Pull a module from Takaro and create/update the local file structure.
# Usage: ./module-pull.sh <module-id-or-name> [output-dir]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODULE_REF="${1:?Usage: module-pull.sh <module-id-or-name> [output-dir]}"
OUTPUT_DIR="${2:-}"

# Check if the reference is a UUID or a name
if [[ "$MODULE_REF" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  MODULE_ID="$MODULE_REF"
else
  SEARCH_RESULT=$(bash "$SCRIPT_DIR/takaro-api.sh" POST /module/search "{\"filters\":{\"name\":[\"$MODULE_REF\"]}}" 2>&1)
  MODULE_ID=$(echo "$SEARCH_RESULT" | jq -r '.data[0].id // empty')
  if [[ -z "$MODULE_ID" ]]; then
    echo "ERROR: Module '$MODULE_REF' not found" >&2
    exit 1
  fi
fi

echo "Exporting module $MODULE_ID from Takaro..." >&2

EXPORT_JSON=$(bash "$SCRIPT_DIR/takaro-api.sh" POST "/module/$MODULE_ID/export" '{}' 2>&1)

TEMP_FILE=$(mktemp /tmp/takaro-export-XXXXXX.json)
trap 'rm -f "$TEMP_FILE"' EXIT
echo "$EXPORT_JSON" > "$TEMP_FILE"

if [[ -n "$OUTPUT_DIR" ]]; then
  node "$SCRIPT_DIR/json-to-module.js" "$TEMP_FILE" "$OUTPUT_DIR"
else
  node "$SCRIPT_DIR/json-to-module.js" "$TEMP_FILE"
fi
