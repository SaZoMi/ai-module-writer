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

  async function saveSession(session) {
    const key = 'minigames_session:' + playerId + ':hangman';
    const sv = await varSearch(key);
    if (sv) await varUpdate(sv.id, session);
    else await varCreate(key, session);
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
      await takaro.playerOnGameServer.playerOnGameServerControllerAddCurrency(pog.id, { currency });
    }

    const threshold = userConfig.bigScoreThreshold || 500;
    if (actual >= threshold) {
      await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
        message: `🎉 BIG SCORE! ${pog.player?.name || 'A player'} earned ${actual} points in ${game}!`
      });
    }
    return actual;
  }

  const input = data.arguments?.letterOrWord;
  const sessionKey = 'minigames_session:' + playerId + ':hangman';
  const puzzleKey = 'minigames_puzzle_today';

  const puzzleV = await varSearch(puzzleKey);
  const puzzle = puzzleV ? JSON.parse(puzzleV.value) : null;

  if (!input) {
    // NO-ARG: show status
    if (!puzzle || !puzzle.hangman) {
      await pog.pm("🎪 Today's Hangman isn't configured yet.");
      return;
    }
    const target = puzzle.hangman;
    const sessionV = await varSearch(sessionKey);
    let session = sessionV ? JSON.parse(sessionV.value) : null;
    if (!session) {
      session = { lettersTried: [], wrongCount: 0, solved: false, completedAt: null };
      await varCreate(sessionKey, session);
    }
    const masked = target.split('').map(c => session.lettersTried.includes(c) ? c.toUpperCase() : '_').join(' ');
    const triedStr = session.lettersTried.length ? session.lettersTried.join(', ').toUpperCase() : 'none';
    await pog.pm("🎪 " + masked + " (wrong: " + session.wrongCount + "/6, tried: " + triedStr + ")");
    return;
  }

  // WITH-ARG
  const letterOrWord = input.trim().toLowerCase();

  if (!puzzle || !puzzle.hangman) {
    throw new TakaroUserError("Today's Hangman isn't available.");
  }
  const target = puzzle.hangman;

  const sessionV = await varSearch(sessionKey);
  let session = sessionV ? JSON.parse(sessionV.value) : { lettersTried: [], wrongCount: 0, solved: false, completedAt: null };

  if (session.solved) {
    throw new TakaroUserError("You've already solved today's Hangman!");
  }
  if (session.wrongCount >= 6) {
    throw new TakaroUserError("Game over! No more guesses.");
  }

  if (letterOrWord.length === 1) {
    // Letter guess
    if (session.lettersTried.includes(letterOrWord)) {
      throw new TakaroUserError("You already tried '" + letterOrWord.toUpperCase() + "'.");
    }
    session.lettersTried.push(letterOrWord);

    if (target.includes(letterOrWord)) {
      const allRevealed = target.split('').every(c => session.lettersTried.includes(c));
      if (allRevealed) {
        await checkBan();
        const basePoints = Math.round((userConfig.pointsHangmanBase || 80) * (7 - session.wrongCount) / 7);
        const actual = await awardPoints('hangman', basePoints);
        session.solved = true;
        session.completedAt = new Date().toISOString();
        await saveSession(session);
        await pog.pm("🎪 " + target.toUpperCase() + " — SOLVED! +" + actual + " pts.");
      } else {
        const masked = target.split('').map(c => session.lettersTried.includes(c) ? c.toUpperCase() : '_').join(' ');
        await saveSession(session);
        await pog.pm("🎪 " + masked + " — good guess! (wrong: " + session.wrongCount + "/6)");
      }
    } else {
      session.wrongCount++;
      const masked = target.split('').map(c => session.lettersTried.includes(c) ? c.toUpperCase() : '_').join(' ');
      if (session.wrongCount >= 6) {
        session.completedAt = new Date().toISOString();
        await saveSession(session);
        await pog.pm("🎪 " + masked + " — Wrong! (" + letterOrWord.toUpperCase() + ") GAME OVER. Word was: " + target.toUpperCase());
      } else {
        await saveSession(session);
        await pog.pm("🎪 " + masked + " — Wrong! (" + letterOrWord.toUpperCase() + ") Lives: " + session.wrongCount + "/6");
      }
    }
  } else {
    // Word guess
    if (letterOrWord === target) {
      await checkBan();
      const basePoints = Math.round((userConfig.pointsHangmanBase || 80) * (7 - session.wrongCount) / 7);
      const actual = await awardPoints('hangman', basePoints);
      session.solved = true;
      session.completedAt = new Date().toISOString();
      await saveSession(session);
      await pog.pm("🎪 " + target.toUpperCase() + " — SOLVED by word guess! +" + actual + " pts.");
    } else {
      session.wrongCount = 6;
      session.completedAt = new Date().toISOString();
      await saveSession(session);
      await pog.pm("🎪 Wrong word! GAME OVER. The word was: " + target.toUpperCase());
    }
  }
}

await main();
