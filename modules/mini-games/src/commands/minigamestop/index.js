import { data, TakaroUserError, checkPermission } from '@takaro/helpers';
import { getVariable } from './mini-games-helpers.js';

async function main() {
  const { pog, gameServerId, arguments: args, module: mod } = data;

  if (!checkPermission(pog, 'MINIGAMES_PLAY')) {
    throw new TakaroUserError('You do not have permission to use mini-games.');
  }

  const moduleId = mod.moduleId;
  const category = args.category ? args.category.toLowerCase() : null;

  if (!category || !['points', 'wordle', 'hangman', 'streak'].includes(category)) {
    throw new TakaroUserError('Usage: /minigamestop <points|wordle|hangman|streak>');
  }

  const cache = await getVariable(gameServerId, moduleId, 'minigames_leaderboard_cache');

  if (!cache) {
    await pog.pm('📊 Leaderboard not yet generated. Wait a few minutes for the cache to refresh.');
    return;
  }

  const keyMap = {
    points: 'topPoints',
    wordle: 'topWordle',
    hangman: 'topHangman',
    streak: 'topStreak',
  };

  const board = cache[keyMap[category]] ?? [];

  if (board.length === 0) {
    await pog.pm(`📊 No entries in the ${category} leaderboard yet.`);
    return;
  }

  const labelMap = {
    points: '🏆 Top Players by Total Points',
    wordle: '🟩 Top Wordle Players',
    hangman: '🎪 Top Hangman Players',
    streak: '🔥 Top Wordle Streaks',
  };

  const lines = [labelMap[category]];
  board.forEach((entry, i) => {
    lines.push(`  ${i + 1}. ${entry.name}: ${entry.value}`);
  });
  lines.push(`Refreshed: ${cache.refreshedAt ?? 'unknown'}`);

  await pog.pm(lines.join('\n'));
}

await main();
