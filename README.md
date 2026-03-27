# Takaro AI module writer

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

# Copy the .env.example to .env and fill in your API keys
cp .env.example .env

# Start the MCP server
docker compose up -d

# Add the MCP server to Claude (run this once)
# For most users:
claude mcp add --transport http takaro http://localhost:18000

# If you have connection issues on Windows/WSL2, try:
# claude mcp add --transport http takaro http://host.docker.internal:18000

# Start Claude
claude

# Verify the MCP server is connected (you should see 'takaro' in the list)
> /mcp

# Now you can start creating modules!
> Write me a module that says 'hello' to every player when they join
```

## Mock Game Server (Optional)

The Docker setup includes a mock game server for testing modules. It simulates player activity (joins, chat, deaths, etc.) so you can test hooks and commands without a real game server.

### Setup Mock Server

1. Go to your Takaro dashboard
2. Navigate to **Game Servers** → **Add Server**
3. Select **Mock** as the server type
4. Copy the **registration token** provided
5. Add these to your `.env` file:
   ```
   TAKARO_REGISTRATION_TOKEN=<paste-your-token>
   TAKARO_MOCK_IDENTITY_TOKEN=my-local-mock-server
   ```
6. Restart Docker: `docker compose up -d`

The mock server will appear in your Takaro dashboard as "Local Mock Server". Install modules on it to test them.

## Minecraft Server (Optional)

A real Minecraft Paper server with a Mineflayer bot service for testing modules against actual game events.

### Setup

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

### Using the Bot

The bot service provides an HTTP API on port 3101 for creating and controlling Minecraft bots on demand:

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

For the full API reference, see the `/bot` command in Claude (`/bot status`).

## How it Works

The Docker containers run:
- **Takaro MCP server** (port 18000) - Claude Code connects here to manage modules
- **Mock game server** (port 3002) - Simulates a game server for testing
- **Paper Minecraft server** (port 25665/25675) - Real Minecraft server for testing (optional)
- **Mineflayer bot** (port 3101) - HTTP-controlled bots for in-game testing (optional)

This repository includes:
- **CLAUDE.md**: Instructions for Claude on how to write Takaro modules
- **Custom commands**: Use `/test-module` in Claude to test and debug your modules
- **Docker setup**: Pre-configured MCP server and mock game server for module development