# Testing Methodology

This is the complete playbook for testing Takaro modules in-game. Every module must be tested against the real Minecraft server using bots.

## Pre-Test Checklist

Before testing anything:

1. **Services running**: `docker compose up -d paper bot`
2. **Paper server ready**: Check `docker compose logs --tail=5 paper` — look for "Done" message
3. **Bot service healthy**: `curl http://localhost:3101/status` should return (even if empty `{}`)
4. **Module installed**: Verify the module is installed on the Minecraft game server via Takaro API
5. **Command prefix known**: Fetch with `bash scripts/takaro-api.sh POST /settings '{...}'` using the game server ID. The prefix is typically `+` but never assume.

## Testing Commands

### Trigger flow

```bash
# 1. Create a bot
curl -X POST http://localhost:3101/bots \
  -H 'Content-Type: application/json' \
  -d '{"name":"tester"}'

# 2. Wait for connection
sleep 5
curl http://localhost:3101/status

# 3. Send the command (use the correct prefix!)
curl -X POST http://localhost:3101/bot/tester/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"+commandname arg1 arg2"}'

# 4. Wait for execution
sleep 3

# 5. Check execution event
bash scripts/takaro-api.sh POST /event/search '{
  "filters": {
    "eventName": ["command-executed"]
  },
  "sortBy": "createdAt",
  "sortDirection": "desc",
  "limit": 5
}'

# 6. Clean up
curl -X DELETE http://localhost:3101/bots/tester
```

### What to verify in the execution event

- `success` field: true = code ran, false = crash
- `logs` array: contains console.log output and API call traces
  - Lines with `➡️` = outgoing API calls
  - Lines with `⬅️` = API responses
  - Regular lines = console.log output
- `meta` field: may contain error details

## Testing Hooks

Hooks fire on game events. Trigger the event using bot actions or RCON.

### Common event triggers

| Event | How to trigger |
|-------|---------------|
| player-connected | Create a new bot |
| player-disconnected | Destroy a bot |
| chat-message | Send chat via bot |
| entity-killed (player death) | `docker compose exec paper rcon-cli kill Bot_tester` |

### Verification

Same as commands — check `hook-executed` events via the event search API.

## Testing Cronjobs

Trigger manually via the Takaro API instead of waiting for the schedule:

```bash
bash scripts/takaro-api.sh POST /cronjob/{cronjobId}/trigger '{
  "gameServerId": "your-game-server-id"
}'
```

Check `cronjob-executed` events for results.

## Side Effect Verification

After triggering a module, verify its side effects actually happened:

### Chat messages
```bash
bash scripts/takaro-api.sh POST /event/search '{
  "filters": { "eventName": ["chat-message"] },
  "sortBy": "createdAt",
  "sortDirection": "desc",
  "limit": 5
}'
```

### Variable changes
```bash
bash scripts/takaro-api.sh POST /variable/search '{
  "filters": { "moduleId": ["your-module-id"] }
}'
```

### Currency changes
Check player-on-gameserver records for updated currency values.

### Player role changes
Check player role assignments via the player API.

## Thoroughness Requirements

A module is not done until ALL of these are tested:

### For every component
- [ ] Happy path works correctly
- [ ] Output/messages are clear and useful to a player

### For commands
- [ ] Missing required arguments → helpful error message
- [ ] Wrong argument types → helpful error message
- [ ] Extra unexpected arguments → handled gracefully
- [ ] Running the command twice quickly → no corruption or duplicate effects

### For hooks
- [ ] The correct event triggers the hook
- [ ] The hook handles missing/null fields in eventData
- [ ] Multiple rapid events don't cause issues

### For the module overall
- [ ] Multi-player scenarios work (create 2+ bots if needed)
- [ ] First-run scenario (no existing data/variables) works
- [ ] Module can be uninstalled and reinstalled cleanly

## Multi-Bot Testing

For features involving multiple players:

```bash
# Create multiple bots
curl -X POST http://localhost:3101/bots -H 'Content-Type: application/json' -d '{"name":"alice"}'
curl -X POST http://localhost:3101/bots -H 'Content-Type: application/json' -d '{"name":"bob"}'
sleep 5

# Test interactions
curl -X POST http://localhost:3101/bot/alice/chat -H 'Content-Type: application/json' -d '{"message":"+trade bob 100"}'

# Clean up all bots
curl -X DELETE http://localhost:3101/bots/alice
curl -X DELETE http://localhost:3101/bots/bob
```

## RCON Recipes

For triggering server-side events:

```bash
docker compose exec paper rcon-cli list                       # List online players
docker compose exec paper rcon-cli kill Bot_tester            # Kill a bot (triggers death event)
docker compose exec paper rcon-cli op Bot_tester              # Give operator permissions
docker compose exec paper rcon-cli gamemode creative Bot_tester  # Change gamemode
docker compose exec paper rcon-cli give Bot_tester diamond 5  # Give items
```
