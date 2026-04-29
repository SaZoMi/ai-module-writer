import { takaro, TakaroUserError } from '@takaro/helpers';

export const RACE_STATE_KEY = 'zombie_racing_state_v1';
export const RACING_STATS_KEY = 'zombie_racing_stats_v1';
export const RACING_JACKPOT_KEY = 'zombie_racing_jackpot_v1';
export const RACING_LOCK_KEY = 'zombie_racing_lock_v1';

const LOCK_TIMEOUT_MS = 30000;
const COMPLETION_ACTIVE_TIMEOUT_MS = 5 * 60 * 1000;

export const DEFAULT_ENTRANTS = [
  { name: 'Biker', odds: 2 },
  { name: 'Arlene', odds: 3 },
  { name: 'Darlene', odds: 3 },
  { name: 'Chuck', odds: 4 },
  { name: 'Moe', odds: 5 },
  { name: 'Nurse', odds: 6 },
];

const DEFAULT_ENTRANT_LINES = DEFAULT_ENTRANTS.map((entrant) => `${entrant.name}; ${entrant.odds}`);

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

export function getRaceLabels(config = {}) {
  const racerTypeLabel = String(config.racerTypeLabel || 'zombie').trim() || 'zombie';
  const racerTypePluralLabel = String(config.racerTypePluralLabel || `${racerTypeLabel}s`).trim() || `${racerTypeLabel}s`;
  const raceName = String(config.raceName || 'Zombie Race').trim() || 'Zombie Race';
  return { racerTypeLabel, racerTypePluralLabel, raceName };
}

export function parseEntrants(config = {}) {
  const hasLegacyZombies = Array.isArray(config.Zombies);
  const hasLegacyHorses = Array.isArray(config.Horses);
  const configuredEntrants = Array.isArray(config.entrants) ? config.entrants : null;
  const entrantsAreSchemaDefault = configuredEntrants
    ? JSON.stringify(configuredEntrants) === JSON.stringify(DEFAULT_ENTRANT_LINES)
    : false;
  const rawEntrants = configuredEntrants && !(entrantsAreSchemaDefault && (hasLegacyZombies || hasLegacyHorses))
    ? configuredEntrants
    : hasLegacyZombies
      ? config.Zombies
      : hasLegacyHorses
        ? config.Horses
        : DEFAULT_ENTRANT_LINES;

  const entrants = rawEntrants
    .map((line) => {
      const [rawName, rawOdds] = String(line).split(';');
      const name = String(rawName || '').trim();
      if (!name) return null;
      return { name, odds: toPositiveInteger(rawOdds, 2) };
    })
    .filter(Boolean);

  return entrants.length > 0 ? entrants : DEFAULT_ENTRANTS;
}

export function findEntrant(entrants, racerName) {
  const normalized = String(racerName || '').trim().toLowerCase();
  return entrants.find((entrant) => entrant.name.toLowerCase() === normalized) || null;
}

