# Takaro AI Module Writer

This repo contains configs to help you leverage AI tools like Claude to write Takaro modules.

## Prerequisites

### Windows Users
Windows users need to set up WSL2 first:
1. [Install WSL2](https://learn.microsoft.com/en-us/windows/wsl/install) with Ubuntu
2. [Install Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) and enable WSL2 integration in Docker Desktop settings
3. **Important**: Install Claude Code inside WSL (not Windows) - open Ubuntu terminal and follow [Claude Code installation](https://docs.anthropic.com/en/docs/claude-code/quickstart)

**Note**: When Docker Desktop uses WSL2 backend, containers are accessible from WSL at `localhost`. If you have connection issues, try using `host.docker.internal` instead of `localhost`.

### Mac/Linux Users
- [Mac](https://docs.docker.com/desktop/setup/install/mac-install/): Install Docker Desktop
- [Linux](https://docs.docker.com/engine/install/): Install Docker Engine

## Setup

```bash
# Clone this repository
git clone https://github.com/gettakaro/ai-module-writer.git
cd ai-module-writer

# Copy the .env.example to .env and fill in your credentials
cp .env.example .env
```

### Configure your `.env` file

You need:
- `TAKARO_USERNAME` and `TAKARO_PASSWORD` — Your Takaro account credentials
- `TAKARO_HOST` — The Takaro API URL (e.g., `https://api.takaro.io`)
- `TAKARO_DOMAIN_ID` — Your Takaro domain ID

### Minecraft Server Setup

1. Download the Takaro plugin:
   ```bash
   bash scripts/download-plugin.sh
   ```
2. Go to your Takaro dashboard
3. Navigate to **Game Servers** -> **Add Server** -> **Minecraft**
4. Copy the **registration token** provided
5. Add these to your `.env` file:
   ```
   TAKARO_REGISTRATION_TOKEN=<paste-your-token>
   TAKARO_MC_IDENTITY_TOKEN=unique-mc-identity
   RCON_PASSWORD=takaro123
   TAKARO_WS_URL=wss://connect.takaro.io
   ```
6. Start the services:
   ```bash
   docker compose up -d paper bot
   ```
7. Wait for the Paper server to finish starting (first launch takes a few minutes):
   ```bash
   docker compose logs -f paper
   ```

### Start Claude

```bash
claude

# Now you can start creating modules!
> Write me a module that says 'hello' to every player when they join
```

## How it Works

The Docker containers run:
- **Paper Minecraft server** (port 25665/25675) — Real Minecraft server for in-game testing
- **Mineflayer bot service** (port 3101) — HTTP-controlled bots for simulating players

This repository includes:
- **Auth scripts** (`scripts/`) — Authenticate with the Takaro API and make curl calls
- **Skill** (`.claude/skills/takaro-module-dev/`) — Claude Code skill for autonomous module development and testing
- **Bot service** (`bot/`) — Dynamic multi-bot HTTP API for in-game testing

Modules are created and managed directly in Takaro via the API — no module code is stored locally.

## Using the Bot

The bot service provides an HTTP API on port 3101 for creating and controlling Minecraft bots:

```bash
# Create a bot
curl -X POST http://localhost:3101/bots \
  -H 'Content-Type: application/json' \
  -d '{"name": "player1"}'

# Check status
curl http://localhost:3101/status

# Send a Takaro command
curl -X POST http://localhost:3101/bot/player1/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "+ping"}'

# Destroy the bot
curl -X DELETE http://localhost:3101/bots/player1
```
