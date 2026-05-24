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

  async function awardPoints(pid, game, points, boostMultiplierOverride) {
    const { remainingToday } = await checkBanAndCap(pid);
    const boostPerm = checkPermission(pog, 'MINIGAMES_BOOST');
    const tier = Math.min((boostPerm && boostPerm.count) ? boostPerm.count : 0, 4);
    const multiplier = boostMultiplierOverride || (1 + tier * 0.25);
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
    let stats = { totalPoints: 0, gamesPlayed: 0, biggestScore: { points: 0, game: '', at: '' }, perGame: {}, streaks: { wordle: { current: 0, best: 0, lastSolvedDate: '' } } };
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
      if (currencyPaid > 0) await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(pid, gameServerId, { currency: currencyPaid });
    }
    const bigScoreThreshold = cfg.bigScoreThreshold || 500;
    if (actualPoints >= bigScoreThreshold) {
      await takaro.gameserver.gameServerControllerSendMessage(gameServerId, { message: `🏆 MEGA WIN! A player scored ${actualPoints} points in ${game}!` });
    }
    return { actualPoints, currencyPaid };
  }

  // Read today's puzzle
  const puzzleKey = 'minigames_puzzle_today';
  const puzzleRes = await takaro.variable.variableControllerSearch({
    filters: { key: [puzzleKey], gameServerId: [gameServerId], moduleId: [moduleId] },
    page: 0, limit: 1
  });

  let puzzle = null;
  if (puzzleRes.data.data.length > 0) {
    try {
      puzzle = JSON.parse(puzzleRes.data.data[0].value);
    } catch (e) {
      puzzle = null;
    }
  }

  const secret = puzzle?.hotcold != null ? puzzle.hotcold : null;

  // Read session
  const sessionKey = `minigames_session:${playerId}:hotcold`;
  const sessionRes = await takaro.variable.variableControllerSearch({
    filters: { key: [sessionKey], gameServerId: [gameServerId], moduleId: [moduleId] },
    page: 0, limit: 1
  });

  let session = { guesses: [], solved: false, failed: false };
  let sessionId = null;
  if (sessionRes.data.data.length > 0) {
    try {
      session = JSON.parse(sessionRes.data.data[0].value);
    } catch (e) {
      session = { guesses: [], solved: false, failed: false };
    }
    sessionId = sessionRes.data.data[0].id;
  }

  const numberArg = data.arguments?.number;

  // Helper: compute warmth label
  function getWarmth(guessNum, prevGuesses, secretNum) {
    if (prevGuesses.length === 0) return 'Baseline';
    const prevGuess = prevGuesses[prevGuesses.length - 1];
    const curDist = Math.abs(secretNum - guessNum);
    const prevDist = Math.abs(secretNum - prevGuess);
    if (curDist < prevDist) return 'Warmer 🔥';
    if (curDist > prevDist) return 'Colder 🧊';
    return 'Same';
  }

  if (secret === null) {
    await pog.pm('Hot/Cold not configured yet - admin needs to set up the number bank.');
    return;
  }

  if (!numberArg && numberArg !== 0) {
    // Status mode
    if (session.solved) {
      await pog.pm(`🌡️ Hot/Cold: SOLVED! The number was ${secret}.`);
      return;
    }
    if (session.failed) {
      await pog.pm(`🌡️ Hot/Cold: FAILED. The number was ${secret}.`);
      return;
    }
    if (session.guesses.length === 0) {
      await pog.pm('🌡️ Hot/Cold: No guesses yet. Guess a number 1-1000 with /hotcold <number>. You have 8 attempts.');
      return;
    }
    const trail = session.guesses.map((g, i) => {
      const dir = g < secret ? 'Higher' : g > secret ? 'Lower' : 'Correct';
      const warmth = i === 0 ? 'Baseline' : getWarmth(g, session.guesses.slice(0, i), secret);
      return `  ${g} → ${dir}. ${warmth}.`;
    }).join('\n');
    const remaining = 8 - session.guesses.length;
    await pog.pm(`🌡️ Hot/Cold (${remaining} guess${remaining !== 1 ? 'es' : ''} left):\n${trail}\nUse /hotcold <number> to continue.`);
    return;
  }

  // Guess mode
  const guessNum = Math.floor(Number(numberArg));

  if (!Number.isInteger(guessNum) || guessNum < 1 || guessNum > 1000) {
    throw new TakaroUserError('Please guess a whole number between 1 and 1000.');
  }

  if (session.solved) {
    await pog.pm('You already solved today\'s Hot/Cold! Come back tomorrow.');
    return;
  }

  if (session.failed || session.guesses.length >= 8) {
    await pog.pm(`No more guesses! The number was ${secret}. Come back tomorrow.`);
    return;
  }

  // Check ban/cap
  await checkBanAndCap(playerId);

  const prevGuesses = [...session.guesses];
  session.guesses.push(guessNum);

  const guessCount = session.guesses.length;
  const remaining = 8 - guessCount;

  if (guessNum === secret) {
    session.solved = true;
    const basePoints = cfg.pointsHotColdBase || 60;
    const points = Math.round(basePoints * (9 - guessCount) / 8);
    const { actualPoints, currencyPaid } = await awardPoints(playerId, 'hotcold', points);

    if (sessionId) {
      await takaro.variable.variableControllerUpdate(sessionId, { value: JSON.stringify(session) });
    } else {
      await takaro.variable.variableControllerCreate({ key: sessionKey, value: JSON.stringify(session), gameServerId, moduleId });
    }

    let msg = `🌡️ ${guessNum} → CORRECT! 🎉 The number was ${secret}! You got it in ${guessCount} guess${guessCount !== 1 ? 'es' : ''}! +${actualPoints} points`;
    if (currencyPaid > 0) msg += ` (+${currencyPaid} currency)`;
    await pog.pm(msg);
  } else {
    const direction = guessNum < secret ? 'Higher' : 'Lower';
    const warmth = getWarmth(guessNum, prevGuesses, secret);

    if (guessCount >= 8) {
      session.failed = true;

      if (sessionId) {
        await takaro.variable.variableControllerUpdate(sessionId, { value: JSON.stringify(session) });
      } else {
        await takaro.variable.variableControllerCreate({ key: sessionKey, value: JSON.stringify(session), gameServerId, moduleId });
      }

      await pog.pm(`🌡️ ${guessNum} → ${direction}. ${warmth}. (0 left)\n❌ Out of guesses! The number was ${secret}. Better luck tomorrow!`);
    } else {
      if (sessionId) {
        await takaro.variable.variableControllerUpdate(sessionId, { value: JSON.stringify(session) });
      } else {
        await takaro.variable.variableControllerCreate({ key: sessionKey, value: JSON.stringify(session), gameServerId, moduleId });
      }

      await pog.pm(`🌡️ ${guessNum} → ${direction}. ${warmth}. (${remaining} left)`);
    }
  }
}

await main();
