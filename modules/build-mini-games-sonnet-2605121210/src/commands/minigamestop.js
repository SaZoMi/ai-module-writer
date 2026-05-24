import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId } = data;
  const moduleId = data.module.moduleId;

  const category = data.arguments.category ? data.arguments.category.toLowerCase().trim() : null;

  if (!category) {
    throw new TakaroUserError('Please provide a category. Valid categories: points, wordle, hangman, streak');
  }

  const validCategories = ['points', 'wordle', 'hangman', 'streak'];
  if (!validCategories.includes(category)) {
    await pog.pm('Valid categories: points, wordle, hangman, streak');
    return;
  }

  // Read leaderboard cache
  const cacheRes = await takaro.variable.variableControllerSearch({
    filters: { key: ['minigames_leaderboard_cache'], gameServerId: [gameServerId], moduleId: [moduleId] },
    page: 0,
    limit: 1,
  });

  if (cacheRes.data.data.length === 0) {
    await pog.pm('Leaderboard not yet computed. Try again in a few minutes.');
    return;
  }

  const cache = JSON.parse(cacheRes.data.data[0].value);

  let entries = [];
  let title = '';

  if (category === 'points') {
    entries = cache.topPoints || [];
    title = '🏆 Top 10 — Points';
  } else if (category === 'wordle') {
    entries = cache.topWordle || [];
    title = '🏆 Top 10 — Wordle';
  } else if (category === 'hangman') {
    entries = cache.topHangman || [];
    title = '🏆 Top 10 — Hangman';
  } else if (category === 'streak') {
    entries = cache.topStreak || [];
    title = '🏆 Top 10 — Streak';
  }

  if (!entries || entries.length === 0) {
    await pog.pm(`No leaderboard data for category "${category}" yet.`);
    return;
  }

  const formatNum = (n) => (n != null ? (n.toLocaleString ? n.toLocaleString() : String(n)) : '0');

  let lines = [title + ':'];
  entries.slice(0, 10).forEach((entry, idx) => {
    const rank = idx + 1;
    const name = entry.playerName || entry.name || 'Unknown';
    if (category === 'points') {
      lines.push(`${rank}. ${name} — ${formatNum(entry.points)} pts`);
    } else if (category === 'wordle') {
      lines.push(`${rank}. ${name} — ${entry.wins || 0} wins, ${formatNum(entry.points)} pts`);
    } else if (category === 'hangman') {
      lines.push(`${rank}. ${name} — ${entry.wins || 0} wins, ${formatNum(entry.points)} pts`);
    } else if (category === 'streak') {
      lines.push(`${rank}. ${name} — streak: ${entry.streak || 0} 🔥`);
    }
  });

  await pog.pm(lines.join('\n'));
}

await main();
