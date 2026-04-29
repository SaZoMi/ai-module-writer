import { data, takaro } from '@takaro/helpers';
import { completeRace, getRaceLabels } from './utils.js';

async function main() {
  const { gameServerId, module: mod } = data;
  const labels = getRaceLabels(mod.userConfig);
  const { result } = await completeRace(gameServerId, mod.moduleId, mod.userConfig);
  const topThree = (result.results || []).slice(0, 3).map((entrant, index) => `${index + 1}. ${entrant.name}`).join(', ');

  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: `${labels.raceName} #${result.raceNumber} is complete. Winner: ${result.winner}.`,
    opts: {},
  });
  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: `Final standings: ${topThree}.`,
    opts: {},
  });

  if (result.totalBets === 0) {
    await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
      message: `No bets were placed. Next ${labels.raceName} is in 2 hours.`,
      opts: {},
    });
  } else if (result.winners.length > 0) {
    await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
      message: `${result.winners.length} bettor${result.winners.length === 1 ? '' : 's'} won ${result.totalPayout} currency.`,
      opts: {},
    });
  } else {
    await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
      message: `Nobody bet on ${result.winner}. House wins this race.`,
      opts: {},
    });
  }

  console.log(`racing:runRace race=${result.raceNumber} winner=${result.winner} bets=${result.totalBets} payout=${result.totalPayout}`);
}

await main();