export function getTimeUntilRace(nextRaceTime) {
  const timeRemaining = Number(nextRaceTime || 0) - Date.now();
  if (timeRemaining <= 0) return 'any moment now';

  const minutes = Math.floor(timeRemaining / 60000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${hours} hour${hours === 1 ? '' : 's'} and ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`;
}

export function initialRaceState() {
  return {
    nextRaceTime: Date.now() + (2 * 60 * 60 * 1000),
    bets: [],
    lastRaceResults: null,
    raceNumber: 1,
  };
}

export async function findVariable(gameServerId, moduleId, key, playerId) {
  const filters = { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] };
  if (playerId) filters.playerId = [playerId];
  const res = await takaro.variable.variableControllerSearch({ filters });
  return res.data.data[0] || null;
}

export async function writeVariable(gameServerId, moduleId, key, value, playerId) {
  const existing = await findVariable(gameServerId, moduleId, key, playerId);
  const serialized = JSON.stringify(value);
  if (existing) {
    await takaro.variable.variableControllerUpdate(existing.id, { value: serialized });
    return;
  }

  const payload = { key, value: serialized, gameServerId, moduleId };
  if (playerId) payload.playerId = playerId;
  await takaro.variable.variableControllerCreate(payload);
}

function parseVariableValue(variable) {
  if (!variable) return null;
  try {
    return JSON.parse(variable.value);
  } catch (_err) {
    return null;
  }
}

async function deleteVariableRecord(variable) {
  if (!variable) return;
  try {
    await takaro.variable.variableControllerDelete(variable.id);
  } catch (err) {
    const status = err?.response?.status ?? err?.status;
    if (status !== 404) throw err;
  }
}

export async function acquireRaceLock(gameServerId, moduleId, reason = 'race-mutation') {
  const owner = `${reason}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const existing = await findVariable(gameServerId, moduleId, RACING_LOCK_KEY);
  const existingLock = parseVariableValue(existing);
  const isExpired = existingLock?.expiresAt && existingLock.expiresAt < Date.now();

  if (existing && isExpired) {
    console.warn(`racing: reclaiming stale lock owner=${existingLock.owner || 'unknown'} reason=${existingLock.reason || 'unknown'}`);
    await deleteVariableRecord(existing);
  } else if (existing) {
    throw new TakaroUserError('Race state is busy. Please try again in a moment.');
  }

  try {
    await takaro.variable.variableControllerCreate({
      key: RACING_LOCK_KEY,
      value: JSON.stringify({
        owner,
        reason,
        acquiredAt: Date.now(),
        expiresAt: Date.now() + LOCK_TIMEOUT_MS,
      }),
      gameServerId,
      moduleId,
    });
    return owner;
  } catch (err) {
    const status = err?.response?.status ?? err?.status;
    if (status === 409) {
      throw new TakaroUserError('Race state is busy. Please try again in a moment.');
    }
    throw err;
  }
}

export async function releaseRaceLock(gameServerId, moduleId, owner) {
  const existing = await findVariable(gameServerId, moduleId, RACING_LOCK_KEY);
  const existingLock = parseVariableValue(existing);
  if (existing && existingLock?.owner === owner) {
    await deleteVariableRecord(existing);
  }
}

export async function renewRaceLock(gameServerId, moduleId, owner) {
  const existing = await findVariable(gameServerId, moduleId, RACING_LOCK_KEY);
  const existingLock = parseVariableValue(existing);
  if (!existing || existingLock?.owner !== owner) return false;

  await takaro.variable.variableControllerUpdate(existing.id, {
    value: JSON.stringify({
      ...existingLock,
      renewedAt: Date.now(),
      expiresAt: Date.now() + LOCK_TIMEOUT_MS,
    }),
  });
  return true;
}

export async function getRaceData(gameServerId, moduleId) {
  const variable = await findVariable(gameServerId, moduleId, RACE_STATE_KEY);
  if (!variable) {
    const state = initialRaceState();
    await writeVariable(gameServerId, moduleId, RACE_STATE_KEY, state);
    return state;
  }

  try {
    const parsed = JSON.parse(variable.value);
    return {
      ...initialRaceState(),
      ...parsed,
      bets: Array.isArray(parsed.bets) ? parsed.bets : [],
      raceNumber: toPositiveInteger(parsed.raceNumber, 1),
    };
  } catch (err) {
    console.error(`racing: failed to parse race state, resetting. Error: ${err}`);
    const state = initialRaceState();
    await writeVariable(gameServerId, moduleId, RACE_STATE_KEY, state);
    return state;
  }
}

export async function updateRaceData(gameServerId, moduleId, raceData) {
  await writeVariable(gameServerId, moduleId, RACE_STATE_KEY, raceData);
}

export function simulateWeightedRace(entrants) {
  const racers = entrants.length > 0 ? entrants : DEFAULT_ENTRANTS;
  const totalWeight = racers.reduce((sum, entrant) => sum + (1 / Math.max(1, entrant.odds)), 0);
  const random = Math.random() * totalWeight;
  let cursor = 0;
  let winnerIndex = 0;

  for (let i = 0; i < racers.length; i++) {
    cursor += 1 / Math.max(1, racers[i].odds);
    if (random <= cursor) {
      winnerIndex = i;
      break;
    }
  }

  const winner = racers[winnerIndex];
  const others = racers
    .filter((_, index) => index !== winnerIndex)
    .map((entrant) => ({ ...entrant, score: Math.random() / Math.max(1, entrant.odds) }))
    .sort((a, b) => b.score - a.score);

  return [winner, ...others].map((entrant, index) => ({
    name: entrant.name,
    odds: entrant.odds,
    position: index + 1,
  }));
}

export function buildRaceResult(raceData, results, jackpotAmount = 0) {
  const winner = results[0];
  const allBets = Array.isArray(raceData.bets) ? raceData.bets : [];
  const winners = allBets.filter((bet) => bet.racer.toLowerCase() === winner.name.toLowerCase());
  let totalPayout = 0;

  const paidWinners = winners.map((bet) => {
    const payout = Math.floor(bet.amount * bet.odds) + (jackpotAmount > 0 ? Math.floor(jackpotAmount / winners.length) : 0);
    totalPayout += payout;
    return { ...bet, payout };
  });

  return {
    raceNumber: raceData.raceNumber,
    results,
    winner: winner.name,
    bets: allBets,
    winners: paidWinners,
    totalBets: allBets.length,
    totalWagered: allBets.reduce((sum, bet) => sum + bet.amount, 0),
    totalPayout,
    jackpot: jackpotAmount,
    timestamp: Date.now(),
  };
}

export async function updatePlayerStats(gameServerId, moduleId, playerId, bet, isWin, winnings = 0, statUpdateId = null) {
  const existing = await findVariable(gameServerId, moduleId, RACING_STATS_KEY, playerId);
  let stats = {
    playerName: bet.playerName,
    totalWinnings: 0,
    totalBets: 0,
    totalWagered: 0,
    wins: 0,
    losses: 0,
    biggestWin: 0,
    favoriteRacer: bet.racer,
    racerStats: {},
    processedStatIds: [],
  };

  if (existing) {
    try {
      stats = { ...stats, ...JSON.parse(existing.value) };
    } catch (err) {
      console.error(`racing: failed to parse stats for player=${playerId}. Error: ${err}`);
    }
  }

  stats.processedStatIds = normalizeProgressList(stats.processedStatIds);
  if (statUpdateId && stats.processedStatIds.includes(statUpdateId)) return;

  stats.playerName = bet.playerName;
  stats.totalBets += 1;
  stats.totalWagered += bet.amount;
  if (isWin) {
    stats.wins += 1;
    stats.totalWinnings += winnings;
    stats.biggestWin = Math.max(stats.biggestWin, winnings);
  } else {
    stats.losses += 1;
  }

  if (!stats.racerStats) stats.racerStats = {};
  if (!stats.racerStats[bet.racer]) {
    stats.racerStats[bet.racer] = { bets: 0, wins: 0, totalWagered: 0 };
  }
  stats.racerStats[bet.racer].bets += 1;
  stats.racerStats[bet.racer].totalWagered += bet.amount;
  if (isWin) stats.racerStats[bet.racer].wins += 1;

  const favorite = Object.entries(stats.racerStats).sort(([, a], [, b]) => b.bets - a.bets)[0];
  stats.favoriteRacer = favorite ? favorite[0] : bet.racer;
  if (statUpdateId) {
    stats.processedStatIds = [...stats.processedStatIds, statUpdateId].slice(-200);
  }

  await writeVariable(gameServerId, moduleId, RACING_STATS_KEY, stats, playerId);
}

export async function checkAndCreateJackpot(gameServerId, moduleId, totalWagered) {
  if (totalWagered < 1000) return { isJackpot: false, amount: 0 };

  const existing = await findVariable(gameServerId, moduleId, RACING_JACKPOT_KEY);
  if (existing) {
    try {
      const jackpot = JSON.parse(existing.value);
      if (jackpot.active && jackpot.amount > 0) return { isJackpot: true, amount: jackpot.amount };
    } catch (err) {
      console.error(`racing: failed to parse jackpot. Error: ${err}`);
    }
  }

  const amount = Math.floor(totalWagered * 0.25);
  await writeVariable(gameServerId, moduleId, RACING_JACKPOT_KEY, { active: true, amount, createdAt: Date.now() });
  return { isJackpot: true, amount };
}

export async function clearJackpot(gameServerId, moduleId) {
  const existing = await findVariable(gameServerId, moduleId, RACING_JACKPOT_KEY);
  if (existing) await takaro.variable.variableControllerDelete(existing.id);
}

function normalizeProgressList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function hasCompletionProgress(completion, key, playerId) {
  return normalizeProgressList(completion?.[key]).includes(playerId);
}

function withCompletionProgress(raceData, result, nextRaceData, updates = {}) {
  const completion = raceData.completion?.raceNumber === result.raceNumber ? raceData.completion : {};
  return {
    ...raceData,
    completion: {
      ...completion,
      raceNumber: result.raceNumber,
      status: 'payout-pending',
      result,
      nextRaceData,
      startedAt: completion.startedAt || Date.now(),
      activeOwner: updates.activeOwner ?? completion.activeOwner,
      activeExpiresAt: updates.activeExpiresAt ?? completion.activeExpiresAt,
      payoutStartedPlayerIds: normalizeProgressList(updates.payoutStartedPlayerIds ?? completion.payoutStartedPlayerIds),
      statsUpdatedPlayerIds: normalizeProgressList(updates.statsUpdatedPlayerIds ?? completion.statsUpdatedPlayerIds),
      finalizedPlayerIds: normalizeProgressList(updates.finalizedPlayerIds ?? completion.finalizedPlayerIds),
    },
  };
}

function completionActiveLease(owner) {
  return {
    activeOwner: owner,
    activeExpiresAt: Date.now() + COMPLETION_ACTIVE_TIMEOUT_MS,
  };
}

function hasActiveCompletionLease(completion) {
  return Boolean(completion?.activeExpiresAt && completion.activeExpiresAt > Date.now());
}

function raceCompletionBusyError(raceNumber) {
  return new TakaroUserError(`Race #${raceNumber} completion is still in progress. Please try again in a moment.`);
}

async function refreshCompletionLease(gameServerId, moduleId, lockOwner, raceData, result, nextRaceData) {
  if (lockOwner) await renewRaceLock(gameServerId, moduleId, lockOwner);
  const updatedRaceData = withCompletionProgress(raceData, result, nextRaceData, completionActiveLease(lockOwner));
  await updateRaceData(gameServerId, moduleId, updatedRaceData);
  return updatedRaceData;
}

function buildNextRaceData(raceData, result) {
  return {
    nextRaceTime: Date.now() + (2 * 60 * 60 * 1000),
    bets: [],
    lastRaceResults: result,
    raceNumber: raceData.raceNumber + 1,
  };
}

export async function completeRace(gameServerId, moduleId, config) {
  const requestedRaceNumber = (await getRaceData(gameServerId, moduleId)).raceNumber;
  let lockOwner;
  try {
    try {
      lockOwner = await acquireRaceLock(gameServerId, moduleId, 'complete-race');
    } catch (err) {
      if (err instanceof TakaroUserError) {
        const raceData = await getRaceData(gameServerId, moduleId);
        if (raceData.completion?.raceNumber === requestedRaceNumber) {
          if (raceData.completion.status === 'completed') {
            console.warn(`racing:completeRace duplicate completion returned completed journal result race=${requestedRaceNumber}`);
            return {
              result: raceData.completion.result,
              nextRaceData: raceData.completion.nextRaceData || raceData,
            };
          }
          console.warn(`racing:completeRace active completion is still busy race=${requestedRaceNumber} status=${raceData.completion.status}`);
          throw raceCompletionBusyError(requestedRaceNumber);
        }
        if (raceData.raceNumber !== requestedRaceNumber && raceData.lastRaceResults?.raceNumber === requestedRaceNumber) {
          console.warn(`racing:completeRace duplicate completion returned completed result race=${requestedRaceNumber}`);
          return {
            result: raceData.lastRaceResults,
            nextRaceData: raceData,
          };
        }
        if (raceData.lastRaceResults?.raceNumber === requestedRaceNumber) {
          console.warn(`racing:completeRace duplicate completion returned completed result race=${requestedRaceNumber}`);
          return {
            result: raceData.lastRaceResults,
            nextRaceData: raceData,
          };
        }
      }
      throw err;
    }

    let raceData = await getRaceData(gameServerId, moduleId);
    if (raceData.raceNumber !== requestedRaceNumber && raceData.lastRaceResults?.raceNumber === requestedRaceNumber) {
      console.warn(`racing:completeRace duplicate completion ignored race=${requestedRaceNumber} already advancedTo=${raceData.raceNumber}`);
      return {
        result: raceData.lastRaceResults,
        nextRaceData: raceData,
      };
    }

    let result;
    let nextRaceData;
    let jackpot = { isJackpot: false, amount: 0 };
    if (raceData.completion?.raceNumber === raceData.raceNumber) {
      if (hasActiveCompletionLease(raceData.completion)) {
        console.warn(`racing:completeRace active completion is still busy race=${raceData.raceNumber} owner=${raceData.completion.activeOwner || 'unknown'}`);
        throw raceCompletionBusyError(raceData.raceNumber);
      }
      if (raceData.completion.status === 'completed') {
        console.warn(`racing:completeRace duplicate completion ignored race=${raceData.raceNumber} status=completed`);
        return {
          result: raceData.completion.result,
          nextRaceData: raceData,
        };
      }
      console.warn(`racing:completeRace retrying pending finalization race=${raceData.raceNumber} status=${raceData.completion.status}`);
      result = raceData.completion.result;
      nextRaceData = raceData.completion.nextRaceData || buildNextRaceData(raceData, result);
      jackpot = { isJackpot: result.jackpot > 0, amount: result.jackpot || 0 };
      raceData = withCompletionProgress(raceData, result, nextRaceData, completionActiveLease(lockOwner));
      await updateRaceData(gameServerId, moduleId, raceData);
    } else {
      const entrants = parseEntrants(config);
      const results = simulateWeightedRace(entrants);
      const totalWagered = raceData.bets.reduce((sum, bet) => sum + bet.amount, 0);
      jackpot = raceData.bets.length > 0 ? await checkAndCreateJackpot(gameServerId, moduleId, totalWagered) : { isJackpot: false, amount: 0 };
      result = buildRaceResult(raceData, results, jackpot.isJackpot ? jackpot.amount : 0);
      nextRaceData = buildNextRaceData(raceData, result);
      raceData = withCompletionProgress(raceData, result, nextRaceData, completionActiveLease(lockOwner));
      await updateRaceData(gameServerId, moduleId, raceData);
    }

    for (const bet of result.bets) {
      raceData = await refreshCompletionLease(gameServerId, moduleId, lockOwner, raceData, result, nextRaceData);
      if (hasCompletionProgress(raceData.completion, 'finalizedPlayerIds', bet.playerId)) continue;

      const winningBet = result.winners.find((winner) => winner.playerId === bet.playerId);
      if (winningBet && !hasCompletionProgress(raceData.completion, 'payoutStartedPlayerIds', bet.playerId)) {
        const payoutStartedPlayerIds = [...normalizeProgressList(raceData.completion.payoutStartedPlayerIds), bet.playerId];
        raceData = withCompletionProgress(raceData, result, nextRaceData, { ...completionActiveLease(lockOwner), payoutStartedPlayerIds });
        await updateRaceData(gameServerId, moduleId, raceData);
        try {
          await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(gameServerId, bet.playerId, {
            currency: winningBet.payout,
          });
        } catch (err) {
          raceData = withCompletionProgress(raceData, result, nextRaceData, {
            ...completionActiveLease(lockOwner),
            payoutStartedPlayerIds: normalizeProgressList(raceData.completion.payoutStartedPlayerIds).filter((playerId) => playerId !== bet.playerId),
          });
          await updateRaceData(gameServerId, moduleId, raceData);
          throw err;
        }
      }

      raceData = await refreshCompletionLease(gameServerId, moduleId, lockOwner, raceData, result, nextRaceData);
      if (!hasCompletionProgress(raceData.completion, 'statsUpdatedPlayerIds', bet.playerId)) {
        const statUpdateId = `${result.raceNumber}:${bet.playerId}`;
        if (winningBet) {
          await updatePlayerStats(gameServerId, moduleId, bet.playerId, bet, true, winningBet.payout, statUpdateId);
        } else {
          await updatePlayerStats(gameServerId, moduleId, bet.playerId, bet, false, 0, statUpdateId);
        }

        raceData = await refreshCompletionLease(gameServerId, moduleId, lockOwner, raceData, result, nextRaceData);
        const statsUpdatedPlayerIds = [...normalizeProgressList(raceData.completion.statsUpdatedPlayerIds), bet.playerId];
        raceData = withCompletionProgress(raceData, result, nextRaceData, { ...completionActiveLease(lockOwner), statsUpdatedPlayerIds });
        await updateRaceData(gameServerId, moduleId, raceData);
      }

      raceData = await refreshCompletionLease(gameServerId, moduleId, lockOwner, raceData, result, nextRaceData);
      const finalizedPlayerIds = [...normalizeProgressList(raceData.completion.finalizedPlayerIds), bet.playerId];
      raceData = withCompletionProgress(raceData, result, nextRaceData, { ...completionActiveLease(lockOwner), finalizedPlayerIds });
      await updateRaceData(gameServerId, moduleId, raceData);
    }

    raceData = await refreshCompletionLease(gameServerId, moduleId, lockOwner, raceData, result, nextRaceData);
    if (jackpot.isJackpot) await clearJackpot(gameServerId, moduleId);

    const completedRaceData = {
      ...nextRaceData,
      completion: {
        ...raceData.completion,
        raceNumber: result.raceNumber,
        status: 'completed',
        result,
        completedAt: Date.now(),
      },
    };
    await updateRaceData(gameServerId, moduleId, completedRaceData);

    return { result, nextRaceData: completedRaceData };
  } finally {
    if (lockOwner) await releaseRaceLock(gameServerId, moduleId, lockOwner);
  }
}
