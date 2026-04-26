import { data, TakaroUserError, checkPermission } from '@takaro/helpers';
import { getVariable, findPlayerByName, todayUTC } from './mini-games-helpers.js';

async function main() {
  const { pog, player, gameServerId, arguments: args, module: mod } = data;

  if (!checkPermission(pog, 'MINIGAMES_PLAY')) {
    throw new TakaroUserError('You do not have permission to use mini-games.');
  }

  const moduleId = mod.moduleId;
  let targetPlayerId = pog.playerId;
  let targetName = player.name;

  // 'self' is the defaultValue used when no player arg is provided (show own stats)
  if (args.player && args.player !== 'self') {
    const found = await findPlayerByName(gameServerId, args.player);
    if (!found) {
      throw new TakaroUserError(`Player "${args.player}" not found.`);
    }
    targetPlayerId = found.id;
    targetName = found.name;
  }

  const stats = await getVariable(gameServerId, moduleId, `minigames_stats:${targetPlayerId}`);
  const today = todayUTC();
  const window = await getVariable(gameServerId, moduleId, `minigames_window:${targetPlayerId}:${today}`);

  if (!stats) {
    await pog.pm(`📊 ${targetName} has no mini-games stats yet. Play some games!`);
    return;
  }

  const perGame = stats.perGame ?? {};
  const lines = [
    `📊 Stats for ${targetName}`,
    `─────────────────────────────────────`,
    `Total points: ${stats.totalPoints ?? 0}  |  Games played: ${stats.gamesPlayed ?? 0}`,
    `Today's points: ${window?.earned ?? 0}`,
    `Best score: ${stats.biggestScore?.points ?? 0} pts (${stats.biggestScore?.game ?? 'n/a'})`,
    `Wordle streak: ${stats.streaks?.wordle?.current ?? 0} (best: ${stats.streaks?.wordle?.best ?? 0})`,
    `─────────────────────────────────────`,
  ];

  const gameOrder = ['wordle', 'hangman', 'hotcold', 'trivia', 'scramble', 'mathrace', 'reactionrace'];
  for (const g of gameOrder) {
    const gStats = perGame[g];
    if (gStats) {
      lines.push(`${g}: ${gStats.wins ?? 0}W / ${gStats.plays ?? 0}P — ${gStats.points ?? 0} pts`);
    }
  }

  await pog.pm(lines.join('\n'));
}

await main();
