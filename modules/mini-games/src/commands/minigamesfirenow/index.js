import { data, TakaroUserError, checkPermission } from '@takaro/helpers';
import {
  setVariable, getActiveRound, buildAndFireLiveRound,
} from './mini-games-helpers.js';

async function main() {
  const { pog, gameServerId, arguments: args, module: mod } = data;

  if (!checkPermission(pog, 'MINIGAMES_MANAGE')) {
    throw new TakaroUserError('You do not have permission to manage mini-games.');
  }

  const moduleId = mod.moduleId;
  const config = mod.userConfig;
  const forcedGame = args.game ? args.game.toLowerCase() : null;

  // Check if a round is already active
  const existing = await getActiveRound(gameServerId, moduleId);
  if (existing) {
    throw new TakaroUserError('A live round is already active! Use /minigamesskiproundnow to cancel it first.');
  }

  const round = await buildAndFireLiveRound(gameServerId, moduleId, config, forcedGame);
  if (!round) {
    // buildAndFireLiveRound already sent an admin chat warning for empty banks
    // (deduped per-day per-key). Send a personal PM so this admin always gets
    // feedback without re-broadcasting a global warning.
    const gameLabel = forcedGame ? ` game=${forcedGame}` : '';
    await pog.pm(`⚠️ miniGames: could not fire${gameLabel} — content bank may be empty or all games disabled. Check the Variables tab.`);
    return;
  }

  await setVariable(gameServerId, moduleId, 'minigames_last_round_firedAt', new Date().toISOString());
  console.log(`miniGames minigamesfirenow: fired game=${round.game}`);
}

await main();
