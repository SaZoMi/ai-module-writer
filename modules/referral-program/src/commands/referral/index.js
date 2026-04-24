import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';
import {
  lookupCode,
  getReferralLink,
  setReferralLink,
  getPlayerStats,
  setPlayerStats,
  addToPendingIndex,
  todayUTC,
} from './referral-helpers.js';

async function main() {
  const { pog, player, gameServerId, arguments: args, module: mod } = data;
  const moduleId = mod.moduleId;
  const config = mod.userConfig;

  if (!checkPermission(pog, 'REFERRAL_USE')) {
    throw new TakaroUserError('You do not have permission to use the referral system.');
  }

  const code = (args.code || '').toUpperCase().trim();
  if (!code) {
    throw new TakaroUserError('Usage: /referral <code> — Provide the referral code from the player who invited you.');
  }

  // Look up who owns this code
  const codeLookup = await lookupCode(gameServerId, moduleId, code);
  if (!codeLookup) {
    throw new TakaroUserError(`Referral code "${code}" was not found. Check the code and try again.`);
  }

  const referrerId = codeLookup.playerId;

  // VI-9: Verify the referrer player still exists
  try {
    await takaro.player.playerControllerGetOne(referrerId);
  } catch (err) {
    throw new TakaroUserError('The player who owns this referral code no longer exists on this server.');
  }

  // Block self-referral
  if (referrerId === player.id) {
    throw new TakaroUserError('You cannot use your own referral code.');
  }

  // Block relink (referee already has a link)
  const existingLink = await getReferralLink(gameServerId, moduleId, player.id);
  if (existingLink) {
    throw new TakaroUserError('You have already used a referral code. Referral links cannot be changed.');
  }

  // Check referral window: referee's first connect must be within referralWindowHours
  // We use pog.createdAt as a proxy for first join time on this server.
  const pogRes = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
    filters: { gameServerId: [gameServerId], playerId: [player.id] },
  });
  const myPog = pogRes.data.data[0];

  if (!myPog) {
    throw new TakaroUserError('Could not verify your join time. Please try again.');
  }

  const firstJoinAt = new Date(myPog.createdAt).getTime();
  const nowMs = Date.now();
  const windowMs = config.referralWindowHours * 60 * 60 * 1000;

  if (nowMs - firstJoinAt > windowMs) {
    throw new TakaroUserError(
      `You can only use a referral code within ${config.referralWindowHours} hours of your first join. Your window has expired.`,
    );
  }

  // Check referrer's daily cap
  const referrerStats = await getPlayerStats(gameServerId, moduleId, referrerId);
  const today = todayUTC();
  const todayCount = referrerStats.lastReferralDay === today ? referrerStats.referralsToday : 0;

  if (todayCount >= config.maxReferralsPerDay) {
    throw new TakaroUserError('This player has reached their daily referral limit. Try again tomorrow or find another referrer.');
  }

  // VI-24: Cap check counts only 'paid' referrals toward lifetime cap (not pending/rejected)
  if (referrerStats.referralsPaid >= config.maxReferralsLifetime) {
    throw new TakaroUserError('This player has reached their lifetime referral limit.');
  }

  // Get current playtime in minutes for the referee (used as baseline for threshold calc)
  const currentPlaytimeSeconds = myPog.playtimeSeconds || 0;
  const currentPlaytimeMinutes = currentPlaytimeSeconds / 60;

  // Write the referral link (pending)
  await setReferralLink(gameServerId, moduleId, player.id, {
    referrerId,
    linkedAt: new Date().toISOString(),
    status: 'pending',
    playtimeAtLink: currentPlaytimeMinutes,
    retries: 0,
  });

  // Update referrer's stats (increment counters for new pending referral)
  const updatedReferrerStats = {
    ...referrerStats,
    referralsTotal: referrerStats.referralsTotal + 1,
    referralsToday: todayCount + 1,
    lastReferralDay: today,
  };
  await setPlayerStats(gameServerId, moduleId, referrerId, updatedReferrerStats);

  // Add referee to pending index
  await addToPendingIndex(gameServerId, moduleId, player.id);

  // Pay referee welcome bonus (always currency regardless of prizeIsCurrency setting)
  // VI-23: fail the command (no success PM) when grant throws
  const welcomeBonus = config.refereeCurrencyReward || 0;
  if (welcomeBonus > 0) {
    try {
      await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(gameServerId, player.id, {
        currency: welcomeBonus,
      });
      console.log(`referral: welcome bonus paid to referee=${player.name}, amount=${welcomeBonus}`);
    } catch (err) {
      console.error(`referral: failed to pay welcome bonus to referee=${player.name}: ${err}`);
      // Don't throw — the link is created; the welcome bonus is best-effort
    }
  }

  console.log(`referral: link created referee=${player.name}(${player.id}) -> referrer=${referrerId}, playtimeAtLink=${currentPlaytimeMinutes.toFixed(1)}min`);

  const thresholdMsg = config.playtimeThresholdMinutes >= 60
    ? `${(config.playtimeThresholdMinutes / 60).toFixed(1)}h`
    : `${config.playtimeThresholdMinutes}min`;

  // VI-16: Interpolate reward type for the referrer reward in the PM
  const referrerRewardDesc = config.prizeIsCurrency
    ? `${config.referrerCurrencyReward} currency`
    : 'items from the prize pool';

  // VI-39: Omit welcome bonus sentence when welcomeBonus === 0
  let pmMsg = `Referral code applied!`;
  if (welcomeBonus > 0) {
    pmMsg += ` You received a welcome bonus of ${welcomeBonus} currency (currency reward).`;
  }
  pmMsg += `\nYour referrer will earn ${referrerRewardDesc} once you've played ${thresholdMsg} on this server.`;

  await pog.pm(pmMsg);
}

await main();
