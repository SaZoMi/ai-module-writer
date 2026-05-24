import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;
  const userConfig = mod.userConfig;
  const moduleId = mod.moduleId;
  const playerId = player?.id;

  if (!checkPermission(pog, 'MINIGAMES_MANAGE')) throw new TakaroUserError('You need MINIGAMES_MANAGE permission.');

  const days = data.arguments.days || 7;

  async function varSearch(key) {
    const r = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] },
      page: { limit: 1 }
    });
    return r.data.data[0] || null;
  }
  async function varSearchAll(keyPrefix) {
    const r = await takaro.variable.variableControllerSearch({
      filters: { gameServerId: [gameServerId], moduleId: [moduleId] },
      page: { limit: 200 }
    });
    return r.data.data.filter(v => v.key.startsWith(keyPrefix));
  }

  // Load leaderboard cache for aggregate data
  const cacheV = await varSearch('minigames_leaderboard_cache');
  if (!cacheV) {
    await pog.pm('No leaderboard data yet. Wait for the first refreshLeaderboards run.');
    return;
  }
  const cache = JSON.parse(cacheV.value);

  // Load all player stats to aggregate
  const allStats = await varSearchAll('minigames_stats:');
  let totalPoints = 0;
  let totalGames = 0;
  const perGameCounts = {};

  for (const sv of allStats) {
    try {
      const s = JSON.parse(sv.value);
      totalPoints += s.totalPoints || 0;
      totalGames += s.gamesPlayed || 0;
      for (const [game, d] of Object.entries(s.perGame || {})) {
        if (!perGameCounts[game]) perGameCounts[game] = { plays: 0, wins: 0 };
        perGameCounts[game].plays += d.plays || 0;
        perGameCounts[game].wins += d.wins || 0;
      }
    } catch (e) { /* skip */ }
  }

  const lines = ['miniGames Report (all-time):'];
  lines.push('  Total points awarded: ' + totalPoints);
  lines.push('  Total games played: ' + totalGames);
  lines.push('  Players with stats: ' + allStats.length);

  if (cache.topPoints?.length > 0) {
    lines.push('  Top 5 players by points:');
    for (let i = 0; i < Math.min(5, cache.topPoints.length); i++) {
      lines.push('    ' + (i+1) + '. ' + cache.topPoints[i].playerId.slice(0,8) + '... - ' + cache.topPoints[i].points + ' pts');
    }
  }

  if (Object.keys(perGameCounts).length > 0) {
    lines.push('  Per-game breakdown: ' + Object.entries(perGameCounts).map(([g, d]) => g + ':' + d.wins + ' wins').join(', '));
  }

  for (const line of lines) await pog.pm(line);
}

await main();
