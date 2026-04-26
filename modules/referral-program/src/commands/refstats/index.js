import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';
import {
  getPlayerStats,
  getReferralLink,
  DEFAULT_STATS,
} from './referral-helpers.js';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;
  const moduleId = mod.moduleId;
  const config = mod.userConfig;

  if (!checkPermission(pog, 'REFERRAL_USE')) {
    throw new TakaroUserError('You do not have permission to use the referral system.');
  }

  const [stats, myLink] = await Promise.all([
    getPlayerStats(gameServerId, moduleId, player.id),
    getReferralLink(gameServerId, moduleId, player.id),
  ]);

  // VI-19: Compute pending using referralsRejected
  const referralsRejected = stats.referralsRejected || 0;
  const pendingCount = Math.max(0, stats.referralsTotal - stats.referralsPaid - referralsRejected);

  const lines = [`=== Your Referral Stats ===`];
  lines.push(`Total referrals: ${stats.referralsTotal} (${stats.referralsPaid} paid, ${pendingCount} pending, ${referralsRejected} rejected)`);
  lines.push(`Currency earned: ${stats.currencyEarned}`);

  // VI-34: Show items-earned when prizeIsCurrency is false (remove !pog guard)
  if (!config.prizeIsCurrency || stats.itemsEarned > 0) {
    lines.push(`Items earned: ${stats.itemsEarned}`);
  }

  let referrerName = 'a player';
  if (myLink) {
    // Fetch referrer name
    try {
      const referrerRes = await takaro.player.playerControllerGetOne(myLink.referrerId);
      if (referrerRes.data.data && referrerRes.data.data.name) {
        referrerName = referrerRes.data.data.name;
      }
    } catch (err) {
      console.error(`refstats: failed to fetch referrer name for ${myLink.referrerId}: ${err}`);
    }

    // Surface user-friendly status labels to the referee
    let statusLabel;
    if (myLink.status === 'pending') {
      // Show playtime progress for pending links
      let progressMsg = '';
      try {
        const pogRes = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
          filters: { gameServerId: [gameServerId], playerId: [player.id] },
        });
        const myPog = pogRes.data.data[0];
        if (myPog) {
          const currentMinutes = (myPog.playtimeSeconds || 0) / 60;
          const gainedMinutes = Math.max(0, currentMinutes - (myLink.playtimeAtLink || 0));
          const threshold = config.playtimeThresholdMinutes || 60;
          progressMsg = ` (${gainedMinutes.toFixed(0)} / ${threshold} minutes played)`;
        }
      } catch (_) {}
      statusLabel = `pending${progressMsg}`;
    } else if (myLink.status === 'in-flight') {
      statusLabel = 'processing';
    } else if (myLink.status === 'paid') {
      statusLabel = 'completed';
    } else if (myLink.status === 'rejected') {
      // VI-9: Add recovery hint so referee knows what to do
      statusLabel = 'did not qualify — contact a server admin if you believe this is an error';
    } else {
      statusLabel = myLink.status;
    }

    lines.push(`You were referred by: ${referrerName} (link status: ${statusLabel})`);
  } else {
    lines.push(`You were referred by: nobody`);
  }

  const referrerInfo = myLink ? `referredBy=${referrerName}` : 'referredBy=none';
  console.log(`refstats: player=${player.name} referralsTotal=${stats.referralsTotal} referralsPaid=${stats.referralsPaid} currencyEarned=${stats.currencyEarned} ${referrerInfo}`);

  await pog.pm(lines.join('\n'));
}

await main();
