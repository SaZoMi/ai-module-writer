import { takaro, checkPermission } from '@takaro/helpers';

// --- Variable key constants ---
export const KEY_REFERRAL_CODE = 'referral_code';        // per-player: { code, createdAt }
export const KEY_CODE_LOOKUP = 'referral_code_lookup';   // global (key includes code): { playerId }
export const KEY_REFERRAL_LINK = 'referral_link';        // per-player (referee): { referrerId, linkedAt, status, playtimeAtLink, retries, paidAmount, paidType }
export const KEY_REFERRAL_STATS = 'referral_stats';      // per-player: { referralsTotal, referralsPaid, referralsRejected, referralsToday, lastReferralDay, currencyEarned, itemsEarned }
export const KEY_PENDING_INDEX = 'referral_pending_index'; // global: { refereeIds: string[] }

export const DEFAULT_STATS = {
  referralsTotal: 0,
  referralsPaid: 0,
  referralsRejected: 0,
  referralsToday: 0,
  lastReferralDay: null,
  currencyEarned: 0,
  itemsEarned: 0,
};

// --- Generic variable helpers ---

export async function findVariable(gameServerId, moduleId, key, playerId) {
  const filters = {
    key: [key],
    gameServerId: [gameServerId],
    moduleId: [moduleId],
  };
  if (playerId) filters.playerId = [playerId];
  const res = await takaro.variable.variableControllerSearch({ filters });
  return res.data.data.length > 0 ? res.data.data[0] : null;
}

export async function writeVariable(gameServerId, moduleId, key, value, playerId) {
  const existing = await findVariable(gameServerId, moduleId, key, playerId);
  const serialized = JSON.stringify(value);
  if (existing) {
    try {
      await takaro.variable.variableControllerUpdate(existing.id, { value: serialized });
      return;
    } catch (err) {
      // 404 means the variable was deleted between findVariable and update (stale race).
      // Fall through to create a fresh record.
      const status = err?.response?.status ?? err?.status;
      if (status !== 404) throw err;
      console.warn(`referral-helpers: writeVariable — stale variable ${existing.id} (404), recreating`);
    }
  }
  const payload = { key, value: serialized, gameServerId, moduleId };
  if (playerId) payload.playerId = playerId;
  await takaro.variable.variableControllerCreate(payload);
}

export async function deleteVariableRecord(gameServerId, moduleId, key, playerId) {
  const existing = await findVariable(gameServerId, moduleId, key, playerId);
  if (existing) {
    await takaro.variable.variableControllerDelete(existing.id);
  }
}

// --- Code helpers ---

/** Get a player's referral code record, or null if not set */
export async function getPlayerCode(gameServerId, moduleId, playerId) {
  const v = await findVariable(gameServerId, moduleId, KEY_REFERRAL_CODE, playerId);
  if (!v) return null;
  try { return JSON.parse(v.value); } catch (e) { return null; }
}

/** Store a player's referral code */
export async function setPlayerCode(gameServerId, moduleId, playerId, codeData) {
  await writeVariable(gameServerId, moduleId, KEY_REFERRAL_CODE, codeData, playerId);
}

/**
 * Look up which player owns a code. The key is stored as `referral_code_lookup:{code}` globally.
 * We use a single variable per code scoped to the game server (no playerId).
 */
export async function lookupCode(gameServerId, moduleId, code) {
  const key = `${KEY_CODE_LOOKUP}:${code}`;
  const v = await findVariable(gameServerId, moduleId, key);
  if (!v) return null;
  try { return JSON.parse(v.value); } catch (e) { return null; }
}

export async function setCodeLookup(gameServerId, moduleId, code, data) {
  const key = `${KEY_CODE_LOOKUP}:${code}`;
  await writeVariable(gameServerId, moduleId, key, data);
}

// --- Link helpers ---

export async function getReferralLink(gameServerId, moduleId, refereePlayerId) {
  const v = await findVariable(gameServerId, moduleId, KEY_REFERRAL_LINK, refereePlayerId);
  if (!v) return null;
  try { return JSON.parse(v.value); } catch (e) { return null; }
}

