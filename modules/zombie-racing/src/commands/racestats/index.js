import { data, takaro, TakaroUserError } from '@takaro/helpers';
import { RACING_STATS_KEY, getRaceLabels } from './utils.js';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;
  const playerId = pog.playerId || player.id;
  const labels = getRaceLabels(mod.userConfig);
  const statsSearch = await takaro.variable.variableControllerSearch({
    filters: {
      key: [RACING_STATS_KEY],
      gameServerId: [gameServerId],
      moduleId: [mod.moduleId],
      playerId: [playerId],
    },
  });

  if (statsSearch.data.data.length === 0) {
    throw new TakaroUserError(`You do not have ${labels.raceName} stats yet. Place a bet and wait for a race to finish.`);
  }

  const stats = JSON.parse(statsSearch.data.data[0].value);
  const winRate = stats.totalBets > 0 ? Math.round((stats.wins / stats.totalBets) * 100) : 0;
  const net = (stats.totalWinnings || 0) - (stats.totalWagered || 0);
  await pog.pm(`${labels.raceName} stats for ${player.name}:`);
  await pog.pm(`Bets: ${stats.totalBets}, wins: ${stats.wins}, losses: ${stats.losses}, win rate: ${winRate}%.`);
  await pog.pm(`Wagered: ${stats.totalWagered}, winnings: ${stats.totalWinnings}, net: ${net}, biggest win: ${stats.biggestWin}.`);
  await pog.pm(`Favorite ${labels.racerTypeLabel}: ${stats.favoriteRacer || 'none'}.`);
  console.log(`racing:racestats player=${player.name} bets=${stats.totalBets} wins=${stats.wins} losses=${stats.losses} favorite=${stats.favoriteRacer || 'none'}`);
}

await main();
