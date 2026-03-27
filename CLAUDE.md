# Takaro Module Development Reference

Your goal is to write Takaro modules. You MUST use the Takaro MCP server to create modules. NEVER write module code on the local filesystem, you should always call the Takaro MCP tools to create/edit/delete modules and the underlying components (commands, hooks, cronjobs, functions, and permissions).

## Overview
Takaro modules are the core mechanism for adding features to game servers. Each module can contain commands, hooks, cronjobs, functions, and permissions.

**Official Docs**: https://docs.takaro.io/advanced/modules

You !!MUST!! read the official documentation and [examples](https://raw.githubusercontent.com/gettakaro/takaro/refs/heads/development/packages/web-docs/docs/modules/modules.json) before writing your own modules.

## Key Components

### Commands
Player-triggered actions with arguments and permission checks.

### Hooks
Event-driven code that responds to game events (player join, chat, etc).

### Cronjobs
Time-based tasks that run on schedule.

### Functions
Reusable code shared across module components.

## Variables System
Persistent key-value storage linked to GameServer, Player, and Module.
- **Unique keys** per GameServer/Player/Module combination
- Use `moduleId` to prevent key collisions

**Docs**: https://docs.takaro.io/advanced/variables

## Development Tips
- Use `Promise.all` for parallel API calls
- You can use Functions to put reusable code inside. This is VERY important to keep code DRY. Look at the teleports module as an example for this
- Handle errors with `TakaroUserError`

Every module component (command, hook, cronjob) should have this structure (note the imports and the main function):

```javascript
import { data, takaro } from '@takaro/helpers';
async function main() {
    const {} = data;
    await takaro.gameserver.gameServerControllerSendMessage(data.gameServerId, {
          message: "Test success!"
    });
}
await main();
```

## Event Data Structures

Different event types provide different data in `eventData`. Always log it first to understand the structure:

```javascript
console.log('Event data:', JSON.stringify(eventData, null, 2));
```

Common event structures:
- **entity-killed**: `{ entity: string, weapon: string, msg: string, timestamp: string, player: {...} }`
- **player-connected/disconnected**: `{ player: { gameId, name, steamId, ... } }`
- **chat-message**: `{ msg: string, channel: string, timestamp: string, player: {...} }`
- **discord-message**: `{ msg: string, author: { displayName, isBot, ... } }`

The `data` object varies by component type:
- **Commands**: `{ gameServerId, player, pog, arguments, module, chatMessage }`
- **Hooks**: `{ gameServerId, eventData, player, module }`
- **Cronjobs**: `{ gameServerId, module }`

## Debugging Modules

You can debug failing modules using the events endpoint:
- **Filter events** by module ID or event names (`command-executed`, `hook-executed`, `cronjob-executed`)
- **Event metadata** contains detailed logs from module execution, including `console.log` outputs
- **Every execution creates an event** with detailed logs of all API calls and console outputs

### Common Pitfalls
- **Missing imports**: Without `import { data, takaro } from '@takaro/helpers'` code fails silently
- **Wrong API method names**: Check camelCase carefully (e.g., `gameServerController` not `gameserverController`)
- **Not awaiting async operations**: Always use `await` for API calls
- **Assuming data exists**: Check for undefined values in eventData before using them

### Debugging Strategy
1. Add console.logs throughout your code
2. Execute the module again
3. Check the execution event for logs
4. **Verify side effects**: Check for expected events (chat-message, player updates, etc.)
5. **Empty logs + success:true** = Module bug (wrong method names, missing imports)

**Custom Modules Guide**: https://docs.takaro.io/advanced/custom-modules
Inside the module, you are using the takaro api client. If you are unsure about a function, input or output you can reference these web pages: https://docs.takaro.io/api-docs/modules/_takaro_apiclient.html

## Minecraft Testing Infrastructure

A real Minecraft Paper server and dynamic Mineflayer bot service are available for testing modules against actual game events.

### Setup

1. Download the Takaro plugin: `bash scripts/download-plugin.sh`
2. Register a Minecraft game server in your Takaro dashboard (Game Servers -> Add Server -> Minecraft)
3. Add the registration token and other config to `.env` (see `.env.example` for the Minecraft section)
4. Start the services: `docker compose up -d paper bot`
5. Wait for the Paper server to finish starting (check with `docker compose logs paper`)

### Dynamic Bot API

The bot service runs on `http://localhost:3101`. Bots are created and destroyed on demand (no auto-connect).

- **Create a bot**: `curl -X POST http://localhost:3101/bots -H 'Content-Type: application/json' -d '{"name":"player1"}'`
- **Destroy a bot**: `curl -X DELETE http://localhost:3101/bots/player1`
- **Check status**: `curl http://localhost:3101/status`
- **Per-bot actions**: `POST /bot/<name>/chat`, `/move`, `/attack`, `/use`, `/look`, `/jump`, `/respawn`
- **Per-bot queries**: `GET /bot/<name>/players`, `/position`, `/health`, `/inventory`

### Example Usage

```bash
# Create a bot and send a Takaro command
curl -X POST http://localhost:3101/bots -H 'Content-Type: application/json' -d '{"name":"tester"}'
sleep 5
curl -X POST http://localhost:3101/bot/tester/chat -H 'Content-Type: application/json' -d '{"message":"+ping"}'
```

For the full API reference and common workflows, use the `/bot` command.
