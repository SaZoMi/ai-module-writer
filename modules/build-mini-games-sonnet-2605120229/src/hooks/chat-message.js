import { data, takaro, TakaroUserError } from '@takaro/helpers';

async function main() {
  const { player, gameServerId, module: mod, eventData } = data;
  const moduleId = data.module.id;
  const userConfig = data.module.userConfig;

  // Step 1: Read active round
  const roundSearch = await takaro.variable.variableControllerSearch({
    filters: { key: ['minigames_active_round'], moduleId: [moduleId], gameServerId: [gameServerId] },
    limit: 1
  });

  if (roundSearch.data.data.length === 0) return;

  const roundRecord = roundSearch.data.data[0];
  const round = JSON.parse(roundRecord.value);

  // Step 2: Only handle reactionrace
  if (round.game !== 'reactionrace') return;

  // Step 3: Check expiry
  if (new Date() > new Date(round.expiresAt)) return;

  // Step 4: No player (server-sourced message) → skip
  if (!player) return;

  // Step 5 & 6: Normalize incoming message and round answer
  const incomingMsg = (eventData.msg || '').trim().toLowerCase();
  const expectedToken = round.answer.trim().toLowerCase();

  // Step 7: No match → return silently
  if (incomingMsg !== expectedToken) return;

  // Step 8a: Delete the active round variable to prevent double-winners
  await takaro.variable.variableControllerDelete(roundRecord.id);

  // Step 8b: Award points inline (hook context — no pog object)
  const pid = player.id;
  const playerName = player.name;
  const basePoints = userConfig.pointsReactionRaceWin || 40;

  async function checkBanAndCap(pid) {
    const banSearch = await takaro.variable.variableControllerSearch({
      filters: { key: [`minigames_ban:${pid}`], moduleId: [moduleId], gameServerId: [gameServerId] },
      limit: 1
    });
    if (banSearch.data.data.length > 0) {
      const banVal = JSON.parse(banSearch.data.data[0].value);
      if (!banVal.expiresAt || new Date(banVal.expiresAt) > new Date()) {
        // Player is banned — silently return, no award
        return { remainingToday: 0, banned: true };
      }
    }
    const cap = userConfig.dailyPointsCapPerPlayer || 0;
    if (cap === 0) return { remainingToday: Infinity };
    const today = new Date().toISOString().slice(0, 10);
    const wSearch = await takaro.variable.variableControllerSearch({
      filters: { key: [`minigames_window:${pid}:${today}`], moduleId: [moduleId], gameServerId: [gameServerId] },
      limit: 1
    });
    const earned = wSearch.data.data.length > 0 ? JSON.parse(wSearch.data.data[0].value).earned : 0;
    const remaining = cap - earned;
    if (remaining <= 0) return { remainingToday: 0 };
    return { remainingToday: remaining };
  }

  const { remainingToday, banned } = await checkBanAndCap(pid);
  if (banned || remainingToday === 0) return;

  // No boost perm available in hook context (no pog) — use multiplier 1
  const boostedPoints = basePoints;
  const actualPoints = remainingToday === Infinity ? boostedPoints : Math.min(boostedPoints, remainingToday);
  if (actualPoints <= 0) return;

  // Update daily window
  const today = new Date().toISOString().slice(0, 10);
  const windowKey = `minigames_window:${pid}:${today}`;
  const wSearch = await takaro.variable.variableControllerSearch({
    filters: { key: [windowKey], moduleId: [moduleId], gameServerId: [gameServerId] },
    limit: 1
  });
  if (wSearch.data.data.length > 0) {
    const w = JSON.parse(wSearch.data.data[0].value);
    w.earned = (w.earned || 0) + actualPoints;
    await takaro.variable.variableControllerUpdate(wSearch.data.data[0].id, { value: JSON.stringify(w) });
  } else {
    await takaro.variable.variableControllerCreate({ key: windowKey, value: JSON.stringify({ earned: actualPoints }), moduleId, gameServerId });
  }

  // Update stats
  const statsKey = `minigames_stats:${pid}`;
  const sSearch = await takaro.variable.variableControllerSearch({
    filters: { key: [statsKey], moduleId: [moduleId], gameServerId: [gameServerId] },
    limit: 1
  });
  let stats = sSearch.data.data.length > 0
    ? JSON.parse(sSearch.data.data[0].value)
    : { totalPoints: 0, gamesPlayed: 0, biggestScore: { points: 0, game: '', at: '' }, perGame: {}, streaks: { wordle: { current: 0, best: 0, lastSolvedDate: '' } } };

  stats.totalPoints = (stats.totalPoints || 0) + actualPoints;
  stats.gamesPlayed = (stats.gamesPlayed || 0) + 1;
  if (!stats.perGame['reactionrace']) stats.perGame['reactionrace'] = { points: 0, plays: 0, wins: 0 };
  stats.perGame['reactionrace'].points += actualPoints;
  stats.perGame['reactionrace'].plays += 1;
  stats.perGame['reactionrace'].wins += 1;
  if (actualPoints > (stats.biggestScore.points || 0)) {
    stats.biggestScore = { points: actualPoints, game: 'reactionrace', at: new Date().toISOString() };
  }

  if (sSearch.data.data.length > 0) {
    await takaro.variable.variableControllerUpdate(sSearch.data.data[0].id, { value: JSON.stringify(stats) });
  } else {
    await takaro.variable.variableControllerCreate({ key: statsKey, value: JSON.stringify(stats), moduleId, gameServerId });
  }

  // Currency conversion
  const rate = userConfig.pointsToCurrencyRate || 0;
  if (rate > 0) {
    try {
      await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(gameServerId, pid, { currency: Math.round(actualPoints * rate) });
    } catch(e) {}
  }

  // Big score threshold
  const bigThreshold = userConfig.bigScoreThreshold || 500;
  if (actualPoints >= bigThreshold) {
    try {
      await takaro.gameserver.gameServerControllerSendMessage(gameServerId, { message: `🎉 BIG SCORE! ${playerName} earned ${actualPoints} points in reactionrace!` });
    } catch(e) {}
  }

  // Step 8c: Server-wide announcement
  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: `⚡ FIRST! @${playerName} snapped ${round.answer}. +${actualPoints} points.`
  });
}

await main();
