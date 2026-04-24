import { data, TakaroUserError, checkPermission } from '@takaro/helpers';
import {
  getReferralLink,
  deleteReferralLink,
  getPlayerStats,
  setPlayerStats,
  findPlayerByName,
  todayUTC,
} from './referral-helpers.js';

async function main() {
  const { pog, player, gameServerId, arguments: args, module: mod } = data;
  const moduleId = mod.moduleId;

  if (!checkPermission(pog, 'REFERRAL_ADMIN')) {
    throw new TakaroUserError('You do not have permission to use admin referral commands.');
  }

  const refereeName = (args.referee || '').trim();
  if (!refereeName) {
    throw new TakaroUserError('Usage: /refunlink <referee_display_name>');
  }

  // VI-3: Find by player display name
  const refereePog = await findPlayerByName(gameServerId, refereeName);
  if (!refereePog) {
    throw new TakaroUserError(`Could not find player "${refereeName}" on this server.`);
  }

  const refereePlayerId = refereePog.playerId;

  const existingLink = await getReferralLink(gameServerId, moduleId, refereePlayerId);
  if (!existingLink) {
    throw new TakaroUserError(`${refereeName} does not have a referral link.`);
  }

  const referrerId = existingLink.referrerId;

  // Remove the link
  await deleteReferralLink(gameServerId, moduleId, refereePlayerId);

  // Decrement referrer stats
  const referrerStats = await getPlayerStats(gameServerId, moduleId, referrerId);
  const today = todayUTC();
  // Decrement referralsToday if the link was created today
  const linkedDay = existingLink.linkedAt ? existingLink.linkedAt.slice(0, 10) : null;
  const updatedStats = {
    ...referrerStats,
    referralsTotal: Math.max(0, referrerStats.referralsTotal - 1),
    referralsPaid: existingLink.status === 'paid'
      ? Math.max(0, referrerStats.referralsPaid - 1)
      : referrerStats.referralsPaid,
    referralsToday: linkedDay === today
      ? Math.max(0, (referrerStats.referralsToday || 0) - 1)
      : referrerStats.referralsToday,
  };

  // VI-17: Roll back currencyEarned when link was paid and paidAmount is stored
  if (existingLink.status === 'paid' && existingLink.paidAmount != null) {
    if (existingLink.paidType === 'currency' || existingLink.paidType === 'currency-fallback') {
      updatedStats.currencyEarned = Math.max(0, (referrerStats.currencyEarned || 0) - existingLink.paidAmount);
    } else if (existingLink.paidType === 'item') {
      updatedStats.itemsEarned = Math.max(0, (referrerStats.itemsEarned || 0) - existingLink.paidAmount);
    }
  }

  // VI-17: Decrement referralsRejected when removing a rejected link
  if (existingLink.status === 'rejected') {
    updatedStats.referralsRejected = Math.max(0, (referrerStats.referralsRejected || 0) - 1);
  }

  await setPlayerStats(gameServerId, moduleId, referrerId, updatedStats);

  // VI-35: Include player name/id in admin action logs
  console.log(`refunlink: admin removed link referee=${refereeName}(${refereePlayerId}), referrerId=${referrerId}, status was ${existingLink.status}`);
  await pog.pm(`Referral link for ${refereeName} has been removed.`);
}

await main();
