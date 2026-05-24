import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;
  const userConfig = mod.userConfig;
  const moduleId = mod.moduleId;
  const playerId = player?.id;
  const today = new Date().toISOString().slice(0, 10);

  if (!checkPermission(pog, 'MINIGAMES_PLAY')) {
    throw new TakaroUserError('You need MINIGAMES_PLAY permission to play.');
  }

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
      totalPoints: 0, gamesPlayed: 0, biggestScore: null,
      perGame: {}, streaks: { wordle: { current: 0, best: 0, lastSolvedDate: null } }
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

  const guess = data.arguments?.guess;
  const sessionKey = 'minigames_session:' + playerId + ':wordle';
  const puzzleKey = 'minigames_puzzle_today';

  const puzzleV = await varSearch(puzzleKey);
  const puzzle = puzzleV ? JSON.parse(puzzleV.value) : null;

  if (!guess) {
    if (!puzzle || !puzzle.wordle) {
      await pog.pm("Today's Wordle isn't configured yet.");
      return;
    }
    const sessionV = await varSearch(sessionKey);
    let session = sessionV ? JSON.parse(sessionV.value) : null;
    if (!session) {
      session = { guesses: [], solved: false, completedAt: null };
      await varCreate(sessionKey, session);
    }
    if (session.solved) {
      const statsV2 = await varSearch('minigames_stats:' + playerId);
      const s2 = statsV2 ? JSON.parse(statsV2.value) : null;
      const streak = s2?.streaks?.wordle?.current || 0;
      await pog.pm('Wordle: Solved! You used ' + session.guesses.length + '/6 guesses. Streak: ' + streak + ' days');
    } else {
      const guessStr = session.guesses.length > 0 ? session.guesses.join(', ') : 'none';
      await pog.pm('Wordle: ' + session.guesses.length + '/6 guesses used. Your guesses: ' + guessStr + '. Use /wordle <5-letter-guess>');
    }
    return;
  }

  const g = guess.trim().toLowerCase();
  if (!/^[a-z]{5}$/.test(g)) {
    throw new TakaroUserError('Guess must be exactly 5 lowercase letters (a-z).');
  }

  if (!puzzle || !puzzle.wordle) {
    throw new TakaroUserError("Today's Wordle isn't available yet.");
  }

  const sessionV = await varSearch(sessionKey);
  const session = sessionV ? JSON.parse(sessionV.value) : { guesses: [], solved: false, completedAt: null };

  if (session.solved) {
    throw new TakaroUserError("You've already solved today's Wordle!");
  }
  if (session.guesses.length >= 6) {
    throw new TakaroUserError("You've used all 6 guesses. Better luck tomorrow!");
  }

  const contentV = await varSearch('minigames_content_wordle');
  if (contentV) {
    const bank = JSON.parse(contentV.value);
    if (bank.words?.length > 0 && !bank.words.includes(g)) {
      throw new TakaroUserError('Not in word list.');
    }
  }

  const target = puzzle.wordle;
  session.guesses.push(g);

  const feedback = g.split('').map((c, i) => {
    if (c === target[i]) return '[G]';
    if (target.includes(c)) return '[Y]';
    return '[X]';
  }).join('');

  if (g === target) {
    const n = session.guesses.length;
    const basePoints = Math.round((userConfig.pointsWordleBase || 100) * (7 - n) / 6);
    await checkBan();
    const actual = await awardPoints('wordle', basePoints);

    const statsKey2 = 'minigames_stats:' + playerId;
    const statsV2 = await varSearch(statsKey2);
    if (statsV2) {
      const s2 = JSON.parse(statsV2.value);
      if (!s2.streaks) s2.streaks = { wordle: { current: 0, best: 0, lastSolvedDate: null } };
      if (!s2.streaks.wordle) s2.streaks.wordle = { current: 0, best: 0, lastSolvedDate: null };
      const ws = s2.streaks.wordle;
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      ws.current = (ws.lastSolvedDate === yesterday || ws.lastSolvedDate === today) ? ws.current + 1 : 1;
      ws.best = Math.max(ws.best || 0, ws.current);
      ws.lastSolvedDate = today;
      await varUpdate(statsV2.id, s2);
      session.solved = true;
      session.completedAt = new Date().toISOString();
      if (sessionV) await varUpdate(sessionV.id, session);
      else await varCreate(sessionKey, session);
      await pog.pm('Wordle: ' + feedback + ' SOLVED in ' + n + '/6! +' + actual + ' pts. Streak: ' + ws.current + ' days');
    } else {
      session.solved = true;
      session.completedAt = new Date().toISOString();
      if (sessionV) await varUpdate(sessionV.id, session);
      else await varCreate(sessionKey, session);
      await pog.pm('Wordle: ' + feedback + ' SOLVED in ' + n + '/6! +' + actual + ' pts.');
    }
  } else if (session.guesses.length >= 6) {
    session.completedAt = new Date().toISOString();
    if (sessionV) await varUpdate(sessionV.id, session);
    else await varCreate(sessionKey, session);
    await pog.pm('Wordle: ' + feedback + ' Out of guesses! The word was: ' + target.toUpperCase() + '. Better luck tomorrow!');
  } else {
    if (sessionV) await varUpdate(sessionV.id, session);
    else await varCreate(sessionKey, session);
    await pog.pm('Wordle: ' + g.toUpperCase() + ' -> ' + feedback + ' (' + (6 - session.guesses.length) + ' guesses left)');
  }
}

await main();
