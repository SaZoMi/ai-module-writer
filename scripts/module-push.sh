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

MODULE_NAME=$(node -e "console.log(require('./${MODULE_DIR}/module.json').name)")
echo "Pushing module '$MODULE_NAME' to Takaro..." >&2

# Convert to JSON file (avoids shell interpolation issues with template literals)
TEMP_FILE=$(mktemp /tmp/takaro-push-XXXXXX.json)
trap 'rm -f "$TEMP_FILE"' EXIT
node "$SCRIPT_DIR/module-to-json.js" "$MODULE_DIR" "$TEMP_FILE"

# Import into Takaro using @file syntax
bash "$SCRIPT_DIR/takaro-api.sh" POST /module/import "@$TEMP_FILE"
