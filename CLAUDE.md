# Takaro AI Module Writer

This repository is a development environment for creating and testing Takaro modules using AI.

**Takaro Docs**: https://docs.takaro.io

## Quick Start

```bash
# Copy .env.example to .env and fill in your credentials
cp .env.example .env

# Start the Minecraft server and bot service
docker compose up -d paper bot

# Authenticate with the Takaro API
bash scripts/takaro-auth.sh
```

## Module Development

All module development work is handled by the `takaro-module-dev` skill. This skill covers research, design, implementation, testing, and debugging of Takaro modules.

Module code lives locally in `modules/` as editable files, then gets pushed to Takaro for testing via `scripts/module-push.sh`. Use `scripts/module-pull.sh` to pull existing modules down for editing.

## Available Tools

- **`scripts/takaro-auth.sh`** — Authenticate with the Takaro API
- **`scripts/takaro-api.sh`** — Curl wrapper for Takaro API calls with auto-auth (supports `@file` for large bodies)
- **`scripts/module-push.sh`** — Push a local module to Takaro (`module-push.sh modules/<name>`)
- **`scripts/module-pull.sh`** — Pull a module from Takaro to local files (`module-pull.sh <name-or-id>`)
- **`scripts/module-to-json.js`** — Convert local module dir to Takaro import JSON
- **`scripts/json-to-module.js`** — Convert Takaro export JSON to local module dir
- **`scripts/download-plugin.sh`** — Download the Takaro Minecraft plugin
- **Bot service** (port 3101) — Create and control Minecraft bots for testing
- **RCON** — `docker compose exec paper rcon-cli <command>`
