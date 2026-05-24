import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;
  const userConfig = mod.userConfig;
  const moduleId = mod.moduleId;
  const playerId = player?.id;

  async function varSearch(key) {
    const r = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] },
      page: { limit: 1 }
    });
    return r.data.data[0] || null;
  }

  if (!checkPermission(pog, 'MINIGAMES_PLAY')) {
    throw new TakaroUserError('You need MINIGAMES_PLAY permission.');
  }

  const category = data.arguments.category?.toLowerCase();

  if (!['points', 'wordle', 'hangman', 'streak'].includes(category)) {
    throw new TakaroUserError('Valid categories: points, wordle, hangman, streak');
  }

  const cacheV = await varSearch('minigames_leaderboard_cache');
  if (!cacheV) {
    await pog.pm('🏆 Leaderboard is being built. Check back in a few minutes!');
    return;
  }
  const cache = JSON.parse(cacheV.value);

  const keyMap = { points: 'topPoints', wordle: 'topWordle', hangman: 'topHangman', streak: 'topStreak' };
  const list = cache[keyMap[category]] || [];

  if (list.length === 0) {
    await pog.pm('🏆 No data for ' + category + ' leaderboard yet.');
    return;
  }

  const lines = ['🏆 Top ' + category + ':'];
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    let name = entry.playerId.slice(0, 8) + '...';
    try {
      const pr = await takaro.player.playerControllerGetOne(entry.playerId);
      name = pr.data.data?.name || name;
    } catch (e) { /* use fallback */ }
    const score = entry.points ?? entry.wins ?? entry.streak ?? 0;
    lines.push('  ' + (i + 1) + '. ' + name + ' — ' + score);
  }

  for (const line of lines) await pog.pm(line);
}

await main();
