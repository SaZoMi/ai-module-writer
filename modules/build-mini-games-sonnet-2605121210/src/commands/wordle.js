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

  const target = puzzle?.wordle ? puzzle.wordle.toLowerCase() : null;

  // Read session
  const sessionKey = `minigames_session:${playerId}:wordle`;
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

  const guess = data.arguments?.guess;

  // Helper to compute feedback
  function computeFeedback(guessWord, targetWord) {
    const result = [];
    const targetArr = targetWord.split('');
    const guessArr = guessWord.split('');
    const used = new Array(5).fill(false);

    // First pass: correct positions
    const feedback = new Array(5).fill('⬜');
    for (let i = 0; i < 5; i++) {
      if (guessArr[i] === targetArr[i]) {
        feedback[i] = '🟩';
        used[i] = true;
        guessArr[i] = null;
      }
    }
    // Second pass: wrong position
    for (let i = 0; i < 5; i++) {
      if (feedback[i] === '🟩') continue;
      for (let j = 0; j < 5; j++) {
        if (!used[j] && guessArr[i] === targetArr[j]) {
          feedback[i] = '🟨';
          used[j] = true;
          break;
        }
      }
    }
    return feedback;
  }

  if (!guess) {
    // Status mode
    if (!target) {
      await pog.pm('Wordle not configured yet - admin needs to set up the word bank.');
      return;
    }
    if (session.guesses.length === 0) {
      await pog.pm('Wordle: No guesses yet. Use /wordle <5-letter-word> to guess!');
      return;
    }
    const originalGuess = data.arguments?.guess;
    const lines = session.guesses.map((g, idx) => {
      const fb = computeFeedback(g, target);
      const letters = g.toUpperCase().split('').map((ch, i) => `${fb[i]}${ch}`).join('');
      return `${letters} (${idx + 1}/6)`;
    });
    if (session.solved) {
      await pog.pm(`Wordle: SOLVED! ✅\n${lines.join('\n')}`);
    } else if (session.failed) {
      await pog.pm(`Wordle: FAILED. The word was ${target.toUpperCase()}.\n${lines.join('\n')}`);
    } else {
      await pog.pm(`Wordle: ${session.guesses.length}/6 guesses used.\n${lines.join('\n')}\nUse /wordle <guess> to continue.`);
    }
    return;
  }

  // Guess mode
  if (!target) {
    await pog.pm('Wordle not configured yet - admin needs to set up the word bank.');
    return;
  }

  if (session.solved) {
    await pog.pm('You already solved today\'s Wordle! Come back tomorrow.');
    return;
  }

  if (session.failed || session.guesses.length >= 6) {
    await pog.pm('No attempts remaining today. Come back tomorrow!');
    return;
  }

  // Validate guess
  const normalizedGuess = guess.toLowerCase().trim();
  if (!/^[a-z]{5}$/.test(normalizedGuess)) {
    throw new TakaroUserError('Your guess must be exactly 5 lowercase letters (a-z).');
  }

  // Check ban/cap before processing
  await checkBanAndCap(playerId);

  // Append guess
  session.guesses.push(normalizedGuess);

  const feedback = computeFeedback(normalizedGuess, target);
  const displayLetters = normalizedGuess.toUpperCase().split('').map((ch, i) => `${feedback[i]}${ch}`).join('');
  const guessCount = session.guesses.length;

  if (normalizedGuess === target) {
    session.solved = true;
    const basePoints = cfg.pointsWordleBase || 100;
    const points = Math.round(basePoints * (7 - guessCount) / 6);

    // Update streak in stats
    const statsKey = `minigames_stats:${playerId}`;
    const statsRes2 = await takaro.variable.variableControllerSearch({
      filters: { key: [statsKey], gameServerId: [gameServerId], moduleId: [moduleId] },
      page: 0, limit: 1
    });
    let stats2 = { totalPoints: 0, gamesPlayed: 0, biggestScore: { points: 0, game: '', at: '' }, perGame: {}, streaks: { wordle: { current: 0, best: 0, lastSolvedDate: '' } } };
    let statsId2 = null;
    if (statsRes2.data.data.length > 0) {
      try { stats2 = JSON.parse(statsRes2.data.data[0].value); } catch(e) {}
      statsId2 = statsRes2.data.data[0].id;
    }
    if (!stats2.streaks) stats2.streaks = { wordle: { current: 0, best: 0, lastSolvedDate: '' } };
    if (!stats2.streaks.wordle) stats2.streaks.wordle = { current: 0, best: 0, lastSolvedDate: '' };

    const today = new Date().toISOString().slice(0, 10);
    const lastDate = stats2.streaks.wordle.lastSolvedDate;
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (lastDate === yesterday) {
      stats2.streaks.wordle.current = (stats2.streaks.wordle.current || 0) + 1;
    } else if (lastDate !== today) {
      stats2.streaks.wordle.current = 1;
    }
    stats2.streaks.wordle.lastSolvedDate = today;
    if (stats2.streaks.wordle.current > (stats2.streaks.wordle.best || 0)) {
      stats2.streaks.wordle.best = stats2.streaks.wordle.current;
    }

    if (statsId2) {
      await takaro.variable.variableControllerUpdate(statsId2, { value: JSON.stringify(stats2) });
    } else {
      await takaro.variable.variableControllerCreate({ key: statsKey, value: JSON.stringify(stats2), gameServerId, moduleId });
    }

    const { actualPoints, currencyPaid } = await awardPoints(playerId, 'wordle', points);

    // Save session
    if (sessionId) {
      await takaro.variable.variableControllerUpdate(sessionId, { value: JSON.stringify(session) });
    } else {
      await takaro.variable.variableControllerCreate({ key: sessionKey, value: JSON.stringify(session), gameServerId, moduleId });
    }

    let msg = `🟩 ${normalizedGuess.toUpperCase()} → ${displayLetters} (${guessCount}/6)\n🎉 You solved today's Wordle in ${guessCount} guess${guessCount !== 1 ? 'es' : ''}! +${actualPoints} points`;
    if (currencyPaid > 0) msg += ` (+${currencyPaid} currency)`;
    if (stats2.streaks.wordle.current > 1) msg += ` | 🔥 Streak: ${stats2.streaks.wordle.current}`;
    await pog.pm(msg);
  } else {
    if (guessCount === 6) {
      session.failed = true;
      // Reset streak
      const statsKey2 = `minigames_stats:${playerId}`;
      const statsRes3 = await takaro.variable.variableControllerSearch({
        filters: { key: [statsKey2], gameServerId: [gameServerId], moduleId: [moduleId] },
        page: 0, limit: 1
      });
      if (statsRes3.data.data.length > 0) {
        try {
          const s = JSON.parse(statsRes3.data.data[0].value);
          if (s.streaks?.wordle) s.streaks.wordle.current = 0;
          await takaro.variable.variableControllerUpdate(statsRes3.data.data[0].id, { value: JSON.stringify(s) });
        } catch(e) {}
      }
    }

    // Save session
    if (sessionId) {
      await takaro.variable.variableControllerUpdate(sessionId, { value: JSON.stringify(session) });
    } else {
      await takaro.variable.variableControllerCreate({ key: sessionKey, value: JSON.stringify(session), gameServerId, moduleId });
    }

    let msg = `${displayLetters} (${guessCount}/6)`;
    if (guessCount === 6) {
      msg += `\n❌ Out of guesses! The word was ${target.toUpperCase()}. Better luck tomorrow!`;
    } else {
      msg += ` — Keep going! ${6 - guessCount} guess${6 - guessCount !== 1 ? 'es' : ''} remaining.`;
    }
    await pog.pm(msg);
  }
}

await main();
