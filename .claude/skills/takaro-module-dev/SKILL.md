---
name: takaro-module-dev
description: "Use this skill for ALL Takaro module development work. This includes: creating new modules, writing commands/hooks/cronjobs/functions, brainstorming game server features, testing modules in-game, debugging module execution, or discussing module architecture. Trigger whenever the user mentions: Takaro modules, game server commands, player events, cronjobs, hooks, module testing, game automation, or wants to add features to a game server. Also trigger when the user wants to brainstorm ideas for game server functionality, even if they haven't mentioned 'module' explicitly."
---

# Takaro Module Development

You are working in a repository designed for autonomous Takaro module development and testing. Your job is to help design, implement, and thoroughly test Takaro modules using the tools in this repo.

Takaro is a game server management platform. Modules are how features get added to game servers. Since Takaro evolves rapidly, you must always fetch the latest documentation at runtime rather than relying on prior knowledge.

## Environment

This repo provides:
- **Minecraft Paper server** — A real game server for testing (`docker compose up -d paper`)
- **Bot service** — HTTP API to create and control Minecraft players (`docker compose up -d bot`). See `references/bot-api.md` for the full API.
- **Auth scripts** — `scripts/takaro-auth.sh` and `scripts/takaro-api.sh` for Takaro API access via curl
- **Module scripts** — `scripts/module-push.sh` and `scripts/module-pull.sh` for syncing modules between local files and Takaro
- **Local modules** — `modules/` directory where module code lives as editable files

### Starting Services

```bash
docker compose up -d paper bot
```

Wait for Paper to finish starting before testing (check `docker compose logs paper`).

### Takaro API Access

All Takaro API calls go through the curl wrapper script:

```bash
# Authenticate (do this first, or the api script does it automatically)
bash scripts/takaro-auth.sh

# Make API calls
bash scripts/takaro-api.sh GET /gameserver/search '{}'
bash scripts/takaro-api.sh POST /module '{...}'
bash scripts/takaro-api.sh GET /openapi.json
```

The script handles auth headers, domain selection, token refresh on 401, and JSON pretty-printing. Always use this script — never construct raw curl commands to Takaro.

## Phase 1: Research

Before writing any module, research the current state of Takaro. The platform evolves fast — never assume you know the API surface or available features.

### What to fetch

1. **Module documentation** — Fetch from docs.takaro.io to understand module architecture, available event types, component structure, and the helpers API (`@takaro/helpers`).

2. **Existing modules** — Browse https://modules.takaro.io to see what already exists. Study modules similar to what you're building for patterns, code structure, and inspiration. This is the most important reference for understanding how real modules are written.

3. **OpenAPI spec** — Fetch via `bash scripts/takaro-api.sh GET /openapi.json` to understand the exact current API surface. This tells you what endpoints exist, what parameters they take, and what they return. This is critical because modules use the Takaro API client internally.

4. **API client docs** — If you need to understand what methods are available on the `takaro` client object (used inside module code), check the API client documentation on docs.takaro.io.

### Research tips

- When studying existing modules, pay attention to how they structure functions for code reuse
- Look at how similar modules handle edge cases and error messages
- Check what events are available for hooks — the module docs list supported event types
- The OpenAPI spec is the source of truth for API endpoints and their parameters

## Phase 2: Design (Human-in-the-Loop)

Before coding, collaborate with the user to design the module. Your role here is to be a thoughtful collaborator who catches gaps and thinks through the player experience.

### Brainstorming checklist

- **Problem definition** — What problem does this module solve? Who benefits?
- **Component planning** — Which components are needed?
  - Commands: What will players type? What arguments do they need?
  - Hooks: What game events should trigger behavior?
  - Cronjobs: What needs to happen on a schedule?
  - Functions: What code is shared across components?
- **Player UX** — Think from the player's perspective:
  - Are command names intuitive? Would a player guess them?
  - Are error messages helpful? If a player types wrong arguments, do they get guidance?
  - Is the output clear and concise? Players are in-game, not reading docs.
- **Gap analysis** — Actively look for missing pieces:
  - "You have a /buy command but no way for players to check their balance"
  - "This hook fires on player death but doesn't handle the case where the killer is also dead"
  - "Players might want to configure X — should this be a module setting?"
- **Edge cases** — Think through what could go wrong:
  - What if the player is offline? Dead? In a different world?
  - What if the command is run twice quickly?
  - What if the API call fails?
  - What if there's no data yet (first run)?
- **Acceptance criteria** — Define what "working" means for each component. These become your test cases.

### Output

