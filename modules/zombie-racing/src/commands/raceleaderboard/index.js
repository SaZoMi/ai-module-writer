import { data, takaro, TakaroUserError } from '@takaro/helpers';
import { RACING_STATS_KEY, getRaceLabels } from './utils.js';

async function main() {
  const { pog, gameServerId, module: mod } = data;
  const labels = getRaceLabels(mod.userConfig);
  const statsSearch = await takaro.variable.variableControllerSearch({
    filters: {
      key: [RACING_STATS_KEY],
      gameServerId: [gameServerId],
      moduleId: [mod.moduleId],
    },
    limit: 100,
  });

  const allStats = [];
  for (const statVar of statsSearch.data.data) {
    try {
      const stats = JSON.parse(statVar.value);
      allStats.push({
        playerName: stats.playerName || statVar.playerId,
        totalBets: stats.totalBets || 0,
        wins: stats.wins || 0,
        net: (stats.totalWinnings || 0) - (stats.totalWagered || 0),
        biggestWin: stats.biggestWin || 0,
      });
    } catch (err) {
      console.error(`racing:raceleaderboard skipped bad stat ${statVar.id}: ${err}`);
    }
  }

  if (allStats.length === 0) {
    throw new TakaroUserError(`No ${labels.raceName} statistics are available yet.`);
  }

  allStats.sort((a, b) => b.net - a.net || b.wins - a.wins);
  await pog.pm(`${labels.raceName} leaderboard:`);
  for (const [index, stats] of allStats.slice(0, 10).entries()) {
    const winRate = stats.totalBets > 0 ? Math.round((stats.wins / stats.totalBets) * 100) : 0;
    await pog.pm(`${index + 1}. ${stats.playerName}: net ${stats.net}, ${stats.wins}/${stats.totalBets} wins (${winRate}%), biggest win ${stats.biggestWin}.`);
  }
  console.log(`racing:raceleaderboard rows=${allStats.length}`);
}

await main();
