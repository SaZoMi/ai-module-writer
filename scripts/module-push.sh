#!/usr/bin/env bash
# Push a local module to Takaro via the import API.
# Usage: ./module-push.sh <module-dir>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="${1:?Usage: module-push.sh <module-dir>}"

if [[ ! -d "$MODULE_DIR" ]]; then
  echo "ERROR: $MODULE_DIR is not a directory" >&2
  exit 1
fi

MODULE_NAME=$(jq -r .name "${MODULE_DIR}/module.json")
echo "Pushing module '$MODULE_NAME' to Takaro..." >&2

# Convert to JSON file (avoids shell interpolation issues with template literals)
TEMP_FILE=$(mktemp /tmp/takaro-push-XXXXXX.json)
trap 'rm -f "$TEMP_FILE"' EXIT
node "$SCRIPT_DIR/../dist/scripts/module-to-json.js" "$MODULE_DIR" "$TEMP_FILE"

# Check if a module with this name already exists; if so, delete it first
# Use exact-match filter to avoid matching modules that merely contain the name as a substring
SEARCH_RESULT=$(bash "$SCRIPT_DIR/takaro-api.sh" POST /module/search "$(jq -n --arg name "$MODULE_NAME" '{"filters":{"name":[$name]}}')")
EXISTING_ID=$(echo "$SEARCH_RESULT" | jq -r --arg name "$MODULE_NAME" '[.data[] | select(.name == $name)][0].id // empty')

if [[ -n "$EXISTING_ID" ]]; then
  echo "Module '$MODULE_NAME' already exists (id: $EXISTING_ID), deleting before re-import..." >&2
  # NOTE: Delete then re-import is non-atomic. If import fails after delete, module is lost.
  # WARNING will be printed below if that happens.
  bash "$SCRIPT_DIR/takaro-api.sh" DELETE "/module/$EXISTING_ID" '{}' >/dev/null
  echo "Deleted existing module $EXISTING_ID" >&2
fi

# Import the module
IMPORT_RESULT=$(bash "$SCRIPT_DIR/takaro-api.sh" POST /module/import "@$TEMP_FILE") || {
  if [[ -n "$EXISTING_ID" ]]; then
    echo "WARNING: Module '$MODULE_NAME' was deleted (id: $EXISTING_ID) but re-import failed. Module may need manual re-push." >&2
  else
    echo "ERROR: Import of '$MODULE_NAME' failed." >&2
  fi
  exit 1
}

IMPORTED_NAME=$(echo "$IMPORT_RESULT" | jq -r '.data.name // empty')
IMPORTED_ID=$(echo "$IMPORT_RESULT" | jq -r '.data.id // empty')
if [[ -n "$IMPORTED_ID" ]]; then
  echo "Successfully imported module '$IMPORTED_NAME' (id: $IMPORTED_ID)" >&2
else
  echo "Import completed (could not parse module id from response)" >&2
fi
echo "$IMPORT_RESULT"
