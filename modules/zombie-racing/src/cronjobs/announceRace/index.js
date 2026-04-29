import { data, takaro } from '@takaro/helpers';
import { getRaceData, getRaceLabels, getTimeUntilRace, parseEntrants } from './utils.js';

async function main() {
  const { gameServerId, module: mod } = data;
  const labels = getRaceLabels(mod.userConfig);
  const entrants = parseEntrants(mod.userConfig);
  const raceData = await getRaceData(gameServerId, mod.moduleId);
  const minBet = mod.userConfig?.minBet || 50;
  const maxBet = mod.userConfig?.maxBet || 1000;

  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: `${labels.raceName} #${raceData.raceNumber} begins in ${getTimeUntilRace(raceData.nextRaceTime)}. ${raceData.bets.length} bets placed.`,
    opts: {},
  });
  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: `Available ${labels.racerTypePluralLabel}: ${entrants.map((entrant) => `${entrant.name} (${entrant.odds}:1)`).join(', ')}`,
    opts: {},
  });
  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: `Use /racebet <${labels.racerTypeLabel}> <amount>. Bet range: ${minBet}-${maxBet}.`,
    opts: {},
  });
  console.log(`racing:announceRace race=${raceData.raceNumber} entrants=${entrants.length} bets=${raceData.bets.length}`);
}

await main();
