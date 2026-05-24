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

  let targetId = playerId;
  let targetName = player?.name || 'You';

  if (data.arguments.player) {
    try {
      const pr = await takaro.player.playerControllerSearch({
        filters: { name: [data.arguments.player] },
        page: { limit: 1 }
      });
      if (pr.data.data?.length > 0) {
        targetId = pr.data.data[0].id;
        targetName = pr.data.data[0].name;
      } else {
        throw new TakaroUserError('Player "' + data.arguments.player + '" not found.');
      }
    } catch (e) {
      if (e instanceof TakaroUserError) throw e;
      throw new TakaroUserError('Could not find player "' + data.arguments.player + '".');
    }
  }

  const statsV = await varSearch('minigames_stats:' + targetId);
  if (!statsV) {
    await pog.pm('📊 ' + targetName + ' has no stats yet. Play some games first!');
    return;
  }
  const s = JSON.parse(statsV.value);

  const today = new Date().toISOString().slice(0, 10);
  const windowV = await varSearch('minigames_window:' + targetId + ':' + today);
  const todayPts = windowV ? (JSON.parse(windowV.value).earned || 0) : 0;

  const lines = ['📊 Stats for ' + targetName + ':'];
  lines.push('  Total points: ' + (s.totalPoints || 0) + ' | Today: ' + todayPts);
  lines.push('  Games played: ' + (s.gamesPlayed || 0));
  if (s.biggestScore) lines.push('  Best score: ' + s.biggestScore.points + ' pts in ' + s.biggestScore.game);
  if (s.streaks?.wordle?.current > 0) lines.push('  Wordle streak: ' + s.streaks.wordle.current + ' days 🔥 (best: ' + s.streaks.wordle.best + ')');

  if (s.perGame && Object.keys(s.perGame).length > 0) {
    lines.push('  Per-game wins: ' + Object.entries(s.perGame).map(([g, d]) => g + ':' + (d.wins || 0)).join(', '));
  }

  for (const line of lines) await pog.pm(line);
}

await main();
