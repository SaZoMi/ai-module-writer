import { data, TakaroUserError } from '@takaro/helpers';
import { getRaceData, getRaceLabels, getTimeUntilRace, parseEntrants } from './utils.js';

async function main() {
  try {
    const { pog, gameServerId, module: mod } = data;
    const labels = getRaceLabels(mod.userConfig);
    const entrants = parseEntrants(mod.userConfig);
    const raceData = await getRaceData(gameServerId, mod.moduleId);
    const minBet = mod.userConfig?.minBet || 50;
    const maxBet = mod.userConfig?.maxBet || 1000;

    await pog.pm(`${labels.raceName}: Race #${raceData.raceNumber} starts in ${getTimeUntilRace(raceData.nextRaceTime)}.`);
    await pog.pm(`Available ${labels.racerTypePluralLabel}:`);
    for (const entrant of entrants) {
      const betCount = raceData.bets.filter((bet) => bet.racer.toLowerCase() === entrant.name.toLowerCase()).length;
      await pog.pm(`${entrant.name} - ${entrant.odds}:1 odds${betCount > 0 ? ` (${betCount} bets)` : ''}`);
    }
    await pog.pm(`Bet range: ${minBet}-${maxBet}. Use /racebet <${labels.racerTypeLabel}> <amount>.`);
    console.log(`racing:racers raceName="${labels.raceName}" label=${labels.racerTypePluralLabel} entrants=${entrants.map((entrant) => `${entrant.name}:${entrant.odds}`).join('|')} minBet=${minBet} maxBet=${maxBet} bets=${raceData.bets.length}`);
  } catch (err) {
    console.error(`racing:racers failed: ${err}`);
    throw new TakaroUserError('Unable to load race information. Please try again.');
  }
}

await main();
