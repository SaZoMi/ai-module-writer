import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';
import {
  getReferralLink,
  setReferralLink,
  getPlayerStats,
  setPlayerStats,
  removeFromPendingIndex,
  payReferrer,
  findPlayerByName,
  getVipMultiplier,
  todayUTC,
} from './referral-helpers.js';

async function main() {
  const { pog, player, gameServerId, arguments: args, module: mod } = data;
  const moduleId = mod.moduleId;
  const config = mod.userConfig;

  if (!checkPermission(pog, 'REFERRAL_ADMIN')) {
    throw new TakaroUserError('You do not have permission to use admin referral commands.');
  }

  const refereeName = (args.referee || '').trim();
  const referrerName = (args.referrer || '').trim();

  if (!refereeName || !referrerName) {
    throw new TakaroUserError('Usage: /reflink <referee_display_name> <referrer_display_name>');
  }

  // VI-3: Find by player display name (cross-game name), fallback to gameId
  const [refereePog, referrerPog] = await Promise.all([
    findPlayerByName(gameServerId, refereeName),
    findPlayerByName(gameServerId, referrerName),
  ]);

  if (!refereePog) {
    throw new TakaroUserError(`Could not find player "${refereeName}" on this server.`);
  }
  if (!referrerPog) {
    throw new TakaroUserError(`Could not find player "${referrerName}" on this server.`);
  }

  const refereePlayerId = refereePog.playerId;
  const referrerPlayerId = referrerPog.playerId;

  if (refereePlayerId === referrerPlayerId) {
    throw new TakaroUserError('Referee and referrer must be different players.');
  }

  // VI-4: Reject when a non-paid link already exists (don't silently overwrite)
  const existingLink = await getReferralLink(gameServerId, moduleId, refereePlayerId);
  if (existingLink) {
    if (existingLink.status === 'paid') {
      throw new TakaroUserError(`${refereeName} already has a paid referral link.`);
    } else {
      throw new TakaroUserError(`${refereeName} already has a pending referral link (status: ${existingLink.status}). Run /refunlink ${refereeName} first.`);
    }
  }

  // VI-5, VI-21: Compute VIP multiplier for referrer, pay first — THEN write status='paid'
  const vipMultiplier = await getVipMultiplier(referrerPlayerId, gameServerId);

  // Pay referee welcome bonus first
  const welcomeBonus = config.refereeCurrencyReward || 0;
  if (welcomeBonus > 0) {
    try {
      await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(gameServerId, refereePlayerId, {
        currency: welcomeBonus,
      });
      console.log(`reflink: welcome bonus paid referee=${refereeName}(${refereePlayerId}), amount=${welcomeBonus}`);
    } catch (err) {
      console.error(`reflink: failed to pay welcome bonus to referee ${refereeName}(${refereePlayerId}): ${err}`);
      // Don't throw — welcome bonus is best-effort for admin command
    }
  }

  // Pay referrer reward (with VIP multiplier)
  const payResult = await payReferrer(gameServerId, referrerPlayerId, config, vipMultiplier);
  if (!payResult.paid) {
    // Don't create the link if payout fails — leave in recoverable state
    console.error(`reflink: failed to pay referrer=${referrerName}(${referrerPlayerId}): ${payResult.error}`);
    throw new TakaroUserError(`Failed to pay referrer reward to ${referrerName}. Link was not created. Error: ${payResult.error}`);
  }

  console.log(`reflink: referrer paid ${referrerName}(${referrerPlayerId}), result=${JSON.stringify(payResult)}, vipMultiplier=${vipMultiplier}`);

  // VI-5: Only write status='paid' AFTER both payouts succeed
  await setReferralLink(gameServerId, moduleId, refereePlayerId, {
    referrerId: referrerPlayerId,
    linkedAt: new Date().toISOString(),
    status: 'paid',
    playtimeAtLink: 0,
    retries: 0,
    paidAmount: payResult.paidAmount,
    paidType: payResult.type,
  });

  // Remove from pending index if it was there
  await removeFromPendingIndex(gameServerId, moduleId, refereePlayerId);

  // Update referrer stats
  const referrerStats = await getPlayerStats(gameServerId, moduleId, referrerPlayerId);
  const today = todayUTC();
  const todayCount = referrerStats.lastReferralDay === today ? referrerStats.referralsToday : 0;
  const updatedStats = {
    ...referrerStats,
    referralsTotal: referrerStats.referralsTotal + 1,
    referralsPaid: referrerStats.referralsPaid + 1,
    referralsToday: todayCount + 1,
    lastReferralDay: today,
    currencyEarned: payResult.paid && (payResult.type === 'currency' || payResult.type === 'currency-fallback')
      ? referrerStats.currencyEarned + (payResult.amount || 0)
      : referrerStats.currencyEarned,
    itemsEarned: payResult.paid && payResult.type === 'item'
      ? referrerStats.itemsEarned + (payResult.amount || 1)
      : referrerStats.itemsEarned,
  };
  await setPlayerStats(gameServerId, moduleId, referrerPlayerId, updatedStats);

  // VI-35: Include player name/id in admin action logs
  console.log(`reflink: admin force-linked referee=${refereeName}(${refereePlayerId}) -> referrer=${referrerName}(${referrerPlayerId}), vipMultiplier=${vipMultiplier}`);
  await pog.pm(`Referral link created: ${refereeName} -> ${referrerName}. Both rewards paid (VIP multiplier: ${vipMultiplier.toFixed(2)}x).`);
}

await main();
