# Takaro AI Module Writer

This repository is a development environment for creating and testing Takaro modules using AI.

**Takaro Docs**: https://docs.takaro.io

## Quick Start

```bash
# Copy .env.example to .env and fill in your credentials
cp .env.example .env

# Install dependencies
npm install --legacy-peer-deps

# Build TypeScript (required before shell scripts work)
npm run build

# Start services (Minecraft server, bot, and Redis for mock game server)
docker compose up -d paper bot redis

# Authenticate with the Takaro API
bash scripts/takaro-auth.sh
```

## Running Tests

```bash
# Run all automated module tests
npm test
```

Tests use the mock game server to exercise modules in a real Takaro environment. Requires `.env` with valid credentials and `TAKARO_REGISTRATION_TOKEN`.

## In-Game Verification (Mandatory)

Automated tests alone are not sufficient. Every module must also be verified with real bots on the Minecraft Paper server before it is considered done. This is a mandatory verification step — never skip it.

```bash
docker compose up -d paper bot redis
# Create a bot, trigger commands, verify execution events
# See the takaro-module-dev skill for detailed steps
```

**For verification agents**: This repo's "app" is the Minecraft server + Takaro. Use the bot service at `http://localhost:3101` to exercise modules. See `references/bot-api.md` for the API.

## Module Development

All module development work is handled by the `takaro-module-dev` skill. This skill covers research, design, implementation, testing, and debugging of Takaro modules.

Module code lives locally in `modules/` as editable files, then gets pushed to Takaro for testing via `scripts/module-push.sh`. Use `scripts/module-pull.sh` to pull existing modules down for editing.

**Note**: `scripts/module-push.sh` and `scripts/module-pull.sh` call compiled JS from `dist/`. Always run `npm run build` before using these scripts after any changes to `src/`.

## Available Tools

- **`scripts/takaro-auth.sh`** — Authenticate with the Takaro API
- **`scripts/takaro-api.sh`** — Curl wrapper for Takaro API calls with auto-auth (supports `@file` for large bodies)
- **`scripts/module-push.sh`** — Push a local module to Takaro (`module-push.sh modules/<name>`)
- **`scripts/module-pull.sh`** — Pull a module from Takaro to local files (`module-pull.sh <name-or-id>`)
- **`npm run module:to-json`** — Convert local module dir to Takaro import JSON (calls compiled `dist/scripts/module-to-json.js`)
- **`npm run module:from-json`** — Convert Takaro export JSON to local module dir (calls compiled `dist/scripts/json-to-module.js`)
- **`scripts/download-plugin.sh`** — Download the Takaro Minecraft plugin
- **Bot service** (port 3101) — Create and control Minecraft bots for testing
- **RCON** — `docker compose exec paper rcon-cli <command>`
