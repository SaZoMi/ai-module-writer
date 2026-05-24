import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;

  if (!checkPermission(pog, 'MINIGAMES_PLAY')) {
    throw new TakaroUserError('You do not have permission to use this command.');
  }

  const category = data.arguments.category;

  if (!category) {
    throw new TakaroUserError('Please provide a category: points, wordle, hangman, or streak');
  }

  // Helper to get a variable
  async function getVar(key) {
    const res = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId] }
    });
    if (res.data.data.length === 0) return null;
    return { id: res.data.data[0].id, value: JSON.parse(res.data.data[0].value) };
  }

  // Read leaderboard cache
  const cacheVar = await getVar('minigames_leaderboard_cache');

  if (!cacheVar) {
    await pog.pm('Leaderboards are being computed, try again shortly.');
    return;
  }

  const cache = cacheVar.value;

  // Check freshness (optional: consider stale if older than 10 minutes)
  if (cache.refreshedAt) {
    const refreshedAt = new Date(cache.refreshedAt).getTime();
    const now = Date.now();
    const tenMinutes = 10 * 60 * 1000;
    if (now - refreshedAt > tenMinutes) {
      await pog.pm('Leaderboards are being computed, try again shortly.');
      return;
    }
  }

  const validCategories = ['points', 'wordle', 'hangman', 'streak'];
  const lowerCategory = category.toLowerCase();

  if (!validCategories.includes(lowerCategory)) {
    throw new TakaroUserError('Category must be: points, wordle, hangman, or streak');
  }

  let entries;
  let label;
  let valueLabel;

  switch (lowerCategory) {
    case 'points':
      entries = cache.topPoints || [];
      label = 'Top Players — Points';
      valueLabel = 'pts';
      break;
    case 'wordle':
      entries = cache.topWordle || [];
      label = 'Top Players — Wordle';
      valueLabel = 'wins';
      break;
    case 'hangman':
      entries = cache.topHangman || [];
      label = 'Top Players — Hangman';
      valueLabel = 'wins';
      break;
    case 'streak':
      entries = cache.topStreak || [];
      label = 'Top Players — Streak';
      valueLabel = 'streak';
      break;
  }

  if (!entries || entries.length === 0) {
    await pog.pm(`No leaderboard data available for category: ${lowerCategory}`);
    return;
  }

  const lines = [`Leaderboard — ${label}:`];
  const top10 = entries.slice(0, 10);

  for (let i = 0; i < top10.length; i++) {
    const entry = top10[i];
    lines.push(`${i + 1}. ${entry.playerId} — ${entry.value} ${valueLabel}`);
  }

  await pog.pm(lines.join('\n'));
}

await main();
