import { data, TakaroUserError } from '@takaro/helpers';
import { getRaceData, getRaceLabels, getTimeUntilRace } from './utils.js';

async function main() {
  try {
    const { pog, player, gameServerId, module: mod } = data;
    const labels = getRaceLabels(mod.userConfig);
    const raceData = await getRaceData(gameServerId, mod.moduleId);
    const playerId = pog.playerId || player.id;
    const playerBets = raceData.bets.filter((bet) => bet.playerId === playerId);

    await pog.pm(`${labels.raceName} #${raceData.raceNumber} begins in ${getTimeUntilRace(raceData.nextRaceTime)}.`);
    await pog.pm(`${raceData.bets.length} total bet${raceData.bets.length === 1 ? '' : 's'} have been placed.`);
    if (playerBets.length > 0) {
      for (const bet of playerBets) {
        await pog.pm(`Your bet: ${bet.racer} for ${bet.amount} (potential win ${Math.floor(bet.amount * bet.odds)}).`);
      }
    } else {
      await pog.pm(`You have no bets yet. Use /racebet <${labels.racerTypeLabel}> <amount>.`);
    }
    console.log(`racing:nextrace race=${raceData.raceNumber} bets=${raceData.bets.length} playerBets=${playerBets.map((bet) => `${bet.racer}:${bet.amount}`).join('|')}`);
  } catch (err) {
    console.error(`racing:nextrace failed: ${err}`);
    throw new TakaroUserError('Unable to load the next race. Please try again.');
  }
}

await main();
