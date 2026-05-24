import { data, takaro, checkPermission, TakaroUserError } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;

  await checkPermission(pog, 'MINIGAMES_PLAY');

  const category = data.arguments.category;
  const validCategories = ['points', 'wordle', 'hangman', 'streak'];

  if (!category || !validCategories.includes(category.toLowerCase())) {
    throw new TakaroUserError(`Invalid category. Must be one of: ${validCategories.join(', ')}`);
  }

  const moduleId = mod.id;

  const r = await takaro.variable.variableControllerSearch({
    filters: { key: ['minigames_leaderboard_cache'], moduleId: [moduleId], gameServerId: [gameServerId] },
    limit: 1,
  });

  if (!r.data.data.length) {
    await pog.pm('Leaderboard is being calculated, try again in a moment.');
    return;
  }

  const cache = JSON.parse(r.data.data[0].value);

  const fieldMap = {
    points: 'topPoints',
    wordle: 'topWordle',
    hangman: 'topHangman',
    streak: 'topStreak',
  };

  const field = fieldMap[category.toLowerCase()];
  const entries = cache[field] || [];

  if (!entries.length) {
    await pog.pm(`🏆 Top ${category}: No data yet.`);
    return;
  }

  const lines = entries.slice(0, 10).map((e, i) => `#${i + 1} ${e.playerId} — ${e.value} pts`);
  await pog.pm(`🏆 Top ${category}:\n${lines.join('\n')}`);
}

await main();
