import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const moduleId = data.module.moduleId;
  const cfg = data.module.userConfig;
  const { pog, player, gameServerId } = data;
  const playerId = player?.id;

  async function checkBanAndCap(pid) {
    const banKey = `minigames_ban:${pid}`;
    const banRes = await takaro.variable.variableControllerSearch({
      filters: { key: [banKey], gameServerId: [gameServerId], moduleId: [moduleId] },
      page: 0, limit: 1
    });
    if (banRes.data.data.length > 0) {
      const banData = JSON.parse(banRes.data.data[0].value);
      if (!banData.expiresAt || new Date(banData.expiresAt) > new Date()) {
        throw new TakaroUserError('You are banned from mini-games.');
      }
      await takaro.variable.variableControllerDelete(banRes.data.data[0].id);
    }
    const cap = cfg.dailyPointsCapPerPlayer || 0;
    if (cap === 0) return { remainingToday: Infinity };
    const today = new Date().toISOString().slice(0, 10);
    const winKey = `minigames_window:${pid}:${today}`;
    const winRes = await takaro.variable.variableControllerSearch({
      filters: { key: [winKey], gameServerId: [gameServerId], moduleId: [moduleId] },
      page: 0, limit: 1
    });
    const earned = winRes.data.data.length > 0 ? (JSON.parse(winRes.data.data[0].value).earned || 0) : 0;
    const remaining = cap - earned;
    if (remaining <= 0) throw new TakaroUserError("You've hit today's point cap — try again after UTC midnight.");
    return { remainingToday: remaining };
  }

  async function awardPoints(pid, game, points) {
    const { remainingToday } = await checkBanAndCap(pid);
    const boostPerm = checkPermission(pog, 'MINIGAMES_BOOST');
    const tier = Math.min((boostPerm && boostPerm.count) ? boostPerm.count : 0, 4);
    const multiplier = 1 + tier * 0.25;
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
      if (currencyPaid > 0) await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(gameServerId, pid, { currency: currencyPaid });
    }
    const bigScoreThreshold = cfg.bigScoreThreshold || 500;
    if (actualPoints >= bigScoreThreshold) {
      await takaro.gameserver.gameServerControllerSendMessage(gameServerId, { message: `🏆 MEGA WIN! A player scored ${actualPoints} points in ${game}!` });
    }
    return { actualPoints, currencyPaid };
  }

  // 1. Read player's response argument
  const response = data.arguments.response;

  // 2. Check ban/cap before doing anything
  await checkBanAndCap(playerId);

  // 3. Read active round variable
  const roundRes = await takaro.variable.variableControllerSearch({
    filters: { key: ['minigames_active_round'], gameServerId: [gameServerId], moduleId: [moduleId] },
    page: 0, limit: 1
  });

  // 4. No active round
  if (roundRes.data.data.length === 0) {
    await pog.pm('❌ No active live round right now.');
    return;
  }

  const roundRecord = roundRes.data.data[0];
  const round = JSON.parse(roundRecord.value);

  // 5. Check if round is expired
  if (round.expiresAt && new Date(round.expiresAt) < new Date()) {
    await pog.pm('⏰ Too late — the round has already expired.');
    return;
  }

  function normalise(s) {
    return String(s).trim().toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
  }

  // 6. Dispatch on game type
  if (round.game === 'trivia') {
    const playerNorm = normalise(response);
    const answerNorm = normalise(round.answer);
    if (playerNorm === answerNorm) {
      const points = cfg.pointsTriviaWin || 40;
      const { actualPoints, currencyPaid } = await awardPoints(playerId, 'trivia', points);
      await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
        message: `🎉 ${player.name} answered correctly! "+${actualPoints} pts${currencyPaid > 0 ? ` (+${currencyPaid} currency)` : ''}`
      });
      await takaro.variable.variableControllerDelete(roundRecord.id);
    }
    // Wrong answer: no reply
  } else if (round.game === 'scramble') {
    const playerNorm = normalise(response);
    const answerNorm = normalise(round.answer);
    if (playerNorm === answerNorm) {
      const points = cfg.pointsScrambleWin || 40;
      const { actualPoints, currencyPaid } = await awardPoints(playerId, 'scramble', points);
      await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
        message: `🔤 ${player.name} unscrambled the word! +${actualPoints} pts${currencyPaid > 0 ? ` (+${currencyPaid} currency)` : ''}`
      });
      await takaro.variable.variableControllerDelete(roundRecord.id);
    }
    // Wrong answer: no reply
  } else if (round.game === 'mathrace') {
    const playerAnswer = parseInt(response, 10);
    if (!isNaN(playerAnswer) && playerAnswer === round.answer) {
      const points = cfg.pointsMathRaceWin || 40;
      const { actualPoints, currencyPaid } = await awardPoints(playerId, 'mathrace', points);
      await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
        message: `➗ ${player.name} solved the math race! +${actualPoints} pts${currencyPaid > 0 ? ` (+${currencyPaid} currency)` : ''}`
      });
      await takaro.variable.variableControllerDelete(roundRecord.id);
    }
    // Wrong answer: no reply
  } else if (round.game === 'reactionrace') {
    // reactionrace is handled by chat-message hook, not this command
    await pog.pm('No active round for that game type.');
  } else {
    await pog.pm('No active round for that game type.');
  }
}

await main();
