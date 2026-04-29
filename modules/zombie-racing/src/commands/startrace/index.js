import { data, takaro, checkPermission, TakaroUserError } from '@takaro/helpers';
import { completeRace, getRaceLabels } from './utils.js';

async function main() {
  const { pog, gameServerId, module: mod } = data;
  if (!checkPermission(pog, 'RACING_ADMIN')) {
    throw new TakaroUserError('You need racing admin permission to start races.');
  }

  const labels = getRaceLabels(mod.userConfig);
  const { result } = await completeRace(gameServerId, mod.moduleId, mod.userConfig);
  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: `${labels.raceName} #${result.raceNumber} finished. Winner: ${result.winner}.`,
    opts: {},
  });
  await pog.pm(`${labels.raceName} #${result.raceNumber} completed. ${result.totalBets} bets, ${result.totalPayout} paid out.`);
  console.log(`racing:startrace race=${result.raceNumber} winner=${result.winner} bets=${result.totalBets}`);
}

await main();
