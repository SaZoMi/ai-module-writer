import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const moduleId = data.module.moduleId;
  const { gameServerId } = data;

  async function readVar(key) {
    const res = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] },
      page: 0, limit: 1
    });
    return res.data.data.length > 0 ? { id: res.data.data[0].id, value: JSON.parse(res.data.data[0].value) } : null;
  }

  async function writeVar(key, value, existingId) {
    if (existingId) {
      await takaro.variable.variableControllerUpdate(existingId, { value: JSON.stringify(value) });
    } else {
      await takaro.variable.variableControllerCreate({ key, value: JSON.stringify(value), gameServerId, moduleId });
    }
  }

  // Fetch all minigames_stats:* variables
  const allStatsRes = await takaro.variable.variableControllerSearch({
    filters: { gameServerId: [gameServerId], moduleId: [moduleId] },
    search: { key: ['minigames_stats:'] },
    page: 0, limit: 200
  });

  const allStats = allStatsRes.data.data.map(v => {
    const stats = JSON.parse(v.value);
    // Extract playerId from key: minigames_stats:{playerId}
    const playerId = v.key.replace('minigames_stats:', '');
    return { playerId, ...stats };
  });

  // Sort by totalPoints descending → topPoints (top 10)
  const topPoints = [...allStats]
    .sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0))
    .slice(0, 10)
    .map(({ playerId, totalPoints, perGame, streaks }) => ({ playerId, totalPoints, perGame, streaks }));

  // Sort by perGame.wordle.wins descending → topWordle (top 10)
  const topWordle = [...allStats]
    .sort((a, b) => ((b.perGame && b.perGame.wordle && b.perGame.wordle.wins) || 0) - ((a.perGame && a.perGame.wordle && a.perGame.wordle.wins) || 0))
    .slice(0, 10)
    .map(({ playerId, totalPoints, perGame, streaks }) => ({ playerId, totalPoints, perGame, streaks }));

  // Sort by perGame.hangman.wins descending → topHangman (top 10)
  const topHangman = [...allStats]
    .sort((a, b) => ((b.perGame && b.perGame.hangman && b.perGame.hangman.wins) || 0) - ((a.perGame && a.perGame.hangman && a.perGame.hangman.wins) || 0))
    .slice(0, 10)
    .map(({ playerId, totalPoints, perGame, streaks }) => ({ playerId, totalPoints, perGame, streaks }));

  // Sort by streaks.wordle.best descending → topStreak (top 10)
  const topStreak = [...allStats]
    .sort((a, b) => ((b.streaks && b.streaks.wordle && b.streaks.wordle.best) || 0) - ((a.streaks && a.streaks.wordle && a.streaks.wordle.best) || 0))
    .slice(0, 10)
    .map(({ playerId, totalPoints, perGame, streaks }) => ({ playerId, totalPoints, perGame, streaks }));

  const leaderboardData = {
    topPoints,
    topWordle,
    topHangman,
    topStreak,
    refreshedAt: new Date().toISOString()
  };

  const existing = await readVar('minigames_leaderboard_cache');
  await writeVar('minigames_leaderboard_cache', leaderboardData, existing ? existing.id : null);
}

await main();
