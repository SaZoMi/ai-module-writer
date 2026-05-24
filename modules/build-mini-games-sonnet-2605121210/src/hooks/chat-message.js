import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const moduleId = data.module.moduleId;
  const cfg = data.module.userConfig;
  const { pog, player, gameServerId } = data;
  const playerId = player?.id;

  // If no player (server-sourced message), return immediately
  if (!player || !playerId) return;

  async function checkBanAndCap(pid) {
    const banKey = `minigames_ban:${pid}`;
    const banRes = await takaro.variable.variableControllerSearch({
      filters: { key: [banKey], gameServerId: [gameServerId], moduleId: [moduleId] },
      page: 0, limit: 1
    });
    if (banRes.data.data.length > 0) {
      const banData = JSON.parse(banRes.data.data[0].value);
      if (!banData.expiresAt || new Date(banData.expiresAt) > new Date()) return { banned: true };
      await takaro.variable.variableControllerDelete(banRes.data.data[0].id);
    }
    return { banned: false, remainingToday: Infinity };
  }

  async function awardPoints(pid, game, points) {
    const banCheck = await checkBanAndCap(pid);
    if (banCheck.banned) return { actualPoints: 0, currencyPaid: 0 };

    const boostPerm = pog ? checkPermission(pog, 'MINIGAMES_BOOST') : null;
    const tier = Math.min((boostPerm && boostPerm.count) ? boostPerm.count : 0, 4);
    const multiplier = 1 + tier * 0.25;

    const cap = cfg.dailyPointsCapPerPlayer || 0;
    let remainingToday = Infinity;
    if (cap > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const winKey = `minigames_window:${pid}:${today}`;
      const winRes = await takaro.variable.variableControllerSearch({
        filters: { key: [winKey], gameServerId: [gameServerId], moduleId: [moduleId] },
        page: 0, limit: 1
      });
      const earned = winRes.data.data.length > 0 ? (JSON.parse(winRes.data.data[0].value).earned || 0) : 0;
      remainingToday = cap - earned;
      if (remainingToday <= 0) return { actualPoints: 0, currencyPaid: 0 };
    }

    const boostedPoints = Math.round(points * multiplier);
    const actualPoints = remainingToday === Infinity ? boostedPoints : Math.min(boostedPoints, remainingToday);
    if (actualPoints <= 0) return { actualPoints: 0, currencyPaid: 0 };

    const today = new Date().toISOString().slice(0, 10);
    const winKey = `minigames_window:${pid}:${today}`;
    const winRes = await takaro.variable.variableControllerSearch({
      filters: { key: [winKey], gameServerId: [gameServerId], moduleId: [moduleId] },
      page: 0, limit: 1
    });
    if (winRes.data.data.length > 0) {
      const w = JSON.parse(winRes.data.data[0].value);
      w.earned = (w.earned || 0) + actualPoints;
      await takaro.variable.variableControllerUpdate(winRes.data.data[0].id, { value: JSON.stringify(w) });
    } else {
      await takaro.variable.variableControllerCreate({ key: winKey, value: JSON.stringify({ earned: actualPoints }), gameServerId, moduleId });
    }

    const statsKey = `minigames_stats:${pid}`;
    const statsRes = await takaro.variable.variableControllerSearch({
      filters: { key: [statsKey], gameServerId: [gameServerId], moduleId: [moduleId] },
      page: 0, limit: 1
    });
    let stats = { totalPoints: 0, gamesPlayed: 0, biggestScore: { points: 0, game: '', at: '' }, perGame: {}, streaks: {} };
    let statsId = null;
    if (statsRes.data.data.length > 0) { stats = JSON.parse(statsRes.data.data[0].value); statsId = statsRes.data.data[0].id; }
    stats.totalPoints = (stats.totalPoints || 0) + actualPoints;
    stats.gamesPlayed = (stats.gamesPlayed || 0) + 1;
    if (!stats.perGame) stats.perGame = {};
    if (!stats.perGame[game]) stats.perGame[game] = { points: 0, plays: 0, wins: 0 };
    stats.perGame[game].points = (stats.perGame[game].points || 0) + actualPoints;
    stats.perGame[game].wins = (stats.perGame[game].wins || 0) + 1;
    if (actualPoints > (stats.biggestScore?.points || 0)) stats.biggestScore = { points: actualPoints, game, at: new Date().toISOString() };
    if (statsId) { await takaro.variable.variableControllerUpdate(statsId, { value: JSON.stringify(stats) }); }
    else { await takaro.variable.variableControllerCreate({ key: statsKey, value: JSON.stringify(stats), gameServerId, moduleId }); }

    let currencyPaid = 0;
    const rate = cfg.pointsToCurrencyRate || 0;
    if (rate > 0) {
      currencyPaid = Math.round(actualPoints * rate);
      if (currencyPaid > 0) await takaro.playerOnGameServer.playerOnGameServerControllerAddCurrency(pid, gameServerId, { currency: currencyPaid });
    }
    const bigScoreThreshold = cfg.bigScoreThreshold || 500;
    if (actualPoints >= bigScoreThreshold) {
      await takaro.gameserver.gameServerControllerSendMessage(gameServerId, { message: `🏆 MEGA WIN! A player scored ${actualPoints} points in reactionrace!` });
    }
    return { actualPoints, currencyPaid };
  }

  // Read the active round variable
  const roundRes = await takaro.variable.variableControllerSearch({
    filters: { key: ['minigames_active_round'], gameServerId: [gameServerId], moduleId: [moduleId] },
    page: 0, limit: 1
  });

  // No active round — nothing to do
  if (roundRes.data.data.length === 0) return;

  const round = JSON.parse(roundRes.data.data[0].value);
  const roundVarId = roundRes.data.data[0].id;

  // Only handle reaction race via chat; other games use /answer command
  if (round.game !== 'reactionrace') return;

  // Check if the round has expired
  if (round.expiresAt && new Date(round.expiresAt) < new Date()) return;

  // Normalise both sides for comparison
  const incoming = data.eventData.msg.trim().toLowerCase();
  const expected = round.answer.trim().toLowerCase();

  if (incoming === expected) {
    // Player wins — award points
    const { actualPoints } = await awardPoints(playerId, 'reactionrace', cfg.pointsReactionRaceWin || 20);

    // Announce server-wide
    await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
      message: `⚡ FIRST! ${player.name} snapped ${round.prompt}. +${actualPoints} points.`
    });

    // Delete the active round so no one else can win
    await takaro.variable.variableControllerDelete(roundVarId);
  }
  // No match — do nothing (avoid chat spam)
}

await main();
