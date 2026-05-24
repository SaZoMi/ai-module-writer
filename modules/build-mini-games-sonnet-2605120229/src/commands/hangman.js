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
  const input = data.arguments.letterOrWord ? data.arguments.letterOrWord.trim().toLowerCase() : null;

  // Read today's puzzle
  const puzzleSearch = await takaro.variable.variableControllerSearch({
    filters: { key: ['minigames_puzzle_today'], moduleId: [moduleId], gameServerId: [gameServerId] },
    limit: 1
  });

  if (puzzleSearch.data.data.length === 0) {
    throw new TakaroUserError('No puzzle set for today. Ask an admin to run the daily reset.');
  }

  const puzzle = JSON.parse(puzzleSearch.data.data[0].value);
  const target = puzzle.hangman;

  if (!target) {
    throw new TakaroUserError('No Hangman word set for today.');
  }

  // Read player session
  const sessionKey = `minigames_session:${playerId}:hangman`;
  const sessionSearch = await takaro.variable.variableControllerSearch({
    filters: { key: [sessionKey], moduleId: [moduleId], gameServerId: [gameServerId] },
    limit: 1
  });

  let session = sessionSearch.data.data.length > 0
    ? JSON.parse(sessionSearch.data.data[0].value)
    : { lettersTried: [], wrongCount: 0, solved: false, completedAt: null };

  // Helper: build masked display
  function getMasked(targetWord, lettersTried) {
    return targetWord.split('').map(ch => lettersTried.includes(ch) ? ch.toUpperCase() : '_').join(' ');
  }

  // Helper: check if fully revealed
  function isFullyRevealed(targetWord, lettersTried) {
    return targetWord.split('').every(ch => lettersTried.includes(ch));
  }

  // Helper: save session
  async function saveSession() {
    if (sessionSearch.data.data.length > 0) {
      await takaro.variable.variableControllerUpdate(sessionSearch.data.data[0].id, { value: JSON.stringify(session) });
    } else {
      await takaro.variable.variableControllerCreate({ key: sessionKey, value: JSON.stringify(session), moduleId, gameServerId });
    }
  }

  // If game is over
  if (session.solved || session.wrongCount >= 6) {
    if (session.solved) {
      await pog.pm(`🎪 You already solved today's Hangman! Come back tomorrow.`);
    } else {
      await pog.pm(`🎪 Today's Hangman is over. The word was: ${target.toUpperCase()}. Come back tomorrow!`);
    }
    return;
  }

  if (!input) {
    // Show current board
    const masked = getMasked(target, session.lettersTried);
    const triedDisplay = session.lettersTried.length > 0 ? session.lettersTried.map(l => l.toUpperCase()).join(', ') : 'none';
    await pog.pm(`🎪 ${masked} (wrong ${session.wrongCount}/6, tried: ${triedDisplay})`);
    return;
  }

  if (input.length === 1) {
    // Single letter guess
    if (!/^[a-z]$/.test(input)) {
      throw new TakaroUserError('Please enter a valid letter (a-z).');
    }

    if (session.lettersTried.includes(input)) {
      throw new TakaroUserError('You already tried that letter.');
    }

    session.lettersTried.push(input);

    if (target.includes(input)) {
      // Correct letter
      if (isFullyRevealed(target, session.lettersTried)) {
        // Solved by letters!
        session.solved = true;
        session.completedAt = new Date().toISOString();
        const pointsBase = userConfig.pointsHangmanBase || 80;
        const earned = Math.round(pointsBase * (7 - session.wrongCount) / 7);
        const { actualPoints } = await awardPoints(playerId, 'hangman', earned);
        await saveSession();
        await pog.pm(`🎪 SOLVED! The word was ${target.toUpperCase()}. +${actualPoints} points. 🎉`);
      } else {
        const masked = getMasked(target, session.lettersTried);
        await saveSession();
        await pog.pm(`🎪 Correct! ${masked} (wrong ${session.wrongCount}/6)`);
      }
    } else {
      // Wrong letter
      session.wrongCount++;
      if (session.wrongCount >= 6) {
        session.completedAt = new Date().toISOString();
        const masked = getMasked(target, session.lettersTried);
        await saveSession();
        await pog.pm(`🎪 Wrong! (${session.wrongCount}/6). Game over. The word was ${target.toUpperCase()}.`);
      } else {
        const masked = getMasked(target, session.lettersTried);
        await saveSession();
        await pog.pm(`🎪 Wrong! (${session.wrongCount}/6). ${masked}`);
      }
    }
  } else {
    // Full word guess
    if (input === target) {
      // Solved by word!
      session.solved = true;
      session.completedAt = new Date().toISOString();
      const pointsBase = userConfig.pointsHangmanBase || 80;
      const earned = Math.round(pointsBase * (7 - session.wrongCount) / 7);
      const { actualPoints } = await awardPoints(playerId, 'hangman', earned);
      await saveSession();
      await pog.pm(`🎪 SOLVED! The word was ${target.toUpperCase()}. +${actualPoints} pts. 🎉`);
    } else {
      // Wrong word — instant game over
      session.wrongCount = 6;
      session.completedAt = new Date().toISOString();
      await saveSession();
      await pog.pm(`🎪 Wrong word! Game over. The word was ${target.toUpperCase()}.`);
    }
  }
}

await main();
