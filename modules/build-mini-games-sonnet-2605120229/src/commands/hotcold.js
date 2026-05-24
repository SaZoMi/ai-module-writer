import { data, takaro, checkPermission, TakaroUserError } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;

  const moduleId = data.module.id;
  const userConfig = data.module.userConfig;

  async function checkBanAndCap(pid) {
    const banSearch = await takaro.variable.variableControllerSearch({
      filters: { key: [`minigames_ban:${pid}`], moduleId: [moduleId], gameServerId: [gameServerId] },
      limit: 1
    });
    if (banSearch.data.data.length > 0) {
      const banVal = JSON.parse(banSearch.data.data[0].value);
      if (!banVal.expiresAt || new Date(banVal.expiresAt) > new Date()) {
        throw new TakaroUserError('You are banned from mini-games.');
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
    if (remaining <= 0) throw new TakaroUserError("You've hit today's point cap — try again after UTC midnight.");
    return { remainingToday: remaining };
  }

  async function awardPoints(pid, game, basePoints) {
    const boostPerm = checkPermission(pog, 'MINIGAMES_BOOST');
    const tier = Math.min((boostPerm && boostPerm.count) ? boostPerm.count : 0, 4);
    const multiplier = 1 + tier * 0.25;
    const boostedPoints = Math.round(basePoints * multiplier);
    const { remainingToday } = await checkBanAndCap(pid);
    const actualPoints = remainingToday === Infinity ? boostedPoints : Math.min(boostedPoints, remainingToday);
    if (actualPoints <= 0) {
      await pog.pm('Daily point cap reached — try again after midnight UTC.');
      return { actualPoints: 0 };
    }
    const today = new Date().toISOString().slice(0, 10);
    const windowKey = `minigames_window:${pid}:${today}`;
    const wSearch = await takaro.variable.variableControllerSearch({ filters: { key: [windowKey], moduleId: [moduleId], gameServerId: [gameServerId] }, limit: 1 });
    if (wSearch.data.data.length > 0) {
      const w = JSON.parse(wSearch.data.data[0].value);
      w.earned = (w.earned || 0) + actualPoints;
      await takaro.variable.variableControllerUpdate(wSearch.data.data[0].id, { value: JSON.stringify(w) });
    } else {
      await takaro.variable.variableControllerCreate({ key: windowKey, value: JSON.stringify({ earned: actualPoints }), moduleId, gameServerId });
    }
    const statsKey = `minigames_stats:${pid}`;
    const sSearch = await takaro.variable.variableControllerSearch({ filters: { key: [statsKey], moduleId: [moduleId], gameServerId: [gameServerId] }, limit: 1 });
    let stats = sSearch.data.data.length > 0 ? JSON.parse(sSearch.data.data[0].value) : { totalPoints: 0, gamesPlayed: 0, biggestScore: { points: 0, game: '', at: '' }, perGame: {}, streaks: { wordle: { current: 0, best: 0, lastSolvedDate: '' } } };
    stats.totalPoints = (stats.totalPoints || 0) + actualPoints;
    stats.gamesPlayed = (stats.gamesPlayed || 0) + 1;
    if (!stats.perGame[game]) stats.perGame[game] = { points: 0, plays: 0, wins: 0 };
    stats.perGame[game].points += actualPoints;
    stats.perGame[game].plays += 1;
    stats.perGame[game].wins += 1;
    if (actualPoints > (stats.biggestScore.points || 0)) stats.biggestScore = { points: actualPoints, game, at: new Date().toISOString() };
    if (sSearch.data.data.length > 0) {
      await takaro.variable.variableControllerUpdate(sSearch.data.data[0].id, { value: JSON.stringify(stats) });
    } else {
      await takaro.variable.variableControllerCreate({ key: statsKey, value: JSON.stringify(stats), moduleId, gameServerId });
    }
    const rate = userConfig.pointsToCurrencyRate || 0;
    if (rate > 0) {
      try { await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(gameServerId, pid, { currency: Math.round(actualPoints * rate) }); } catch(e) {}
    }
    const bigThreshold = userConfig.bigScoreThreshold || 500;
    if (actualPoints >= bigThreshold) {
      try { await takaro.gameserver.gameServerControllerSendMessage(gameServerId, { message: `🎉 BIG SCORE! ${pog.player.name} earned ${actualPoints} points in ${game}!` }); } catch(e) {}
    }
    return { actualPoints };
  }

  if (!checkPermission(pog, 'MINIGAMES_PLAY')) {
    throw new TakaroUserError('You do not have permission to play mini-games.');
  }

  const playerId = player.id;
  const pointsHotColdBase = userConfig.pointsHotColdBase || 60;

  // Read today's puzzle
  const puzzleSearch = await takaro.variable.variableControllerSearch({
    filters: { key: ['minigames_puzzle_today'], moduleId: [moduleId], gameServerId: [gameServerId] },
    limit: 1
  });

  if (puzzleSearch.data.data.length === 0) {
    throw new TakaroUserError('No puzzle available today. Check back later!');
  }

  const puzzleData = JSON.parse(puzzleSearch.data.data[0].value);
  if (puzzleData.hotcold === undefined || puzzleData.hotcold === null) {
    throw new TakaroUserError('Hot/Cold puzzle not available today.');
  }
  const secret = parseInt(puzzleData.hotcold, 10);

  // Read player session
  const sessionKey = `minigames_session:${playerId}:hotcold`;
  const sessionSearch = await takaro.variable.variableControllerSearch({
    filters: { key: [sessionKey], moduleId: [moduleId], gameServerId: [gameServerId] },
    limit: 1
  });

  let session = sessionSearch.data.data.length > 0
    ? JSON.parse(sessionSearch.data.data[0].value)
    : { guesses: [], solved: false, completedAt: null };

  const guessArg = data.arguments.number;

  // No arg: show trail
  if (guessArg === undefined || guessArg === null || guessArg === '') {
    if (session.guesses.length === 0) {
      await pog.pm('🌡️ Hot/Cold: Guess a number between 1-1000. You have 8 guesses. Use /hotcold <number> to guess!');
      return;
    }

    if (session.solved) {
      await pog.pm(`🌡️ You already solved today's Hot/Cold in ${session.guesses.length} guess(es)! Come back tomorrow.`);
      return;
    }

    if (session.guesses.length >= 8) {
      await pog.pm(`🌡️ Game over! You used all 8 guesses. The number was ${secret}.`);
      return;
    }

    // Build trail
    const trailParts = [];
    for (let i = 0; i < session.guesses.length; i++) {
      const g = session.guesses[i];
      const direction = g < secret ? 'higher' : 'lower';
      let warmth;
      if (i === 0) {
        warmth = 'baseline';
      } else {
        const prevDist = Math.abs(secret - session.guesses[i - 1]);
        const currDist = Math.abs(secret - g);
        if (currDist < prevDist) warmth = 'warmer';
        else if (currDist > prevDist) warmth = 'colder';
        else warmth = 'same';
      }
      trailParts.push(`${g} (${direction}, ${warmth})`);
    }
    const attemptsLeft = 8 - session.guesses.length;
    await pog.pm(`🌡️ Guesses: ${trailParts.join(', ')}. ${attemptsLeft} left.`);
    return;
  }

  // With arg: process guess
  if (session.solved) {
    await pog.pm('🌡️ You already solved today\'s Hot/Cold! Come back tomorrow.');
    return;
  }

  if (session.guesses.length >= 8) {
    await pog.pm(`🌡️ Game over! You used all 8 guesses. The number was ${secret}.`);
    return;
  }

  const guess = parseInt(guessArg, 10);
  if (isNaN(guess) || guess < 1 || guess > 1000 || !Number.isInteger(guess)) {
    throw new TakaroUserError('Please enter a whole number between 1 and 1000.');
  }

  const prevGuess = session.guesses.length > 0 ? session.guesses[session.guesses.length - 1] : null;
  session.guesses.push(guess);

  if (guess === secret) {
    session.solved = true;
    session.completedAt = new Date().toISOString();
    const pointsEarned = Math.round(pointsHotColdBase * (9 - session.guesses.length) / 8);
    const { actualPoints } = await awardPoints(playerId, 'hotcold', pointsEarned);
    // Save session
    if (sessionSearch.data.data.length > 0) {
      await takaro.variable.variableControllerUpdate(sessionSearch.data.data[0].id, { value: JSON.stringify(session) });
    } else {
      await takaro.variable.variableControllerCreate({ key: sessionKey, value: JSON.stringify(session), moduleId, gameServerId });
    }
    await pog.pm(`🌡️ SOLVED in ${session.guesses.length}! +${actualPoints} points.`);
    return;
  }

  const direction = guess < secret ? 'higher' : 'lower';
  let warmth;
  if (prevGuess === null) {
    warmth = 'Baseline';
  } else {
    const prevDist = Math.abs(secret - prevGuess);
    const currDist = Math.abs(secret - guess);
    if (currDist < prevDist) warmth = 'Warmer';
    else if (currDist > prevDist) warmth = 'Colder';
    else warmth = 'Same';
  }

  if (session.guesses.length >= 8) {
    session.completedAt = new Date().toISOString();
    // Save session
    if (sessionSearch.data.data.length > 0) {
      await takaro.variable.variableControllerUpdate(sessionSearch.data.data[0].id, { value: JSON.stringify(session) });
    } else {
      await takaro.variable.variableControllerCreate({ key: sessionKey, value: JSON.stringify(session), moduleId, gameServerId });
    }
    await pog.pm(`🌡️ Out of guesses! The number was ${secret}.`);
    return;
  }

  // Save session
  if (sessionSearch.data.data.length > 0) {
    await takaro.variable.variableControllerUpdate(sessionSearch.data.data[0].id, { value: JSON.stringify(session) });
  } else {
    await takaro.variable.variableControllerCreate({ key: sessionKey, value: JSON.stringify(session), moduleId, gameServerId });
  }

  const attemptsLeft = 8 - session.guesses.length;
  await pog.pm(`🌡️ ${direction.charAt(0).toUpperCase() + direction.slice(1)}. ${warmth}. (${attemptsLeft} left)`);
}

await main();
