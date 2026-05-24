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

  // Check permission
  if (!checkPermission(pog, 'MINIGAMES_PLAY')) {
    throw new TakaroUserError('You do not have permission to play mini-games.');
  }

  const playerId = player.id;
  const guess = data.arguments.guess ? data.arguments.guess.trim().toLowerCase() : null;

  // Read today's puzzle
  const puzzleSearch = await takaro.variable.variableControllerSearch({
    filters: { key: ['minigames_puzzle_today'], moduleId: [moduleId], gameServerId: [gameServerId] },
    limit: 1
  });

  if (puzzleSearch.data.data.length === 0) {
    throw new TakaroUserError('No puzzle set for today. Ask an admin to run the daily reset.');
  }

  const puzzle = JSON.parse(puzzleSearch.data.data[0].value);
  const target = puzzle.wordle;

  if (!target) {
    throw new TakaroUserError('No Wordle word set for today.');
  }

  // Read player session
  const sessionKey = `minigames_session:${playerId}:wordle`;
  const sessionSearch = await takaro.variable.variableControllerSearch({
    filters: { key: [sessionKey], moduleId: [moduleId], gameServerId: [gameServerId] },
    limit: 1
  });

  let session = sessionSearch.data.data.length > 0
    ? JSON.parse(sessionSearch.data.data[0].value)
    : { guesses: [], solved: false, completedAt: null };

  // If game is over
  if (session.solved || session.guesses.length >= 6) {
    if (session.solved) {
      await pog.pm(`🟩 You already solved today's Wordle in ${session.guesses.length} guess(es)! Come back tomorrow.`);
    } else {
      await pog.pm(`⬜ Today's Wordle is over. The word was: ${target.toUpperCase()}. Come back tomorrow!`);
    }
    return;
  }

  // Helper: compute feedback for a guess vs target
  function computeFeedback(guessWord, targetWord) {
    const result = Array(5).fill('⬜');
    const targetCount = {};
    // Count letters in target
    for (const ch of targetWord) {
      targetCount[ch] = (targetCount[ch] || 0) + 1;
    }
    // First pass: mark correct positions
    const usedInTarget = {};
    for (let i = 0; i < 5; i++) {
      if (guessWord[i] === targetWord[i]) {
        result[i] = '🟩';
        usedInTarget[i] = true;
        targetCount[guessWord[i]]--;
      }
    }
    // Second pass: mark wrong position
    for (let i = 0; i < 5; i++) {
      if (result[i] === '🟩') continue;
      const ch = guessWord[i];
      if (targetCount[ch] && targetCount[ch] > 0) {
        result[i] = '🟨';
        targetCount[ch]--;
      }
    }
    return result;
  }

  function renderGuesses(guessArr, targetWord) {
    return guessArr.map(g => {
      const fb = computeFeedback(g, targetWord);
      return `${g.toUpperCase()} → ${g.split('').map((ch, i) => `${ch.toUpperCase()}${fb[i]}`).join('')}`;
    }).join(' | ');
  }

  if (!guess) {
    // Show current status
    const attemptsLeft = 6 - session.guesses.length;
    if (session.guesses.length === 0) {
      await pog.pm(`🟩 Wordle: Guess a 5-letter word! Use /wordle <word>. You have ${attemptsLeft} attempts.`);
    } else {
      const display = renderGuesses(session.guesses, target);
      await pog.pm(`🟩 Wordle [${session.guesses.length}/6]: ${display} | Attempts left: ${attemptsLeft}`);
    }
    return;
  }

  // Validate guess
  if (!/^[a-z]{5}$/.test(guess)) {
    throw new TakaroUserError('Guess must be exactly 5 lowercase letters (a-z).');
  }

  // Check word list
  const contentSearch = await takaro.variable.variableControllerSearch({
    filters: { key: ['minigames_content_wordle'], moduleId: [moduleId], gameServerId: [gameServerId] },
    limit: 1
  });

  if (contentSearch.data.data.length > 0) {
    const content = JSON.parse(contentSearch.data.data[0].value);
    if (Array.isArray(content.words) && !content.words.includes(guess)) {
      throw new TakaroUserError('Unknown word — not in today\'s word list.');
    }
  } else {
    throw new TakaroUserError('Unknown word — not in today\'s word list.');
  }

  // Add guess
  session.guesses.push(guess);
  const feedback = computeFeedback(guess, target);
  const feedbackLine = guess.split('').map((ch, i) => `${ch.toUpperCase()}${feedback[i]}`).join('');
  const attemptsLeft = 6 - session.guesses.length;

  if (guess === target) {
    // Solved!
    session.solved = true;
    session.completedAt = new Date().toISOString();

    const pointsBase = userConfig.pointsWordleBase || 100;
    const earned = Math.round(pointsBase * (7 - session.guesses.length) / 6);
    const { actualPoints } = await awardPoints(playerId, 'wordle', earned);

    // Update streak in stats
    const statsKey = `minigames_stats:${playerId}`;
    const sSearch = await takaro.variable.variableControllerSearch({ filters: { key: [statsKey], moduleId: [moduleId], gameServerId: [gameServerId] }, limit: 1 });
    if (sSearch.data.data.length > 0) {
      const stats = JSON.parse(sSearch.data.data[0].value);
      if (!stats.streaks) stats.streaks = { wordle: { current: 0, best: 0, lastSolvedDate: '' } };
      if (!stats.streaks.wordle) stats.streaks.wordle = { current: 0, best: 0, lastSolvedDate: '' };
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (stats.streaks.wordle.lastSolvedDate === yesterday) {
        stats.streaks.wordle.current = (stats.streaks.wordle.current || 0) + 1;
      } else {
        stats.streaks.wordle.current = 1;
      }
      if (stats.streaks.wordle.current > (stats.streaks.wordle.best || 0)) {
        stats.streaks.wordle.best = stats.streaks.wordle.current;
      }
      stats.streaks.wordle.lastSolvedDate = today;
      await takaro.variable.variableControllerUpdate(sSearch.data.data[0].id, { value: JSON.stringify(stats) });
    }

    // Determine boost multiplier for display
    const boostPerm = checkPermission(pog, 'MINIGAMES_BOOST');
    const tier = Math.min((boostPerm && boostPerm.count) ? boostPerm.count : 0, 4);
    const multiplier = 1 + tier * 0.25;

    // Re-read streak for display
    const sSearch2 = await takaro.variable.variableControllerSearch({ filters: { key: [statsKey], moduleId: [moduleId], gameServerId: [gameServerId] }, limit: 1 });
    let streakVal = 1;
    if (sSearch2.data.data.length > 0) {
      const st = JSON.parse(sSearch2.data.data[0].value);
      streakVal = (st.streaks && st.streaks.wordle) ? st.streaks.wordle.current : 1;
    }

    await pog.pm(`🟩 SOLVED in ${session.guesses.length}! ${feedbackLine} +${actualPoints} points (boost×${multiplier}). Streak: ${streakVal} 🔥`);
  } else if (session.guesses.length >= 6) {
    // Failed
    session.solved = false;
    session.completedAt = new Date().toISOString();

    // Reset wordle streak
    const statsKey = `minigames_stats:${playerId}`;
    const sSearch = await takaro.variable.variableControllerSearch({ filters: { key: [statsKey], moduleId: [moduleId], gameServerId: [gameServerId] }, limit: 1 });
    if (sSearch.data.data.length > 0) {
      const stats = JSON.parse(sSearch.data.data[0].value);
      if (!stats.streaks) stats.streaks = { wordle: { current: 0, best: 0, lastSolvedDate: '' } };
      if (!stats.streaks.wordle) stats.streaks.wordle = { current: 0, best: 0, lastSolvedDate: '' };
      stats.streaks.wordle.current = 0;
      await takaro.variable.variableControllerUpdate(sSearch.data.data[0].id, { value: JSON.stringify(stats) });
    }

    await pog.pm(`🟥 Game over. ${feedbackLine} The word was ${target.toUpperCase()}. Streak reset.`);
  } else {
    await pog.pm(`🟨 ${guess.toUpperCase()} → ${feedbackLine} (${attemptsLeft} left)`);
  }

  // Save session
  if (sessionSearch.data.data.length > 0) {
    await takaro.variable.variableControllerUpdate(sessionSearch.data.data[0].id, { value: JSON.stringify(session) });
  } else {
    await takaro.variable.variableControllerCreate({ key: sessionKey, value: JSON.stringify(session), moduleId, gameServerId });
  }
}

await main();