The design phase should produce a clear plan with:
- Module name and description
- List of components with their purpose
- Command signatures with arguments
- Hook event types and expected behavior
- Acceptance criteria for testing

## Phase 3: Implementation

### Module code structure

Every module component (command, hook, cronjob) must follow this pattern:

```javascript
import { data, takaro } from '@takaro/helpers';

async function main() {
  const { gameServerId, player, module: mod } = data;

  // Your code here
}

await main();
```

The `data` object contents vary by component type:
- **Commands**: `{ gameServerId, player, pog, arguments, module, chatMessage }`
- **Hooks**: `{ gameServerId, eventData, player, module }`
- **Cronjobs**: `{ gameServerId, module }`

### Key patterns

- **Functions for shared code** — If multiple components need the same logic, put it in a function. This is critical for DRY code. The function code is available to all components in the module.
- **Use `TakaroUserError`** for player-facing errors — these show a clean message to the player instead of a stack trace.
- **Use `Promise.all`** for parallel API calls — don't make sequential calls when they're independent.
- **Always `await` API calls** — missing awaits is a common silent failure.

### Local module file structure

All module code lives locally in the `modules/` directory. Each module is a folder:

```
modules/
  my-module/
    module.json              # Name, author, description, version, supportedGames
    config.json              # Configuration schema (JSON Schema draft-07)
    permissions.json         # Permission definitions (optional)
    commands/
      command-name/
        index.js             # Command code
        command.json          # trigger, description, helpText, arguments
    hooks/
      hook-name/
        index.js             # Hook code
        hook.json             # eventType, description, regex
    cronjobs/
      cronjob-name/
        index.js             # Cronjob code
        cronjob.json          # temporalValue, description
    functions/
      shared-util.js         # Shared function code (filename = function name)
```

### Development workflow

Write code locally, push to Takaro, install, test. This is the core loop:

1. **Write code** — Edit files in `modules/<name>/` using normal file editing
2. **Push to Takaro** — `bash scripts/module-push.sh modules/<name>`
3. **Install on game server** — Use the Takaro API to install the module
4. **Test in-game** — Use bots to trigger and verify behavior
5. **Debug & iterate** — Fix code locally, push again, re-test

To pull an existing module from Takaro for local editing:
```bash
bash scripts/module-pull.sh "module-name"       # By name
bash scripts/module-pull.sh <module-uuid>        # By ID
```

### Versioning

Takaro modules support semantic versioning. During development, work on the "latest" version (set `"version": "latest"` in module.json). Tag a version when the module is stable and tested.

## Phase 4: Testing

Testing is the most important phase. A module is not done until every acceptance criterion passes in a real game environment. Read `references/testing-methodology.md` for the complete testing playbook.

### Quick test loop

1. **Ensure services are running**: `docker compose up -d paper bot`
2. **Create a test bot**: `curl -X POST http://localhost:3101/bots -H 'Content-Type: application/json' -d '{"name":"tester"}'`
3. **Wait for connection**: `sleep 5 && curl http://localhost:3101/status`
4. **Trigger the module** (varies by component type):
   - Command: Send via bot chat
   - Hook: Trigger the game event (via bot action or RCON)
   - Cronjob: Trigger via API
5. **Wait for execution**: `sleep 3`
6. **Check execution event**: Fetch from Takaro event API
7. **Verify side effects**: Check for expected outcomes (messages, variable changes, etc.)
8. **Clean up**: Destroy test bots when done

### What to test

- **Happy path** for every component
- **Wrong/missing arguments** — do players get helpful errors?
- **Edge cases** specific to the module
- **Multi-player scenarios** where relevant
- **UX check** — are messages clear and useful to a player?

### Correctness over speed

Take as long as needed. A thoroughly tested module that takes hours is far more valuable than a quick module with untested edge cases. When in doubt, add another test case.

## Phase 5: Debugging

When something doesn't work, check `references/debugging-patterns.md` for the debugging playbook.

### Quick reference

| Symptom | Likely Cause |
|---------|-------------|
| Empty logs + success:true | Missing `import { data, takaro } from '@takaro/helpers'` or wrong API method names |
| Empty logs + success:false | Syntax error or runtime crash |
| Populated logs + error | API call failed — check the error message |
| No execution event at all | Module not installed, wrong command prefix, or wrong game server |

### Debugging strategy

1. Add `console.log` statements throughout the code
2. Re-trigger the module
3. Fetch the execution event and read the logs
4. Fix the issue, update the code, re-test
5. Repeat until all tests pass

Always check the command prefix — it's configured per game server and might not be what you expect. Fetch it via the settings API.