export async function setReferralLink(gameServerId, moduleId, refereePlayerId, linkData) {
  await writeVariable(gameServerId, moduleId, KEY_REFERRAL_LINK, linkData, refereePlayerId);
}

export async function deleteReferralLink(gameServerId, moduleId, refereePlayerId) {
  await deleteVariableRecord(gameServerId, moduleId, KEY_REFERRAL_LINK, refereePlayerId);
}

// --- Stats helpers ---

export async function getPlayerStats(gameServerId, moduleId, playerId) {
  const v = await findVariable(gameServerId, moduleId, KEY_REFERRAL_STATS, playerId);
  if (!v) return { ...DEFAULT_STATS };
  try { return { ...DEFAULT_STATS, ...JSON.parse(v.value) }; } catch (e) { return { ...DEFAULT_STATS }; }
}

export async function setPlayerStats(gameServerId, moduleId, playerId, statsData) {
  await writeVariable(gameServerId, moduleId, KEY_REFERRAL_STATS, statsData, playerId);
}

// --- Pending index helpers ---
// Note: The pending index is a best-effort hint. The sweep cronjob can also
// query variables directly. Concurrent writes may occasionally drop an entry,
// but the sweep will recover on the next tick.

export async function getPendingIndex(gameServerId, moduleId) {
  const v = await findVariable(gameServerId, moduleId, KEY_PENDING_INDEX);
  if (!v) return { refereeIds: [] };
  try { return { refereeIds: [], ...JSON.parse(v.value) }; } catch (e) { return { refereeIds: [] }; }
}

export async function setPendingIndex(gameServerId, moduleId, data) {
  await writeVariable(gameServerId, moduleId, KEY_PENDING_INDEX, data);
}

export async function addToPendingIndex(gameServerId, moduleId, refereePlayerId) {
  const index = await getPendingIndex(gameServerId, moduleId);
  if (!index.refereeIds.includes(refereePlayerId)) {
    index.refereeIds.push(refereePlayerId);
    await setPendingIndex(gameServerId, moduleId, index);
  }
}

export async function removeFromPendingIndex(gameServerId, moduleId, refereePlayerId) {
  // Best-effort: the pending index is a hint for the sweep cronjob.
  // getAllPendingRefereeIds() is the authoritative source; index failures are non-fatal.
  try {
    const index = await getPendingIndex(gameServerId, moduleId);
    const before = index.refereeIds.length;
    index.refereeIds = index.refereeIds.filter((id) => id !== refereePlayerId);
    if (index.refereeIds.length !== before) {
      await setPendingIndex(gameServerId, moduleId, index);
    }
  } catch (err) {
    console.warn(`referral-helpers: removeFromPendingIndex failed (non-fatal): ${err}`);
  }
}

/**
 * Get ALL pending referee IDs by searching variables directly.
 * This is more reliable than the pending index for the sweep cronjob,
 * avoiding read-modify-write races.
 */
export async function getAllPendingRefereeIds(gameServerId, moduleId) {
  const results = [];
  const limit = 100;
  let page = 0;
  let iterations = 0;
  while (true) {
    if (++iterations > 100) {
      console.error('referral-helpers: getAllPendingRefereeIds exceeded 100 iterations, aborting');
      break;
    }
    const res = await takaro.variable.variableControllerSearch({
      filters: {
        key: [KEY_REFERRAL_LINK],
        gameServerId: [gameServerId],
        moduleId: [moduleId],
      },
      limit,
      page,
    });
    const records = res.data.data;
    for (const record of records) {
      if (!record.playerId) continue;
      try {
        const link = JSON.parse(record.value);
        if (link.status === 'pending') {
          results.push(record.playerId);
        }
      } catch (e) {
        // skip unparseable records
      }
    }
    if (records.length < limit) break;
    page++;
  }
  return results;
}

// --- All stats (for leaderboard) ---

