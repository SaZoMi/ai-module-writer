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

Modules are created and managed via the Takaro API using curl (through `scripts/takaro-api.sh`). Module code is never written to the local filesystem — it lives in Takaro.

## Available Tools

- **`scripts/takaro-auth.sh`** — Authenticate with the Takaro API
- **`scripts/takaro-api.sh`** — Curl wrapper for Takaro API calls with auto-auth
- **`scripts/download-plugin.sh`** — Download the Takaro Minecraft plugin
- **Bot service** (port 3101) — Create and control Minecraft bots for testing
- **RCON** — `docker compose exec paper rcon-cli <command>`
