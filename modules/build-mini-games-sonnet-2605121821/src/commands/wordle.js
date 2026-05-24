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
        throw new TakaroUserError('You are banned from mini-games.');
      }
    }
    const cap = userConfig.dailyPointsCapPerPlayer ?? 0;
    if (!cap) return { remainingToday: Infinity };
    const today = new Date().toISOString().slice(0, 10);
    const winRes = await takaro.variable.variableControllerSearch({
      filters: { key: [`minigames_window:${pid}:${today}`], gameServerId: [gsId] }
    });
    const earned = winRes.data.data.length > 0 ? (JSON.parse(winRes.data.data[0].value).earned ?? 0) : 0;
    const remaining = cap - earned;
    if (remaining <= 0) throw new TakaroUserError("You've hit today's point cap — try again after UTC midnight.");
    return { remainingToday: remaining };
  }

  async function awardPoints(pid, gsId, game, basePoints, playerName) {
    const { remainingToday } = await checkBanAndCap(pid, gsId);
    const boostPerm = checkPermission(pog, 'MINIGAMES_BOOST');
    const tier = Math.min(boostPerm?.count ?? 0, 4);
    const multiplier = 1 + tier * 0.25;
    const boosted = Math.round(basePoints * multiplier);
    const actual = remainingToday === Infinity ? boosted : Math.min(boosted, remainingToday);
    if (actual <= 0) return { actualPoints: 0, currencyPaid: 0 };
    const today = new Date().toISOString().slice(0, 10);
    const wKey = `minigames_window:${pid}:${today}`;
    const wRes = await takaro.variable.variableControllerSearch({ filters: { key: [wKey], gameServerId: [gsId] } });
    if (wRes.data.data.length > 0) {
      const wv = JSON.parse(wRes.data.data[0].value);
      await takaro.variable.variableControllerUpdate(wRes.data.data[0].id, { value: JSON.stringify({ earned: (wv.earned ?? 0) + actual }) });
    } else {
      await takaro.variable.variableControllerCreate({ key: wKey, value: JSON.stringify({ earned: actual }), gameServerId: gsId, moduleId });
    }
    const sKey = `minigames_stats:${pid}`;
    const sRes = await takaro.variable.variableControllerSearch({ filters: { key: [sKey], gameServerId: [gsId] } });
    let stats = { totalPoints: 0, gamesPlayed: 0, biggestScore: { points: 0, game: '', at: '' }, perGame: {}, streaks: { wordle: { current: 0, best: 0, lastSolvedDate: '' } } };
    if (sRes.data.data.length > 0) stats = JSON.parse(sRes.data.data[0].value);
    stats.totalPoints = (stats.totalPoints ?? 0) + actual;
    stats.gamesPlayed = (stats.gamesPlayed ?? 0) + 1;
    if (!stats.perGame[game]) stats.perGame[game] = { points: 0, plays: 0, wins: 0 };
    stats.perGame[game].points += actual;
    stats.perGame[game].plays += 1;
    stats.perGame[game].wins += 1;
    if (actual > (stats.biggestScore?.points ?? 0)) stats.biggestScore = { points: actual, game, at: new Date().toISOString() };
    if (sRes.data.data.length > 0) {
      await takaro.variable.variableControllerUpdate(sRes.data.data[0].id, { value: JSON.stringify(stats) });
    } else {
      await takaro.variable.variableControllerCreate({ key: sKey, value: JSON.stringify(stats), gameServerId: gsId, moduleId });
    }
    let currencyPaid = 0;
    const rate = userConfig.pointsToCurrencyRate ?? 0;
    if (rate > 0) {
      currencyPaid = Math.round(actual * rate);
      await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(pid, gsId, { currency: currencyPaid });
    }
    const threshold = userConfig.bigScoreThreshold ?? 500;
    if (actual >= threshold) {
      await takaro.gameserver.gameServerControllerSendMessage(gsId, { message: `🏆 BIG SCORE! ${playerName} earned ${actual} points playing ${game}!` });
    }
    return { actualPoints: actual, currencyPaid };
  }

  const playerId = player.playerId;
  const playerName = player.name;
  const rawGuess = data.arguments.guess;
  const guess = (rawGuess && rawGuess !== '__status__') ? rawGuess : null;

  // Load today's puzzle
  const puzzleRes = await takaro.variable.variableControllerSearch({
    filters: { key: ['minigames_puzzle_today'], gameServerId: [gameServerId] }
  });

  if (puzzleRes.data.data.length === 0) {
    await pog.pm("🟩 Today's Wordle isn't available yet. Ask an admin to seed the word bank.");
    return;
  }

  const puzzleData = JSON.parse(puzzleRes.data.data[0].value || '{}');
  const target = puzzleData.wordle ? puzzleData.wordle.toUpperCase() : null;

  if (!target) {
    await pog.pm("🟩 Today's Wordle isn't available yet. Ask an admin to seed the word bank.");
    return;
  }

  // Load session
  const sessionKey = `minigames_session:${playerId}:wordle`;
  const sessionRes = await takaro.variable.variableControllerSearch({
    filters: { key: [sessionKey], gameServerId: [gameServerId] }
  });

  const today = new Date().toISOString().slice(0, 10);
  let session = { guesses: [], solved: false, completedAt: null, date: today };
  let sessionId = null;
  if (sessionRes.data.data.length > 0) {
    const loaded = JSON.parse(sessionRes.data.data[0].value);
    sessionId = sessionRes.data.data[0].id;
    if (loaded.date && loaded.date !== today) {
      session = { guesses: [], solved: false, completedAt: null, date: today };
      sessionId = null;
    } else {
      session = loaded;
      if (!session.date) session.date = today;
    }
  }

  async function saveSession(s) {
    if (sessionId) {
      await takaro.variable.variableControllerUpdate(sessionId, { value: JSON.stringify(s) });
    } else {
      const created = await takaro.variable.variableControllerCreate({
        key: sessionKey, value: JSON.stringify(s), gameServerId, moduleId
      });
      sessionId = created.data.data.id;
    }
  }

  function computeFeedback(guessWord, targetWord) {
    const result = Array(5).fill('⬜');
    const targetArr = targetWord.split('');
    const guessArr = guessWord.split('');
    const used = Array(5).fill(false);
    for (let i = 0; i < 5; i++) {
      if (guessArr[i] === targetArr[i]) { result[i] = '🟩'; used[i] = true; }
    }
    for (let i = 0; i < 5; i++) {
      if (result[i] === '🟩') continue;
      for (let j = 0; j < 5; j++) {
        if (!used[j] && guessArr[i] === targetArr[j]) { result[i] = '🟨'; used[j] = true; break; }
      }
    }
    return result;
  }

  function formatGuessLine(guessWord, feedback) {
    let line = '';
    for (let i = 0; i < 5; i++) line += feedback[i] + guessWord[i];
    return line;
  }

  if (!guess) {
    // Status view
    if (session.guesses.length === 0) {
      await pog.pm('🟩 Wordle: Guess a 5-letter word! You have 6 guesses. Use /wordle <word>');
      return;
    }
    if (session.solved) {
      const n = session.guesses.length;
      await pog.pm(`🟩 You already SOLVED today's Wordle in ${n} guess${n === 1 ? '' : 'es'}! Come back tomorrow.`);
      return;
    }
    if (session.guesses.length >= 6) {
      await pog.pm(`🟩 Today's Wordle is over. The word was ${target}. Come back tomorrow!`);
      return;
    }
    let board = `🟩 Wordle — Guess ${session.guesses.length + 1}/6:\n`;
    for (const g of session.guesses) {
      const fb = computeFeedback(g, target);
      board += formatGuessLine(g, fb) + '\n';
    }
    const left = 6 - session.guesses.length;
    board += `(${left} guess${left === 1 ? '' : 'es'} left)`;
    await pog.pm(board);
    return;
  }

  // Guess submitted
  if (session.solved) { await pog.pm('🟩 You already solved today\'s Wordle! Come back tomorrow.'); return; }
  if (session.guesses.length >= 6) { await pog.pm(`🟩 Today's Wordle is over. The word was ${target}. Come back tomorrow!`); return; }

  const guessUpper = guess.toUpperCase();
  if (!/^[A-Z]{5}$/.test(guessUpper)) throw new TakaroUserError('Your guess must be exactly 5 letters (a-z only).');

  // Validate against content bank
  const contentRes = await takaro.variable.variableControllerSearch({
    filters: { key: ['minigames_content_wordle'], gameServerId: [gameServerId] }
  });
  if (contentRes.data.data.length > 0) {
    const contentData = JSON.parse(contentRes.data.data[0].value || '{}');
    const words = (contentData.words || []).map(w => w.toUpperCase());
    if (words.length > 0 && !words.includes(guessUpper)) throw new TakaroUserError(`'${guess}' is not in the word list.`);
  }

  session.guesses.push(guessUpper);
  const n = session.guesses.length;
  const feedback = computeFeedback(guessUpper, target);
  const feedbackStr = formatGuessLine(guessUpper, feedback);

  if (guessUpper === target) {
    session.solved = true;
    session.completedAt = new Date().toISOString();
    await saveSession(session);
    const basePoints = userConfig.pointsWordleBase ?? 100;
    const points = Math.round(basePoints * (7 - n) / 6);
    const { actualPoints, currencyPaid } = await awardPoints(playerId, gameServerId, 'wordle', points, playerName);

    // Update streak
    const sKey = `minigames_stats:${playerId}`;
    const sRes = await takaro.variable.variableControllerSearch({ filters: { key: [sKey], gameServerId: [gameServerId] } });
    if (sRes.data.data.length > 0) {
      const stats = JSON.parse(sRes.data.data[0].value);
      if (!stats.streaks) stats.streaks = { wordle: { current: 0, best: 0, lastSolvedDate: '' } };
      if (!stats.streaks.wordle) stats.streaks.wordle = { current: 0, best: 0, lastSolvedDate: '' };
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      stats.streaks.wordle.current = stats.streaks.wordle.lastSolvedDate === yesterday ? (stats.streaks.wordle.current ?? 0) + 1 : 1;
      if (stats.streaks.wordle.current > (stats.streaks.wordle.best ?? 0)) stats.streaks.wordle.best = stats.streaks.wordle.current;
      stats.streaks.wordle.lastSolvedDate = today;
      await takaro.variable.variableControllerUpdate(sRes.data.data[0].id, { value: JSON.stringify(stats) });
    }

    const boostPerm = checkPermission(pog, 'MINIGAMES_BOOST');
    const tier = Math.min(boostPerm?.count ?? 0, 4);
    const multiplier = 1 + tier * 0.25;
    let msg = `🟩 ${feedbackStr}\n🟩 SOLVED in ${n}! +${actualPoints} pts`;
    if (multiplier > 1) msg += ` (boost×${multiplier.toFixed(2)})`;
    if (currencyPaid > 0) msg += `, +${currencyPaid} currency`;
    const sRes2 = await takaro.variable.variableControllerSearch({ filters: { key: [`minigames_stats:${playerId}`], gameServerId: [gameServerId] } });
    if (sRes2.data.data.length > 0) {
      const stats2 = JSON.parse(sRes2.data.data[0].value);
      const streak = stats2.streaks?.wordle?.current ?? 1;
      msg += `. Streak: ${streak} 🔥`;
    }
    await pog.pm(msg);
  } else {
    const left = 6 - n;
    if (n >= 6) {
      session.completedAt = new Date().toISOString();
      const sKey = `minigames_stats:${playerId}`;
      const sRes = await takaro.variable.variableControllerSearch({ filters: { key: [sKey], gameServerId: [gameServerId] } });
      if (sRes.data.data.length > 0) {
        const stats = JSON.parse(sRes.data.data[0].value);
        if (stats.streaks?.wordle) { stats.streaks.wordle.current = 0; await takaro.variable.variableControllerUpdate(sRes.data.data[0].id, { value: JSON.stringify(stats) }); }
      }
      await saveSession(session);
      await pog.pm(`🟩 ${feedbackStr}\n🟩 Game over. The word was ${target}. Streak reset.`);
    } else {
      await saveSession(session);
      await pog.pm(`🟩 Guess ${n}/6: ${feedbackStr} (${left} guess${left === 1 ? '' : 'es'} left)`);
    }
  }
}

await main();
