# Bot Service API Reference

HTTP-controlled Mineflayer bot service for in-game testing. Bots are created and destroyed on demand.

**Base URL**: `http://localhost:3101`

All POST endpoints require `Content-Type: application/json` header.

## Bot Management

### Create a bot
```
POST /bots
{"name": "player1"}
```
Returns: `{created: "player1", username: "Bot_player1"}`

Bot usernames follow the pattern `Bot_<name>`. The combined username must not exceed 16 characters (Minecraft limit), so bot names can be at most 12 characters.

### Destroy a bot
```
DELETE /bots/:name
```

### Status (all bots)
```
GET /status
```
Returns status of all active bots including: connected, name, username, health, food, position, gameMode. Returns `{}` when no bots exist.

## Per-Bot Actions

### Chat (send message or Takaro command)
```
POST /bot/:name/chat
{"message": "+ping"}
```
Use the correct command prefix (typically `+`).

### Move to coordinates
```
POST /bot/:name/move
{"x": 100, "y": 64, "z": 100}
```
Continuous forward motion for up to 30 seconds or until within 2 blocks of target.

### Attack nearest entity
```
POST /bot/:name/attack
```

### Interact with block in sight
```
POST /bot/:name/use
```
5 block range.

### Look at coordinates
```
POST /bot/:name/look
{"x": 100, "y": 64, "z": 100}
```

### Jump
```
POST /bot/:name/jump
```
0.5 second hold.

### Respawn (after death)
```
POST /bot/:name/respawn
```

## Per-Bot Queries

### Online players
```
GET /bot/:name/players
```
Returns: `[{username, uuid, ping, gamemode}, ...]`

### Position
```
GET /bot/:name/position
```
Returns: `{x, y, z}`

### Health
```
GET /bot/:name/health
```
Returns: `{health, food, saturation}`

### Inventory
```
GET /bot/:name/inventory
```
Returns: `[{name, count, slot, displayName}, ...]`

## Troubleshooting

- If a bot returns 503, the Minecraft server is likely still starting — wait and retry
- Bots auto-reconnect after server restarts with exponential backoff (5s to 60s)
- If the bot can't connect, check `docker compose logs bot` and `docker compose logs paper`
