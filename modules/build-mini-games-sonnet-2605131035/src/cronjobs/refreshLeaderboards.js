import { data, takaro } from '@takaro/helpers';

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.id;

  async function varSearchAll(keyPrefix) {
    const r = await takaro.variable.variableControllerSearch({
      filters: { gameServerId: [gameServerId], moduleId: [moduleId] },
      page: { limit: 200 }
    });
    return r.data.data.filter(v => v.key.startsWith(keyPrefix));
  }

  async function varSearch(key) {
    const r = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] },
      page: { limit: 1 }
    });
    return r.data.data[0] || null;
  }

  async function varCreate(key, val) {
    return takaro.variable.variableControllerCreate({ key, value: JSON.stringify(val), gameServerId, moduleId });
  }

  async function varUpdate(id, val) {
    return takaro.variable.variableControllerUpdate(id, { value: JSON.stringify(val) });
  }

  // Get all stats variables
  const allStats = await varSearchAll('minigames_stats:');

  const entries = [];
  for (const sv of allStats) {
    try {
      const s = JSON.parse(sv.value);
      const pid = sv.key.replace('minigames_stats:', '');
      entries.push({ playerId: pid, ...s });
    } catch (e) { /* skip malformed */ }
  }

  // Build leaderboards
  const topPoints = entries
    .sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0))
    .slice(0, 10)
    .map(e => ({ playerId: e.playerId, points: e.totalPoints || 0 }));

  const topWordle = entries
    .filter(e => e.perGame?.wordle)
    .sort((a, b) => (b.perGame.wordle.wins || 0) - (a.perGame.wordle.wins || 0))
    .slice(0, 10)
    .map(e => ({ playerId: e.playerId, wins: e.perGame.wordle.wins || 0 }));

  const topHangman = entries
    .filter(e => e.perGame?.hangman)
    .sort((a, b) => (b.perGame.hangman.wins || 0) - (a.perGame.hangman.wins || 0))
    .slice(0, 10)
    .map(e => ({ playerId: e.playerId, wins: e.perGame.hangman.wins || 0 }));

  const topStreak = entries
    .filter(e => e.streaks?.wordle)
    .sort((a, b) => (b.streaks.wordle.best || 0) - (a.streaks.wordle.best || 0))
    .slice(0, 10)
    .map(e => ({ playerId: e.playerId, streak: e.streaks.wordle.best || 0 }));

  const cache = { topPoints, topWordle, topHangman, topStreak, refreshedAt: new Date().toISOString() };

  const cacheV = await varSearch('minigames_leaderboard_cache');
  if (cacheV) await varUpdate(cacheV.id, cache);
  else await varCreate('minigames_leaderboard_cache', cache);
}

await main();
