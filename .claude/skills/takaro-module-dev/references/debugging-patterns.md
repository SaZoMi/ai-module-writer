# Debugging Patterns

This document describes how to debug Takaro module execution failures.

## Quick Diagnosis Table

| Symptom | Likely Cause |
|---------|-------------|
| Empty logs + `success: true` | Missing `import { data, takaro } from '@takaro/helpers'` or wrong API method names |
| Empty logs + `success: false` | Syntax error or runtime crash |
| Populated logs + error | API call failed — check the error message |
| No execution event at all | Module not installed, wrong command prefix, or wrong game server |
| Hook never fires | Wrong `eventType` in the `hooks` section of module.json, or module not installed on that game server |
| Cronjob never fires | Wrong `temporalValue` cron expression, or module not installed |

## Step-by-Step Debugging

### 1. Check the execution event

After triggering a command or hook, fetch the event:

```bash
bash scripts/takaro-api.sh POST /event/search '{
  "filters": { "eventName": ["command-executed"] },
  "sortBy": "createdAt",
  "sortDirection": "desc",
  "limit": 1
}'
```

Look at:
- `meta.result.success` — did it succeed?
- `meta.result.logs` — what did `console.log` output?
- `meta.result.error` — error message if it failed

### 2. Add console.log statements

Add logging to your module code and re-push:

```javascript
async function main() {
  const { gameServerId, player, module: mod } = data;
  console.log('Command triggered by player:', player?.name);
  console.log('Module config:', mod?.userConfig);
  // ... rest of your code
}
```

Then re-push and re-trigger, and check the execution event logs.

### 3. Check the command prefix

The command prefix is configured per game server. Fetch it:

```bash
bash scripts/takaro-api.sh GET '/settings?gameServerId=<your-game-server-id>&keys[]=commandPrefix'
```

If you expect `/greet` but the prefix is `!`, you need to send `!greet`.

### 4. Verify module is installed

Check that the module is installed on the right game server:

```bash
bash scripts/takaro-api.sh POST /module/installations/search '{
  "filters": { "gameserverId": ["<your-game-server-id>"] }
}'
```

### 5. Check Takaro API errors

If an API call inside your module fails, the error appears in `meta.result.logs` or `meta.result.error`. Common issues:
- Insufficient permissions — check the `permissions` section in module.json
- Wrong parameter names — check the OpenAPI spec: `bash scripts/takaro-api.sh GET /openapi.json`
- Player not found — ensure the player is online

## Common Mistakes

### Missing await

```javascript
// WRONG — fire and forget, error is swallowed
takaro.player.playerControllerSendMessage(gameServerId, playerId, { message: 'Hello' });

// CORRECT
await takaro.player.playerControllerSendMessage(gameServerId, playerId, { message: 'Hello' });
```

### Wrong import

```javascript
// WRONG — helpers not imported
const { player } = data; // data is undefined

// CORRECT
import { data, takaro } from '@takaro/helpers';
const { player } = data;
```

### Wrong event type

```json
// module.json hooks section — check the exact event type strings in Takaro docs
{
  "hooks": {
    "my-hook": {
      "eventType": "player-connected"  // not "playerConnected" or "PLAYER_CONNECTED"
    }
  }
}
```

## Fetching Execution Events in Tests

Use the `waitForEvent` helper in tests:

```typescript
const event = await waitForEvent(client, {
  eventName: EventSearchInputAllowedFiltersEventNameEnum.CommandExecuted,
  gameserverId: ctx.gameServer.id,
  after: beforeTimestamp,
  timeout: 30000,
});

// Inspect what happened
const meta = event.meta as { result?: { success?: boolean; logs?: unknown[]; error?: string } };
console.log('Success:', meta?.result?.success);
console.log('Logs:', meta?.result?.logs);
console.log('Error:', meta?.result?.error);
```

## Re-pushing After Code Changes

After fixing module code, always re-push before testing:

```bash
npm run build  # Ensure TypeScript is compiled
bash scripts/module-push.sh modules/<name>
```

The push script handles the case where a module already exists by deleting and re-importing it (search-delete-import pattern — the Takaro API does not return 409 on duplicates, it silently renames with an `-imported` suffix).

## Module Push Gotchas

- The Takaro import API returns 200 even when a module with the same name exists — it silently creates a copy with `-imported` suffix. That's why `module-push.sh` does search-delete-import instead of relying on error codes.
- After a failed import where the old module was already deleted, the module is gone. The push script warns about this.
