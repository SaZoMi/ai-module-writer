---
name: bot
description: "Control Mineflayer test bots to perform in-game actions for testing Takaro features. Use when you need to send chat messages, trigger game events, check player status, or verify mod behavior. Trigger on phrases like 'send a chat', 'test the command', 'check bot status', 'make the bot do', 'trigger an event'."
---

# Mineflayer Test Bot (Dynamic Multi-Player)

An HTTP-controlled Mineflayer bot service running as a Docker container (`bot`). Bots are created and destroyed on demand via the management API. You control them via curl to test Takaro features.

## Arguments

`$ARGUMENTS` specifies what to do. Examples: `status`, `create player1`, `chat player1 +ping`, `destroy player1`.

## API Reference

Base URL: `http://localhost:3101`

### Bot Management

#### Create a bot
```bash
curl -X POST http://localhost:3101/bots \
  -H 'Content-Type: application/json' \
  -d '{"name": "player1"}'
```
Creates and connects a new bot. Username will be `Bot_player1`. Bot names must be short enough that `Bot_<name>` does not exceed Minecraft's 16-character username limit (max 12 chars for the name).

#### Destroy a bot
```bash
curl -X DELETE http://localhost:3101/bots/player1
```
Disconnects and removes the bot.

#### Status (all bots)
```bash
curl http://localhost:3101/status
```
Returns status of all active bots. Returns `{}` when no bots exist.

### Per-Bot Actions

Replace `<name>` with the bot name (e.g., `player1`).

#### Chat (send a message or Takaro command)
```bash
curl -X POST http://localhost:3101/bot/<name>/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "+ping"}'
```

#### Movement
```bash
curl -X POST http://localhost:3101/bot/<name>/move \
  -H 'Content-Type: application/json' \
  -d '{"x": 100, "y": 64, "z": 100}'
```

#### Combat (attack nearest entity)
```bash
curl -X POST http://localhost:3101/bot/<name>/attack
```

#### Interact with block
```bash
curl -X POST http://localhost:3101/bot/<name>/use
```

#### Look at coordinates
```bash
curl -X POST http://localhost:3101/bot/<name>/look \
  -H 'Content-Type: application/json' \
  -d '{"x": 100, "y": 64, "z": 100}'
```

#### Jump
```bash
curl -X POST http://localhost:3101/bot/<name>/jump
```

#### Respawn (after death)
```bash
curl -X POST http://localhost:3101/bot/<name>/respawn
```

#### Query endpoints
```bash
curl http://localhost:3101/bot/<name>/players     # Online players
curl http://localhost:3101/bot/<name>/position     # Bot position
curl http://localhost:3101/bot/<name>/health       # Bot health/food
curl http://localhost:3101/bot/<name>/inventory    # Bot inventory
```

## Common Workflows

### Quick setup (create a bot and test a command)
```bash
# Create a bot
curl -X POST http://localhost:3101/bots -H 'Content-Type: application/json' -d '{"name":"player1"}'

# Wait a few seconds for connection, then check status
curl http://localhost:3101/status

# Send a Takaro command
curl -X POST http://localhost:3101/bot/player1/chat -H 'Content-Type: application/json' -d '{"message":"+ping"}'
```

### PvP test (two bots)
```bash
# Create two bots
curl -X POST http://localhost:3101/bots -H 'Content-Type: application/json' -d '{"name":"attacker"}'
curl -X POST http://localhost:3101/bots -H 'Content-Type: application/json' -d '{"name":"target"}'

# Make attacker attack nearest entity
curl -X POST http://localhost:3101/bot/attacker/attack
```

### Group events (multiple players joining)
```bash
# Create several bots to simulate a group
for name in alice bob charlie; do
  curl -X POST http://localhost:3101/bots -H 'Content-Type: application/json' -d "{\"name\":\"$name\"}"
done

# Check all statuses
curl http://localhost:3101/status

# Clean up
for name in alice bob charlie; do
  curl -X DELETE http://localhost:3101/bots/$name
done
```

### Trigger a player death event
```bash
# Use RCON to kill a bot
docker compose exec paper rcon-cli kill Bot_player1

# Respawn the bot
curl -X POST http://localhost:3101/bot/player1/respawn
```

## RCON Recipes

```bash
# Send a command via RCON
docker compose exec paper rcon-cli <command>

# Examples
docker compose exec paper rcon-cli list                    # List online players
docker compose exec paper rcon-cli kill Bot_player1  # Kill a bot
docker compose exec paper rcon-cli op Bot_player1    # Give bot operator
docker compose exec paper rcon-cli gamemode creative Bot_player1
```

## Ensuring the bot service is running

```bash
docker compose up -d bot
docker compose logs --tail=20 bot
```

## Known Limitations

- Bots auto-reconnect after server restarts with exponential backoff (5s to 60s max).
- Bot usernames follow the pattern `Bot_<name>`. The combined username must not exceed 16 characters (Minecraft limit), so bot names can be up to 12 characters long.
- If a bot returns 503, the server is likely still restarting -- wait and retry.
- All POST endpoints need `Content-Type: application/json` header.
- The command prefix is `+` (not `!`). Confirm via `mcp__takaro__settingsGet`.
