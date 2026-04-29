# Issue #42: Playtime Buff Rewards

## Summary
Create a Takaro module based on playtime rewards that can grant configured buffs with the console command `buffplayer Playername BuffName`. Support scheduled playtime reward grants and a permission-gated admin command for manually granting or testing buffs.

## Key Changes
- Add `modules/playtime-buff-rewards`.
- Add configurable reward pools:
  - `buffRewards`: named buffs with optional weight/message/enabled fields.
  - `commandRewards`: generic server command rewards for existing food/drink/ammo/med style rewards.
  - `currencyRewards`: Takaro currency grants.
- Add `buffCommandTemplate`, defaulting to `buffplayer {playerName} {buffName}`.
- Add `/grantbuff <player> <buffName>` guarded by `PLAYTIME_BUFF_ADMIN`.
- Use `takaro.gameserver.gameServerControllerExecuteCommand(gameServerId, { command })` for buff and command rewards.

## Test Plan
- Add real Takaro API integration tests for the cronjob and admin command.
- Run `npm run build`.
- Run module import conversion with `node dist/scripts/module-to-json.js modules/playtime-buff-rewards`.
- Run targeted module tests when `TAKARO_HOST` and test services are available.
- Push and verify in game with Paper + bot service before considering the module production-ready.

## Assumptions
- The customer command format `buffplayer Playername BuffName` is authoritative.
- Player-name placeholders use the Takaro player/game-server display name when available.
- Scheduled playtime rewards run hourly by default.
