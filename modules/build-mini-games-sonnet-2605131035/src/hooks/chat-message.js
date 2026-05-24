import { data, takaro, checkPermission } from '@takaro/helpers';

async function main() {
  // For chat-message hook, data contains: player, pog, gameServerId, module, eventData
  if (!data.player) return; // Ignore non-player messages

  const { player, pog, gameServerId, module: mod } = data;
  const moduleId = mod.moduleId;
  const playerId = player?.id;
  if (!playerId) return;

  async function varSearch(key) {
    const r = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] },
      page: { limit: 1 }
    });
    return r.data.data[0] || null;
  }
  async function varCreate(key, val) {
    return takaro.variable.variableControllerCreate({ key, value: JSON.stringify(val), gameServerId, moduleId });
  }
  async function varUpdate(id, val) {
    return takaro.variable.variableControllerUpdate(id, { value: JSON.stringify(val) });
  }
  async function varDelete(id) {
    return takaro.variable.variableControllerDelete(id);
  }

  // Check if reaction race is active
  const roundV = await varSearch('minigames_active_round');
  if (!roundV) return;
  const round = JSON.parse(roundV.value);
  if (round.game !== 'reactionrace') return;
  if (new Date(round.expiresAt) <= new Date()) return; // Expired

  // Get the chat message text
  const msg = (data.eventData?.msg || data.eventData?.message || '').trim().toLowerCase();
  const token = round.answer.trim().toLowerCase();
  if (msg !== token) return; // Not the token - silent

  // WINNER! Clear round first to prevent double-wins
  await varDelete(roundV.id);

  // Award points
  const userConfig = mod.userConfig;
  const today = new Date().toISOString().slice(0, 10);

  // Check ban
  const banV = await varSearch('minigames_ban:' + playerId);
  if (banV) {
    const ban = JSON.parse(banV.value);
    if (!ban.expiresAt || new Date(ban.expiresAt) > new Date()) return; // Banned - no award
    await varDelete(banV.id);
  }

  const tier = pog ? (checkPermission(pog, 'MINIGAMES_BOOST') ? 1 : 0) : 0;
  const mult = 1 + Math.min(tier, 4) * 0.25;
  const basePoints = userConfig.pointsReactionRaceWin || 20;
  const boosted = Math.round(basePoints * mult);

  // Daily cap
  const cap = userConfig.dailyPointsCapPerPlayer || 0;
  let actual = boosted;
  if (cap > 0) {
    const windowKey = 'minigames_window:' + playerId + ':' + today;
    const winV = await varSearch(windowKey);
    const earned = winV ? (JSON.parse(winV.value).earned || 0) : 0;
    actual = Math.min(boosted, Math.max(0, cap - earned));
    if (actual > 0) {
      if (winV) await varUpdate(winV.id, { earned: earned + actual });
      else await varCreate(windowKey, { earned: actual });
    }
  }

  if (actual > 0) {
    // Update stats
    const statsKey = 'minigames_stats:' + playerId;
    const statsV = await varSearch(statsKey);
    const s = statsV ? JSON.parse(statsV.value) : { totalPoints: 0, gamesPlayed: 0, biggestScore: null, perGame: {}, streaks: {} };
    s.totalPoints = (s.totalPoints || 0) + actual;
    s.gamesPlayed = (s.gamesPlayed || 0) + 1;
    if (!s.perGame.reactionrace) s.perGame.reactionrace = { points: 0, plays: 0, wins: 0 };
    s.perGame.reactionrace.points = (s.perGame.reactionrace.points || 0) + actual;
    s.perGame.reactionrace.wins = (s.perGame.reactionrace.wins || 0) + 1;
    if (!s.biggestScore || actual > s.biggestScore.points) s.biggestScore = { points: actual, game: 'reactionrace', at: new Date().toISOString() };
    if (statsV) await varUpdate(statsV.id, s);
    else await varCreate(statsKey, s);

    // Currency
    const rate = userConfig.pointsToCurrencyRate || 0;
    if (rate > 0 && pog) {
      const currency = Math.round(actual * rate);
      await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(gameServerId, pog.playerId, { currency });
    }
  }

  // Announce winner
  const winnerName = player.name || 'A player';
  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: 'FIRST! ' + winnerName + ' typed ' + round.answer + '! +' + actual + ' pts!'
  });
}

await main();
