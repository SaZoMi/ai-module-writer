import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;
  const moduleId = mod.id;
  const userConfig = mod.userConfig;

  async function checkBanAndCap(pid, gsId) {
    const banRes = await takaro.variable.variableControllerSearch({
      filters: { key: [`minigames_ban:${pid}`], gameServerId: [gsId] }
    });
    if (banRes.data.data.length > 0) {
      const bd = JSON.parse(banRes.data.data[0].value || '{}');
      if (!bd.expiresAt || new Date(bd.expiresAt) > new Date()) {
        return false; // banned, ignore
      }
    }
    return true; // not banned
  }

  async function awardPoints(pid, gsId, game, basePoints, playerName) {
    // Check boost
    const boostPerm = checkPermission(pog, 'MINIGAMES_BOOST');
    const tier = Math.min(boostPerm?.count ?? 0, 4);
    const multiplier = 1 + tier * 0.25;
    const boosted = Math.round(basePoints * multiplier);
    const actual = boosted;

    // Update window
    const today = new Date().toISOString().slice(0, 10);
    const cap = userConfig.dailyPointsCapPerPlayer ?? 0;
    let remaining = Infinity;
    if (cap > 0) {
      const wKey = `minigames_window:${pid}:${today}`;
      const wRes = await takaro.variable.variableControllerSearch({ filters: { key: [wKey], gameServerId: [gsId] } });
      const earned = wRes.data.data.length > 0 ? (JSON.parse(wRes.data.data[0].value).earned ?? 0) : 0;
      remaining = cap - earned;
      if (remaining <= 0) return { actualPoints: 0, currencyPaid: 0 };
    }
    const realActual = remaining === Infinity ? actual : Math.min(actual, remaining);
    if (realActual <= 0) return { actualPoints: 0, currencyPaid: 0 };

    const wKey = `minigames_window:${pid}:${today}`;
    const wRes = await takaro.variable.variableControllerSearch({ filters: { key: [wKey], gameServerId: [gsId] } });
    if (wRes.data.data.length > 0) {
      const wv = JSON.parse(wRes.data.data[0].value);
      await takaro.variable.variableControllerUpdate(wRes.data.data[0].id, { value: JSON.stringify({ earned: (wv.earned ?? 0) + realActual }) });
    } else {
      await takaro.variable.variableControllerCreate({ key: wKey, value: JSON.stringify({ earned: realActual }), gameServerId: gsId, moduleId });
    }

    // Update stats
    const sKey = `minigames_stats:${pid}`;
    const sRes = await takaro.variable.variableControllerSearch({ filters: { key: [sKey], gameServerId: [gsId] } });
    let stats = { totalPoints: 0, gamesPlayed: 0, biggestScore: { points: 0, game: '', at: '' }, perGame: {}, streaks: {} };
    if (sRes.data.data.length > 0) stats = JSON.parse(sRes.data.data[0].value);
    stats.totalPoints = (stats.totalPoints ?? 0) + realActual;
    stats.gamesPlayed = (stats.gamesPlayed ?? 0) + 1;
    if (!stats.perGame[game]) stats.perGame[game] = { points: 0, plays: 0, wins: 0 };
    stats.perGame[game].points += realActual;
    stats.perGame[game].plays += 1;
    stats.perGame[game].wins += 1;
    if (realActual > (stats.biggestScore?.points ?? 0)) stats.biggestScore = { points: realActual, game, at: new Date().toISOString() };
    if (sRes.data.data.length > 0) {
      await takaro.variable.variableControllerUpdate(sRes.data.data[0].id, { value: JSON.stringify(stats) });
    } else {
      await takaro.variable.variableControllerCreate({ key: sKey, value: JSON.stringify(stats), gameServerId: gsId, moduleId });
    }

    // Currency
    let currencyPaid = 0;
    const rate = userConfig.pointsToCurrencyRate ?? 0;
    if (rate > 0) {
      currencyPaid = Math.round(realActual * rate);
      await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(pid, gsId, { currency: currencyPaid });
    }

    // Big score
    const threshold = userConfig.bigScoreThreshold ?? 500;
    if (realActual >= threshold) {
      await takaro.gameserver.gameServerControllerSendMessage(gsId, { message: `🏆 BIG SCORE! ${playerName} earned ${realActual} points playing ${game}!` });
    }
    return { actualPoints: realActual, currencyPaid };
  }

  // Read active round
  const roundRes = await takaro.variable.variableControllerSearch({
    filters: { key: ['minigames_active_round'], gameServerId: [gameServerId] }
  });

  // No active round → return early
  if (roundRes.data.data.length === 0) return;

  const roundRecord = roundRes.data.data[0];
  const round = JSON.parse(roundRecord.value);

  // Not a reaction race round → return early
  if (round.game !== 'reactionrace') return;

  // Round expired → return (closeLiveRound will handle it)
  if (new Date(round.expiresAt) <= new Date()) return;

  // No player info → return (server message, ignore)
  if (!player || !player.playerId) return;

  // Check if player is banned
  const allowed = await checkBanAndCap(player.playerId, gameServerId);
  if (!allowed) return;

  // Get incoming message
  const rawMsg = data.eventData?.msg ?? '';
  const msg = rawMsg.trim().toLowerCase();
  const token = (round.answer ?? '').trim().toLowerCase();

  // Wrong message → return silently
  if (msg !== token) return;

  // WINNER!
  // Delete the active round variable
  await takaro.variable.variableControllerDelete(roundRecord.id);

  // Award points
  const { actualPoints } = await awardPoints(
    player.playerId,
    gameServerId,
    'reactionrace',
    userConfig.pointsReactionRaceWin ?? 20,
    player.name
  );

  // Server-wide announcement
  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: `⚡ FIRST! @${player.name} snagged ${round.answer}. +${actualPoints} pts!`
  });
}

await main();
