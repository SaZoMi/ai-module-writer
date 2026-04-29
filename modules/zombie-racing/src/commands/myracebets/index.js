import { data, TakaroUserError } from '@takaro/helpers';
import { getRaceData, getRaceLabels } from './utils.js';

async function main() {
  try {
    const { pog, player, gameServerId, module: mod } = data;
    const labels = getRaceLabels(mod.userConfig);
    const raceData = await getRaceData(gameServerId, mod.moduleId);
    const playerId = pog.playerId || player.id;
    const playerBets = raceData.bets.filter((bet) => bet.playerId === playerId);

    if (playerBets.length === 0) {
      await pog.pm(`You have not placed any bets for ${labels.raceName} #${raceData.raceNumber}.`);
      await pog.pm(`Use /racebet <${labels.racerTypeLabel}> <amount> to place a bet.`);
      console.log(`racing:myracebets player=${player.name} bets=0`);
      return;
    }

    let totalPotential = 0;
    await pog.pm(`Your bets for ${labels.raceName} #${raceData.raceNumber}:`);
    for (const bet of playerBets) {
      const potential = Math.floor(bet.amount * bet.odds);
      totalPotential += potential;
      await pog.pm(`${bet.racer}: ${bet.amount} bet, potential win ${potential}.`);
    }
    await pog.pm(`Total potential winnings: ${totalPotential}.`);
    console.log(`racing:myracebets player=${player.name} bets=${playerBets.length} racers=${playerBets.map((bet) => bet.racer).join('|')} potential=${totalPotential}`);
  } catch (err) {
    console.error(`racing:myracebets failed: ${err}`);
    throw new TakaroUserError('Unable to load your race bets. Please try again.');
  }
}

await main();