export async function getAllStats(gameServerId, moduleId) {
  const results = [];
  const limit = 100;
  let page = 0;
  let iterations = 0;
  while (true) {
    if (++iterations > 100) {
      console.error('referral-helpers: getAllStats exceeded 100 iterations, aborting');
      break;
    }
    const res = await takaro.variable.variableControllerSearch({
      filters: {
        key: [KEY_REFERRAL_STATS],
        gameServerId: [gameServerId],
        moduleId: [moduleId],
      },
      limit,
      page,
    });
    const records = res.data.data;
    for (const record of records) {
      if (!record.playerId) continue;
      try {
        const stats = { ...DEFAULT_STATS, ...JSON.parse(record.value) };
        results.push({ playerId: record.playerId, stats });
      } catch (e) {
        console.error(`referral-helpers: getAllStats failed to parse record for player ${record.playerId}, skipping`);
      }
    }
    if (records.length < limit) break;
    page++;
  }
  return results;
}

// --- Code generation (VI-32) ---
// Uses Math.random which is acceptable in the Takaro sandbox (code space is ~10^9,
// collisions are detected and retried in the caller via lookupCode).

export function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // unambiguous chars (no 0/O/1/I)
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Generate a unique code, retrying up to maxAttempts on collision (VI-22).
 * @param {string} gameServerId
 * @param {string} moduleId
 * @param {number} maxAttempts
 * @returns {Promise<string>}
 */
export async function generateUniqueCode(gameServerId, moduleId, maxAttempts = 10) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generateCode();
    const existing = await lookupCode(gameServerId, moduleId, code);
    if (!existing) return code;
    console.log(`referral-helpers: generateUniqueCode collision attempt=${attempt + 1} for code=${code}, retrying`);
  }
  throw new Error('referral-helpers: generateUniqueCode exhausted max attempts — try again');
}

// --- Today's date (UTC) ---

export function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

// --- VIP tier multiplier ---

/**
 * Get VIP multiplier for a referrer using checkPermission on their pog.
 * Fetches pog via playerOnGameServerControllerSearch.
 * +5% per tier, capped at +25% (5 tiers).
 */
export async function getVipMultiplier(referrerPlayerId, gameServerId) {
  try {
    const pogRes = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
      filters: { gameServerId: [gameServerId], playerId: [referrerPlayerId] },
    });
    const pog = pogRes.data.data[0];
    if (!pog) return 1;
    const permResult = checkPermission(pog, 'REFERRAL_VIP');
    const vipCount = (permResult && permResult.count > 0) ? permResult.count : 0;
    const cappedTier = Math.min(vipCount, 5);
    return 1 + cappedTier * 0.05;
  } catch (err) {
    console.error(`referral-helpers: getVipMultiplier failed for player ${referrerPlayerId}: ${err}`);
    return 1;
  }
}

/**
 * Pay referrer reward: currency or random item from config.
 * Returns { paid: true, amount, type, paidAmount } on success or { paid: false, error } on failure.
 */
export async function payReferrer(gameServerId, referrerPlayerId, config, vipMultiplier) {
  if (config.prizeIsCurrency) {
    const amount = Math.floor(config.referrerCurrencyReward * vipMultiplier);
    try {
      await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(gameServerId, referrerPlayerId, {
        currency: amount,
      });
      return { paid: true, amount, type: 'currency', paidAmount: amount };
    } catch (err) {
      return { paid: false, error: String(err) };
    }
  } else {
    // Pick a random item from the items array
    const items = config.items || [];
    if (items.length === 0) {
      console.error('referral-helpers: payReferrer — prizeIsCurrency=false but items array is empty, falling back to currency');
      const amount = Math.floor(config.referrerCurrencyReward * vipMultiplier);
      try {
        await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(gameServerId, referrerPlayerId, {
          currency: amount,
        });
        return { paid: true, amount, type: 'currency-fallback', paidAmount: amount };
      } catch (err) {
        return { paid: false, error: String(err) };
      }
    }
    const chosen = items[Math.floor(Math.random() * items.length)];
    try {
      await takaro.gameserver.gameServerControllerGiveItem(gameServerId, referrerPlayerId, {
        name: chosen.item,
        amount: chosen.amount || 1,
        quality: chosen.quality || '',
      });
      return { paid: true, item: chosen.item, amount: chosen.amount || 1, type: 'item', paidAmount: chosen.amount || 1 };
    } catch (err) {
      return { paid: false, error: String(err) };
    }
  }
}

