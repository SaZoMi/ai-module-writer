import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';
import {
  lookupCode,
  getReferralLink,
  setReferralLink,
  getPlayerStats,
  setPlayerStats,
  findVariable,
  writeVariable,
  todayUTC,
} from './referral-helpers.js';

// Rate limit: per-player tracking of invalid code attempts (VI-11)
const RATE_LIMIT_KEY_PREFIX = 'referral_rate_limit';
const RATE_LIMIT_MAX_ATTEMPTS = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 60 seconds

async function checkRateLimit(gameServerId, moduleId, playerId) {
  try {
    const rateLimitKey = `${RATE_LIMIT_KEY_PREFIX}:${playerId}`;
    const rateLimitVar = await findVariable(gameServerId, moduleId, rateLimitKey, playerId);
    let rateData = { attempts: 0, windowStart: Date.now() };
    if (rateLimitVar) {
      try { rateData = JSON.parse(rateLimitVar.value); } catch (_) {}
    }
    // Reset window if expired
    if (Date.now() - rateData.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateData = { attempts: 0, windowStart: Date.now() };
    }
    return rateData;
  } catch (err) {
    console.warn(`referral: checkRateLimit failed (non-fatal): ${err}`);
    return { attempts: 0, windowStart: Date.now() };
  }
}

async function incrementRateLimit(gameServerId, moduleId, playerId, rateData) {
  try {
    const rateLimitKey = `${RATE_LIMIT_KEY_PREFIX}:${playerId}`;
    rateData.attempts += 1;
    await writeVariable(gameServerId, moduleId, rateLimitKey, rateData, playerId);
  } catch (err) {
    console.warn(`referral: incrementRateLimit failed (non-fatal): ${err}`);
  }
}

async function resetRateLimit(gameServerId, moduleId, playerId) {
  try {
    const rateLimitKey = `${RATE_LIMIT_KEY_PREFIX}:${playerId}`;
    await writeVariable(gameServerId, moduleId, rateLimitKey, { attempts: 0, windowStart: Date.now() }, playerId);
  } catch (err) {
    console.warn(`referral: resetRateLimit failed (non-fatal): ${err}`);
  }
}

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

  // Rate limit: track invalid code attempts per player (VI-11)
  const rateData = await checkRateLimit(gameServerId, moduleId, player.id);

  // Look up who owns this code
  const codeLookup = await lookupCode(gameServerId, moduleId, code);
  if (!codeLookup) {
    // VI-8: Increment first, then check. rateData.attempts is now the post-increment value.
    await incrementRateLimit(gameServerId, moduleId, player.id, rateData);
    // rateData.attempts was already incremented in-place by incrementRateLimit

    if (rateData.attempts > RATE_LIMIT_MAX_ATTEMPTS) {
      // 11th attempt and beyond — rate limited
      const remainingMs = RATE_LIMIT_WINDOW_MS - (Date.now() - rateData.windowStart);
      const remainingSec = Math.ceil(remainingMs / 1000);
      throw new TakaroUserError(`Too many invalid code attempts. Please wait ${remainingSec} seconds before trying again.`);
    }
    throw new TakaroUserError(`Referral code "${code}" was not found. Check the code and try again.`);
  }

  // Reset rate limit counter on successful code lookup
  if (rateData.attempts > 0) {
    await resetRateLimit(gameServerId, moduleId, player.id);
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

  // Pay referee welcome bonus (always currency regardless of prizeIsCurrency setting)
  // Per spec: fail the command when the welcome bonus grant throws so the player knows
  // something went wrong. The link is already written at this point; if needed an admin
  // can use /refunlink and have the player retry.
  const welcomeBonus = config.refereeCurrencyReward || 0;
  if (welcomeBonus > 0) {
    try {
      await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(gameServerId, player.id, {
        currency: welcomeBonus,
      });
      console.log(`referral: welcome bonus paid to referee=${player.name}, amount=${welcomeBonus}`);
    } catch (err) {
      console.error(`referral: failed to pay welcome bonus to referee=${player.name}: ${err}`);
      throw new TakaroUserError(`Referral code applied, but we could not deliver your welcome bonus (${welcomeBonus} currency). Please contact an admin. Error: ${err?.message ?? err}`);
    }
  }

  console.log(`referral: link created referee=${player.name}(${player.id}) -> referrer=${referrerId}, playtimeAtLink=${currentPlaytimeMinutes.toFixed(1)}min`);

  const thresholdMsg = config.playtimeThresholdMinutes >= 60
    ? `${(config.playtimeThresholdMinutes / 60).toFixed(1)}h`
    : `${config.playtimeThresholdMinutes}min`;

  // VI-22: List up to 3 item names from the pool instead of generic "a random item reward"
  let referrerRewardDesc;
  if (config.prizeIsCurrency) {
    referrerRewardDesc = `${config.referrerCurrencyReward} currency`;
  } else {
    const items = config.items || [];
    if (items.length === 0) {
      referrerRewardDesc = 'a random item reward';
    } else {
      const itemNames = items.slice(0, 3).map((i) => i.item).filter(Boolean);
      const suffix = items.length > 3 ? ` and ${items.length - 3} more` : '';
      referrerRewardDesc = `a random item (${itemNames.join(', ')}${suffix})`;
    }
  }

  // Omit welcome bonus sentence when welcomeBonus === 0
  let pmMsg = `Referral code applied!`;
  if (welcomeBonus > 0) {
    pmMsg += ` You received a welcome bonus of ${welcomeBonus} currency.`;
  }
  pmMsg += `\nYour referrer will earn ${referrerRewardDesc} once you've played ${thresholdMsg} on this server.`;

  await pog.pm(pmMsg);
}

await main();
