import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;
  const userConfig = mod.userConfig;
  const moduleId = mod.moduleId;
  const playerId = player?.id;

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

  const today = new Date().toISOString().slice(0, 10);

  async function checkBan() {
    const banV = await varSearch('minigames_ban:' + playerId);
    if (!banV) return;
    const ban = JSON.parse(banV.value);
    if (!ban.expiresAt || new Date(ban.expiresAt) > new Date()) {
      throw new TakaroUserError('You are banned from mini-games.');
    }
    await takaro.variable.variableControllerDelete(banV.id);
  }

  async function awardPoints(game, basePoints) {
    await checkBan();
    const tier = checkPermission(pog, 'MINIGAMES_BOOST')?.count ?? 0;
    const mult = 1 + Math.min(tier, 4) * 0.25;
    const boosted = Math.round(basePoints * mult);

    const cap = userConfig.dailyPointsCapPerPlayer || 0;
    let actual = boosted;
    if (cap > 0) {
      const windowKey = 'minigames_window:' + playerId + ':' + today;
      const winV = await varSearch(windowKey);
      const earned = winV ? (JSON.parse(winV.value).earned || 0) : 0;
      if (earned >= cap) {
        await pog.pm("You've hit today's point cap — try again after UTC midnight.");
        return 0;
      }
      actual = Math.min(boosted, cap - earned);
      if (winV) await varUpdate(winV.id, { earned: earned + actual });
      else await varCreate(windowKey, { earned: actual });
    }
    if (actual <= 0) return 0;

    const statsKey = 'minigames_stats:' + playerId;
    const statsV = await varSearch(statsKey);
    const s = statsV ? JSON.parse(statsV.value) : {
      totalPoints: 0, gamesPlayed: 0, biggestScore: null, perGame: {}, streaks: {}
    };
    s.totalPoints = (s.totalPoints || 0) + actual;
    s.gamesPlayed = (s.gamesPlayed || 0) + 1;
    if (!s.perGame[game]) s.perGame[game] = { points: 0, plays: 0, wins: 0 };
    s.perGame[game].points = (s.perGame[game].points || 0) + actual;
    s.perGame[game].wins = (s.perGame[game].wins || 0) + 1;
    if (!s.biggestScore || actual > s.biggestScore.points)
      s.biggestScore = { points: actual, game, at: new Date().toISOString() };
    if (statsV) await varUpdate(statsV.id, s);
    else await varCreate(statsKey, s);

    const rate = userConfig.pointsToCurrencyRate || 0;
    if (rate > 0) {
      const currency = Math.round(actual * rate);
      await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(gameServerId, pog.playerId, { currency });
    }

    const threshold = userConfig.bigScoreThreshold || 500;
    if (actual >= threshold) {
      await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
        message: 'BIG SCORE! ' + (pog.player?.name || 'A player') + ' earned ' + actual + ' points in ' + game + '!'
      });
    }
    return actual;
  }

  if (!checkPermission(pog, 'MINIGAMES_PLAY')) {
    throw new TakaroUserError('You need MINIGAMES_PLAY permission.');
  }

  const roundV = await varSearch('minigames_active_round');
  if (!roundV) {
    await pog.pm('No active live round right now.');
    return;
  }

  const round = JSON.parse(roundV.value);
  if (round.expiresAt && new Date(round.expiresAt) < new Date()) {
    await pog.pm('The round has already expired.');
    return;
  }

  const userResponse = data.arguments.response.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

  if (round.game === 'trivia' || round.game === 'scramble') {
    const correctAnswer = round.answer.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    if (userResponse !== correctAnswer) return;

    const pointKey = round.game === 'trivia' ? 'pointsTriviaWin' : 'pointsScrambleWin';
    const pts = userConfig[pointKey] || 40;
    const actual = await awardPoints(round.game, pts);
    await takaro.variable.variableControllerDelete(roundV.id);
    const emoji = round.game === 'trivia' ? 'TRIVIA' : 'SCRAMBLE';
    await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
      message: emoji + ' CORRECT! ' + (pog.player?.name || 'A player') + ' wins +' + actual + ' pts! Answer: ' + round.answer
    });

  } else if (round.game === 'mathrace') {
    const userNum = parseInt(data.arguments.response.trim(), 10);
    if (isNaN(userNum)) return;
    if (userNum !== round.answer) return;

    const pts2 = userConfig.pointsMathRaceWin || 40;
    const actual2 = await awardPoints('mathrace', pts2);
    await takaro.variable.variableControllerDelete(roundV.id);
    await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
      message: 'MATH CORRECT! ' + (pog.player?.name || 'A player') + ' = ' + round.answer + '. +' + actual2 + ' pts!'
    });

  } else if (round.game === 'reactionrace') {
    await pog.pm('Reaction race: type the token in chat, not as a command!');
  } else {
    await pog.pm('Unknown round type. Please wait for the next round.');
  }
}

await main();