/**
 * Core payout logic: check if a referee has crossed the playtime threshold
 * and if so, pay the referrer and flip the link to 'paid'.
 *
 * ATOMIC RESERVATION (VI-1): Before any payout, flip status to 'in-flight'.
 * If the re-read shows the status is no longer 'pending', another writer beat us — abort.
 * This prevents double-payout races between the sweep cronjob and disconnect hook.
 *
 * Returns: 'paid' | 'pending' | 'no-link' | 'rejected' | 'in-flight' (already claimed)
 */
export async function checkAndPayReferral(gameServerId, moduleId, refereePlayerId, config) {
  const link = await getReferralLink(gameServerId, moduleId, refereePlayerId);
  if (!link) return 'no-link';
  if (link.status !== 'pending') return link.status;

  // --- ATOMIC CLAIM: flip to 'in-flight' before doing any work ---
  await setReferralLink(gameServerId, moduleId, refereePlayerId, {
    ...link,
    status: 'in-flight',
  });

  // Re-read to confirm we own the lock (another writer may have beaten us)
  const claimed = await getReferralLink(gameServerId, moduleId, refereePlayerId);
  if (!claimed || claimed.status !== 'in-flight') {
    // Another writer already claimed it; abort
    console.log(`referral-helpers: checkAndPayReferral — in-flight claim lost for referee=${refereePlayerId}, aborting`);
    return 'in-flight';
  }

  // We own the in-flight state. Now do all the work.
  // Fetch current playtime for the referee
  let currentPlaytimeSeconds;
  try {
    const pogRes = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
      filters: { gameServerId: [gameServerId], playerId: [refereePlayerId] },
    });
    const pog = pogRes.data.data[0];
    if (!pog) {
      console.log(`referral-helpers: checkAndPayReferral — referee ${refereePlayerId} not found on server`);
      // Restore to pending since we couldn't check
      await setReferralLink(gameServerId, moduleId, refereePlayerId, { ...link, status: 'pending' });
      return 'pending';
    }
    currentPlaytimeSeconds = pog.playtimeSeconds || 0;
  } catch (err) {
    console.error(`referral-helpers: checkAndPayReferral — failed to fetch pog for referee ${refereePlayerId}: ${err}`);
    // Restore to pending
    await setReferralLink(gameServerId, moduleId, refereePlayerId, { ...link, status: 'pending' });
    return 'pending';
  }

  const currentPlaytimeMinutes = currentPlaytimeSeconds / 60;
  const playtimeAtLink = link.playtimeAtLink || 0;
  const playtimeGainedMinutes = currentPlaytimeMinutes - playtimeAtLink;

  console.log(`referral-helpers: checkAndPayReferral — referee=${refereePlayerId}, currentPlaytimeMinutes=${currentPlaytimeMinutes.toFixed(1)}, playtimeAtLink=${playtimeAtLink.toFixed(1)}, gained=${playtimeGainedMinutes.toFixed(1)}, threshold=${config.playtimeThresholdMinutes}`);

  if (playtimeGainedMinutes < config.playtimeThresholdMinutes) {
    // Not yet threshold — restore to pending
    await setReferralLink(gameServerId, moduleId, refereePlayerId, { ...link, status: 'pending' });
    return 'pending';
  }

  // Threshold crossed — look up referrer's VIP tier
  const vipMultiplier = await getVipMultiplier(link.referrerId, gameServerId);

  // Attempt payout
  const retries = link.retries || 0;
  const payResult = await payReferrer(gameServerId, link.referrerId, config, vipMultiplier);

  if (!payResult.paid) {
    console.error(`referral-helpers: checkAndPayReferral — pay failed for referrer=${link.referrerId}, retry=${retries + 1}/3. Error: ${payResult.error}`);
    if (retries + 1 >= 3) {
      // Mark as rejected after 3 failures (VI-2, VI-19)
      const referrerStats = await getPlayerStats(gameServerId, moduleId, link.referrerId);
      const updatedReferrerStats = {
        ...referrerStats,
        referralsRejected: (referrerStats.referralsRejected || 0) + 1,
      };
      await setPlayerStats(gameServerId, moduleId, link.referrerId, updatedReferrerStats);

      await setReferralLink(gameServerId, moduleId, refereePlayerId, {
        ...link,
        status: 'rejected',
        retries: retries + 1,
      });
      await removeFromPendingIndex(gameServerId, moduleId, refereePlayerId);
      return 'rejected';
    } else {
      await setReferralLink(gameServerId, moduleId, refereePlayerId, {
        ...link,
        status: 'pending',
        retries: retries + 1,
      });
      return 'pending';
    }
  }

  // Payout succeeded — update link status with paid amount for rollback (VI-17)
  await setReferralLink(gameServerId, moduleId, refereePlayerId, {
    ...link,
    status: 'paid',
    paidAmount: payResult.paidAmount,
    paidType: payResult.type,
  });
  await removeFromPendingIndex(gameServerId, moduleId, refereePlayerId);

  // Update referrer stats
  const referrerStats = await getPlayerStats(gameServerId, moduleId, link.referrerId);
  const updatedReferrerStats = {
    ...referrerStats,
    referralsPaid: referrerStats.referralsPaid + 1,
    currencyEarned: payResult.type === 'currency' || payResult.type === 'currency-fallback'
      ? referrerStats.currencyEarned + (payResult.amount || 0)
      : referrerStats.currencyEarned,
    itemsEarned: payResult.type === 'item'
      ? referrerStats.itemsEarned + (payResult.amount || 1)
      : referrerStats.itemsEarned,
  };
  await setPlayerStats(gameServerId, moduleId, link.referrerId, updatedReferrerStats);

  if (payResult.type === 'currency') {
    console.log(`referral-helpers: checkAndPayReferral — paid referrer=${link.referrerId}, amount=${payResult.amount} currency, vipMultiplier=${vipMultiplier}`);
  } else if (payResult.type === 'item') {
    console.log(`referral-helpers: checkAndPayReferral — paid referrer=${link.referrerId}, item=${payResult.item} x${payResult.amount}, vipMultiplier=${vipMultiplier}`);
  } else {
    console.log(`referral-helpers: checkAndPayReferral — paid referrer=${link.referrerId} via currency-fallback, amount=${payResult.amount}`);
  }

  // PM the referrer if they're online (VI-13)
  try {
    const referrerPogRes = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
      filters: { gameServerId: [gameServerId], playerId: [link.referrerId] },
    });
    const referrerPog = referrerPogRes.data.data[0];
    if (referrerPog && referrerPog.online) {
      // Look up referee name for PM
      let refereeName = 'a player';
      try {
        const refereePlayerRes = await takaro.player.playerControllerGetOne(refereePlayerId);
        if (refereePlayerRes.data.data && refereePlayerRes.data.data.name) {
          refereeName = refereePlayerRes.data.data.name;
        }
      } catch (_) {}

      const rewardDesc = payResult.type === 'item'
        ? `${payResult.amount}x ${payResult.item}`
        : `${payResult.amount} currency`;

      await referrerPog.pm(`Your referral for ${refereeName} is complete! You earned ${rewardDesc}.`);
    }
  } catch (err) {
    console.error(`referral-helpers: checkAndPayReferral — failed to PM referrer ${link.referrerId}: ${err}`);
  }

  return 'paid';
}

/**
 * Find a player by display name on a game server.
 * First tries playerControllerSearch by name (cross-game display name),
 * falls back to gameId match if name search returns nothing.
 */
export async function findPlayerByName(gameServerId, name) {
  try {
    // Primary: search by player display name
    const nameRes = await takaro.player.playerControllerSearch({
      filters: { name: [name] },
    });
    const playerMatches = nameRes.data.data || [];
    for (const player of playerMatches) {
      // Confirm this player is on the target game server
      const pogRes = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
        filters: { gameServerId: [gameServerId], playerId: [player.id] },
      });
      if (pogRes.data.data.length > 0) {
        return pogRes.data.data[0];
      }
    }
  } catch (err) {
    console.error(`referral-helpers: findPlayerByName name-search failed for "${name}": ${err}`);
  }

  // Fallback: try gameId match
  try {
    const res = await takaro.playerOnGameserver.playerOnGameServerControllerSearch({
      filters: { gameServerId: [gameServerId], gameId: [name] },
    });
    return res.data.data[0] || null;
  } catch (err) {
    console.error(`referral-helpers: findPlayerByName gameId-search failed for "${name}": ${err}`);
    return null;
  }
}
