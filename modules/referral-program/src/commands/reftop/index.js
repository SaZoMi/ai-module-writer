import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';
import { getAllStats } from './referral-helpers.js';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;
  const moduleId = mod.moduleId;
  const config = mod.userConfig;

  if (!checkPermission(pog, 'REFERRAL_USE')) {
    throw new TakaroUserError('You do not have permission to use the referral system.');
  }

  const allStats = await getAllStats(gameServerId, moduleId);

  if (allStats.length === 0) {
    await pog.pm('No referral data yet. Be the first to use /refcode and share your code!');
    console.log(`reftop: no stats yet for server=${gameServerId}`);
    return;
  }

  // Sort by referralsPaid descending, take top 10
  const sorted = allStats
    .filter((entry) => entry.stats.referralsPaid > 0)
    .sort((a, b) => b.stats.referralsPaid - a.stats.referralsPaid)
    .slice(0, 10);

  if (sorted.length === 0) {
    await pog.pm('No completed referrals yet. Referrers appear here once their referees hit the playtime threshold.');
    console.log(`reftop: no paid referrals yet`);
    return;
  }

  // VI-33: Resolve player names in parallel using Promise.all
  const nameResults = await Promise.all(
    sorted.map(async ({ playerId }) => {
      try {
        const res = await takaro.player.playerControllerGetOne(playerId);
        return (res.data.data && res.data.data.name) ? res.data.data.name : 'Unknown';
      } catch (err) {
        console.error(`reftop: failed to look up name for player ${playerId}: ${err}`);
        return 'Unknown';
      }
    }),
  );

  // VI-40: Switch display between currency earned and items earned based on config
  const earningLabel = config.prizeIsCurrency ? 'currency earned' : 'items earned';

  const lines = ['=== Top Referrers ==='];
  for (let i = 0; i < sorted.length; i++) {
    const { stats } = sorted[i];
    const name = nameResults[i];
    const earned = config.prizeIsCurrency ? stats.currencyEarned : stats.itemsEarned;
    lines.push(`#${i + 1} ${name} — ${stats.referralsPaid} paid referral(s), ${earned} ${earningLabel}`);
  }

  console.log(`reftop: showing top ${sorted.length} referrers`);
  await pog.pm(lines.join('\n'));
}

await main();
