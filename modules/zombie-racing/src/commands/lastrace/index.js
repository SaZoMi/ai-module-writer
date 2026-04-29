import { data, TakaroUserError } from '@takaro/helpers';
import { getRaceData, getRaceLabels } from './utils.js';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;
  const labels = getRaceLabels(mod.userConfig);
  const raceData = await getRaceData(gameServerId, mod.moduleId);

  if (!raceData.lastRaceResults) {
    throw new TakaroUserError(`No completed ${labels.raceName} results are available yet.`);
  }

  const result = raceData.lastRaceResults;
  const playerId = pog.playerId || player.id;
  const playerBets = (result.bets || []).filter((bet) => bet.playerId === playerId);
  const playerWin = (result.winners || []).find((bet) => bet.playerId === playerId);

  await pog.pm(`${labels.raceName} #${result.raceNumber} winner: ${result.winner}.`);
  await pog.pm(`Final standings: ${(result.results || []).slice(0, 3).map((entrant, index) => `${index + 1}. ${entrant.name}`).join(', ')}.`);
  await pog.pm(`Race stats: ${result.totalBets || 0} bets, ${result.totalWagered || 0} wagered, ${result.totalPayout || 0} paid out.`);
  if (playerWin) {
    await pog.pm(`You won ${playerWin.payout} with your ${playerWin.amount} bet on ${playerWin.racer}.`);
  } else if (playerBets.length > 0) {
    await pog.pm(`Your ${playerBets.length} bet${playerBets.length === 1 ? '' : 's'} did not win this race.`);
  } else {
    await pog.pm('You did not place a bet in this race.');
  }
  console.log(`racing:lastrace race=${result.raceNumber} totalBets=${result.totalBets || 0}`);
}

await main();
