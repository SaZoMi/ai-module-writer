# Issue #43: Dynamic Racing Module Repair

## Summary
Fix GitHub issue #43 by importing the attached `ZombieRacing` Takaro export into `modules/zombie-racing`, repairing runtime breakages, and turning it into a configurable racing module where admins can theme entrants as zombies, horses, or another racer type. Execute with `player-coach` settings: 15 turns, severity threshold 3, PR + CI enabled.

## Key Changes
- Import the issue attachment into local module structure using the existing JSON-to-module workflow, targeting `modules/zombie-racing`.
- Standardize module behavior around generic "racers" while preserving sensible defaults for zombies:
  - Config fields: `racerTypeLabel`, `racerTypePluralLabel`, `raceName`, `entrants`, `minBet`, `maxBet`.
  - Entrants remain editable as one string per line/array item using `Name; Odds`.
  - Runtime should tolerate legacy `Zombies` and `Horses` config by falling back to them if `entrants` is absent.
- Repair broken public command/API surfaces:
  - Use command triggers consistently: `racers`, `racebet`, `myracebets`, `racestats`, `raceleaderboard`, `nextrace`, `lastrace`, `startrace`.
  - Keep command arguments aligned with code: `racebet <racer> <amount>`.
  - Use permissions that match code and metadata: `RACING_BET` and `RACING_ADMIN`.
  - Update descriptions/help text so they no longer mention horse-only behavior unless configured labels do.
- Consolidate duplicated race-state logic into helper functions in the module's `utils` function:
  - parse entrants, find entrant, get/update race data, simulate weighted race, format labels/messages, update stats, jackpot handling.
  - Use one race variable key for this module and avoid cross-module/global state collisions.
- Remove or disable the placeholder `test` log hook unless it is needed for a real behavior; do not ship placeholder regex/function metadata.
- Fix known logic bugs from inspection:
  - `zombieBet` currently reads `args.zombie` but metadata defines `horse`; make this `args.racer`.
  - Config currently defines `Horses` while code reads `Zombies`; replace with `entrants` plus legacy fallback.
  - `nextRace` reads `bet.horse`; use the canonical bet racer field.
  - `lastRace` calculates player losing bets and total bets from winners only; store/read full race bet count and player bets in race results.
  - Remove `setTimeout` delays from command execution; use immediate sequential messages suitable for Takaro function runtime.

## Tests And Verification
- Add real Takaro API integration tests under `modules/zombie-racing/test/`.
- Test module import/install with custom config:
  - zombie-themed defaults work.
  - horse-themed config changes visible command output and entrant names.
  - legacy `Zombies` or `Horses` config still parses if `entrants` is missing.
- Test command/cron flow through real API:
  - `racers` lists configured entrants and bet limits.
  - `racebet <racer> <amount>` validates permissions, entrant names, min/max amount, and currency balance.
  - replacing an existing bet refunds the previous wager.
  - `myracebets`, `nextrace`, `lastrace`, `racestats`, and `raceleaderboard` return useful output without runtime errors.
  - `runRace` pays winners, records last race, clears current bets, advances race number, and updates player stats.
  - no-bet races complete successfully without payouts.
- Run required verification:
  - `npm run build`
  - targeted module tests if available, otherwise `npm test`
  - `scripts/module-push.sh modules/zombie-racing` after build
  - mandatory in-game verification with Paper + bot service: start `paper bot redis`, create at least one bot, trigger commands in Minecraft, verify command/cron execution events and messages.

## Player-Coach Execution
- Start player-coach with:
  - max turns: `15`
  - severity threshold: `3`
  - PR + CI: enabled
- Every turn must run `/verify --mode=report-only --scope=branch`.
- Approval is blocked unless the exerciser runs and passes.
- After local verification passes, create/update the PR and monitor CI; CI failures consume remaining turns.

## Assumptions
- The attached issue JSON is the source of truth for the initial module.
- The final module remains named `zombie-racing` locally for issue traceability, while its runtime labels are configurable.
- We will not add mocked unit tests or `globalThis.__mocks`; tests must use the real Takaro API pattern already used in this repo.

## Turn 4 Notes
- Addressed verification feedback by making `racebet` persist race state before the final net currency adjustment and restore the prior race state if that adjustment fails.
- Kept replacement-bet refund coverage by changing the targeted test to replace a 250 wager with a 100 wager and assert the refund path.
- Confirmed `module.json` has the corrected `announceRace` and `runRace` cron schedules in the working tree before staging.
