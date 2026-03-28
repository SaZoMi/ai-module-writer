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

### Running Multiple Instances

To run multiple clones simultaneously (e.g., `ai-module-writer-1` through `ai-module-writer-5`), set a unique `INSTANCE_ID` (0-9) in each clone's `.env` file, then generate the port offsets:

```bash
# In each clone, set the INSTANCE_ID and generate ports
scripts/instance-env.sh 2 >> .env   # appends MC_PORT=25667, BOT_PORT=3103, etc.
```

| Instance | MC Port | RCON Port | Bot Port | Redis Port |
|----------|---------|-----------|----------|------------|
| 0 | 25665 | 25675 | 3101 | 6379 |
| 1 | 25666 | 25676 | 3102 | 6380 |
| 2 | 25667 | 25677 | 3103 | 6381 |

Each clone also needs a unique `TAKARO_MC_IDENTITY_TOKEN` in `.env`.

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
- **Paper Minecraft server** (port `MC_PORT`/`RCON_PORT`, default 25665/25675) — Real Minecraft server for in-game testing
- **Mineflayer bot service** (port `BOT_PORT`, default 3101) — HTTP-controlled bots for simulating players

This repository includes:
- **Auth scripts** (`scripts/`) — Authenticate with the Takaro API and make curl calls
- **Skill** (`.claude/skills/takaro-module-dev/`) — Claude Code skill for autonomous module development and testing
- **Bot service** (`bot/`) — Dynamic multi-bot HTTP API for in-game testing

Modules are created and managed directly in Takaro via the API — no module code is stored locally.

## Using the Bot

The bot service provides an HTTP API (port configured by `BOT_PORT` in `.env`, default 3101) for creating and controlling Minecraft bots:

```bash
# Create a bot (replace 3101 with your BOT_PORT if different)
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
