import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.id;

  async function getVar(key) {
    const res = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId] }
    });
    if (res.data.data.length === 0) return null;
    return { id: res.data.data[0].id, value: JSON.parse(res.data.data[0].value) };
  }

  async function setVar(key, value) {
    const existing = await getVar(key);
    if (existing) {
      await takaro.variable.variableControllerUpdate(existing.id, { value: JSON.stringify(value) });
    } else {
      await takaro.variable.variableControllerCreate({ key, value: JSON.stringify(value), gameServerId, moduleId });
    }
  }

  // Search for all stats variables
  const statsRes = await takaro.variable.variableControllerSearch({
    filters: { gameServerId: [gameServerId] },
    search: { key: ['minigames_stats:'] },
    sortBy: 'key',
    limit: 200
  });

  const statsVars = statsRes.data.data || [];

  // Build a list of { playerId, stats } from each variable
  const playerStats = statsVars.map((variable) => {
    const playerId = variable.key.replace('minigames_stats:', '');
    let stats = {};
    try {
      stats = JSON.parse(variable.value);
    } catch (e) {
      stats = {};
    }
    return { playerId, stats };
  });

  // topPoints: sort by totalPoints desc, take top 10
  const topPoints = [...playerStats]
    .sort((a, b) => (b.stats.totalPoints ?? 0) - (a.stats.totalPoints ?? 0))
    .slice(0, 10)
    .map(({ playerId, stats }) => ({ playerId, totalPoints: stats.totalPoints ?? 0 }));

  // topWordle: sort by wordle wins desc, take top 10
  const topWordle = [...playerStats]
    .sort((a, b) => (b.stats.perGame?.wordle?.wins ?? 0) - (a.stats.perGame?.wordle?.wins ?? 0))
    .slice(0, 10)
    .map(({ playerId, stats }) => ({ playerId, wordleWins: stats.perGame?.wordle?.wins ?? 0 }));

  // topHangman: sort by hangman wins desc, take top 10
  const topHangman = [...playerStats]
    .sort((a, b) => (b.stats.perGame?.hangman?.wins ?? 0) - (a.stats.perGame?.hangman?.wins ?? 0))
    .slice(0, 10)
    .map(({ playerId, stats }) => ({ playerId, hangmanWins: stats.perGame?.hangman?.wins ?? 0 }));

  // topStreak: sort by best wordle streak desc, take top 10
  const topStreak = [...playerStats]
    .sort((a, b) => (b.stats.streaks?.wordle?.best ?? 0) - (a.stats.streaks?.wordle?.best ?? 0))
    .slice(0, 10)
    .map(({ playerId, stats }) => ({ playerId, bestStreak: stats.streaks?.wordle?.best ?? 0 }));

  // Write leaderboard cache
  await setVar('minigames_leaderboard_cache', {
    topPoints,
    topWordle,
    topHangman,
    topStreak,
    refreshedAt: new Date().toISOString()
  });
}

await main();
