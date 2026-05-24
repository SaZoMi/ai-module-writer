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

  const target = puzzle?.hangman ? puzzle.hangman.toLowerCase() : null;

  // Read session
  const sessionKey = `minigames_session:${playerId}:hangman`;
  const sessionRes = await takaro.variable.variableControllerSearch({
    filters: { key: [sessionKey], gameServerId: [gameServerId], moduleId: [moduleId] },
    page: 0, limit: 1
  });

  let session = { lettersTried: [], wrongCount: 0, solved: false, failed: false };
  let sessionId = null;
  if (sessionRes.data.data.length > 0) {
    try {
      session = JSON.parse(sessionRes.data.data[0].value);
    } catch (e) {
      session = { lettersTried: [], wrongCount: 0, solved: false, failed: false };
    }
    sessionId = sessionRes.data.data[0].id;
  }

  // Helper: build masked display
  function buildMasked(word, lettersTried) {
    return word.split('').map(ch => {
      if (ch === ' ') return ' ';
      return lettersTried.includes(ch) ? ch.toUpperCase() : '_';
    }).join(' ');
  }

  // Helper: check if word fully revealed
  function isFullyRevealed(word, lettersTried) {
    return word.split('').every(ch => ch === ' ' || lettersTried.includes(ch));
  }

  const letterOrWord = data.arguments?.letterOrWord;

  if (!target) {
    await pog.pm('Hangman not configured yet - admin needs to set up the word bank.');
    return;
  }

  if (!letterOrWord) {
    // Status mode
    const masked = buildMasked(target, session.lettersTried);
    if (session.solved) {
      await pog.pm(`🎪 Hangman: SOLVED! The word was: ${target.toUpperCase()}`);
    } else if (session.failed) {
      await pog.pm(`🎪 Hangman: FAILED. The word was: ${target.toUpperCase()}`);
    } else {
      const tried = session.lettersTried.map(l => l.toUpperCase()).join(',') || 'none';
      await pog.pm(`🎪 ${masked} (wrong ${session.wrongCount}/6, tried: ${tried})\nUse /hangman <letter> or /hangman <word> to guess.`);
    }
    return;
  }

  if (session.solved) {
    await pog.pm('You already solved today\'s Hangman! Come back tomorrow.');
    return;
  }

  if (session.failed || session.wrongCount >= 6) {
    await pog.pm(`Game over! The word was ${target.toUpperCase()}. Come back tomorrow!`);
    return;
  }

  const input = letterOrWord.toLowerCase().trim();

  // Check ban first
  await checkBanAndCap(playerId);

  // Determine if single letter or full word guess
  if (input.length === 1) {
    // Single letter guess
    if (!/^[a-z]$/.test(input)) {
      throw new TakaroUserError('Please guess a single letter (a-z).');
    }

    if (session.lettersTried.includes(input)) {
      await pog.pm(`You already tried '${input.toUpperCase()}'. Try a different letter.`);
      return;
    }

    session.lettersTried.push(input);

    if (!target.includes(input)) {
      session.wrongCount++;
    }

    const masked = buildMasked(target, session.lettersTried);
    const tried = session.lettersTried.map(l => l.toUpperCase()).join(',');

    if (isFullyRevealed(target, session.lettersTried)) {
      session.solved = true;
      const basePoints = cfg.pointsHangmanBase || 80;
      const points = Math.round(basePoints * (7 - session.wrongCount) / 7);
      const { actualPoints, currencyPaid } = await awardPoints(playerId, 'hangman', points);

      if (sessionId) {
        await takaro.variable.variableControllerUpdate(sessionId, { value: JSON.stringify(session) });
      } else {
        await takaro.variable.variableControllerCreate({ key: sessionKey, value: JSON.stringify(session), gameServerId, moduleId });
      }

      let msg = `🎪 ${masked}\n🎉 You solved Hangman! The word was ${target.toUpperCase()}. +${actualPoints} points`;
      if (currencyPaid > 0) msg += ` (+${currencyPaid} currency)`;
      await pog.pm(msg);
    } else if (session.wrongCount >= 6) {
      session.failed = true;

      if (sessionId) {
        await takaro.variable.variableControllerUpdate(sessionId, { value: JSON.stringify(session) });
      } else {
        await takaro.variable.variableControllerCreate({ key: sessionKey, value: JSON.stringify(session), gameServerId, moduleId });
      }

      await pog.pm(`🎪 ${masked} (wrong ${session.wrongCount}/6, tried: ${tried})\n💀 You've been hanged! The word was ${target.toUpperCase()}. Better luck tomorrow!`);
    } else {
      const inWord = target.includes(input);

      if (sessionId) {
        await takaro.variable.variableControllerUpdate(sessionId, { value: JSON.stringify(session) });
      } else {
        await takaro.variable.variableControllerCreate({ key: sessionKey, value: JSON.stringify(session), gameServerId, moduleId });
      }

      const hint = inWord ? `✅ '${input.toUpperCase()}' is in the word!` : `❌ '${input.toUpperCase()}' is not in the word.`;
      await pog.pm(`🎪 ${masked} (wrong ${session.wrongCount}/6, tried: ${tried})\n${hint}`);
    }
  } else {
    // Full word guess
    if (!/^[a-z]+$/.test(input)) {
      throw new TakaroUserError('Your word guess must contain only letters (a-z).');
    }

    if (input === target) {
      // Mark all letters as tried
      session.lettersTried = [...new Set([...session.lettersTried, ...target.split('')])];
      session.solved = true;
      const basePoints = cfg.pointsHangmanBase || 80;
      const points = Math.round(basePoints * (7 - session.wrongCount) / 7);
      const { actualPoints, currencyPaid } = await awardPoints(playerId, 'hangman', points);

      if (sessionId) {
        await takaro.variable.variableControllerUpdate(sessionId, { value: JSON.stringify(session) });
      } else {
        await takaro.variable.variableControllerCreate({ key: sessionKey, value: JSON.stringify(session), gameServerId, moduleId });
      }

      let msg = `🎪 ${target.toUpperCase()}\n🎉 Correct! You guessed the word! +${actualPoints} points`;
      if (currencyPaid > 0) msg += ` (+${currencyPaid} currency)`;
      await pog.pm(msg);
    } else {
      // Wrong word guess — game over
      session.wrongCount = 6;
      session.failed = true;

      if (sessionId) {
        await takaro.variable.variableControllerUpdate(sessionId, { value: JSON.stringify(session) });
      } else {
        await takaro.variable.variableControllerCreate({ key: sessionKey, value: JSON.stringify(session), gameServerId, moduleId });
      }

      await pog.pm(`❌ Wrong word! The word was ${target.toUpperCase()}. Game over! Come back tomorrow.`);
    }
  }
}

await main();
