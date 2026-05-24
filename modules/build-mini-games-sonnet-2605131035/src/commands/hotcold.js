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
    const key = 'minigames_session:' + playerId + ':hotcold';
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

  const rawArg = data.arguments?.number;
  const sessionKey = 'minigames_session:' + playerId + ':hotcold';
  const puzzleKey = 'minigames_puzzle_today';

  const puzzleV = await varSearch(puzzleKey);
  const puzzle = puzzleV ? JSON.parse(puzzleV.value) : null;

  if (rawArg === undefined || rawArg === null) {
    // NO-ARG: show status
    if (!puzzle || !puzzle.hotcold) {
      await pog.pm("🌡️ Today's Hot/Cold isn't configured yet.");
      return;
    }
    const sessionV = await varSearch(sessionKey);
    let session = sessionV ? JSON.parse(sessionV.value) : null;
    if (!session) {
      session = { guesses: [], solved: false, completedAt: null };
      await varCreate(sessionKey, session);
    }
    if (session.solved) {
      await pog.pm("🌡️ You already solved today's Hot/Cold!");
    } else if (session.guesses.length === 0) {
      await pog.pm("🌡️ Guess a number 1–1000 with /hotcold <number>. 8 attempts allowed.");
    } else {
      await pog.pm("🌡️ Guesses so far: " + session.guesses.join(', ') + ". " + (8 - session.guesses.length) + " attempts left.");
    }
    return;
  }

  // WITH-ARG: submit guess
  const guess = typeof rawArg === 'number' ? rawArg : parseInt(String(rawArg), 10);
  if (isNaN(guess) || guess < 1 || guess > 1000) {
    throw new TakaroUserError("Guess must be a number between 1 and 1000.");
  }

  if (!puzzle || !puzzle.hotcold) {
    throw new TakaroUserError("Today's Hot/Cold isn't available yet.");
  }
  const secret = puzzle.hotcold;

  const sessionV = await varSearch(sessionKey);
  let session = sessionV ? JSON.parse(sessionV.value) : { guesses: [], solved: false, completedAt: null };

  if (session.solved) {
    throw new TakaroUserError("You already solved today's Hot/Cold!");
  }
  if (session.guesses.length >= 8) {
    throw new TakaroUserError("Out of guesses! The number was " + secret + ".");
  }

  const prevGuesses = [...session.guesses];
  session.guesses.push(guess);

  if (guess === secret) {
    // SOLVED
    const n = session.guesses.length;
    await checkBan();
    const basePoints = Math.round((userConfig.pointsHotColdBase || 60) * (9 - n) / 8);
    const actual = await awardPoints('hotcold', basePoints);
    session.solved = true;
    session.completedAt = new Date().toISOString();
    await saveSession(session);
    await pog.pm("🌡️ Exact! SOLVED in " + n + " guesses! +" + actual + " pts.");
  } else {
    const direction = guess < secret ? 'Go higher ▲' : 'Go lower ▼';
    let warmth = 'Baseline.';
    if (prevGuesses.length > 0) {
      const prev = prevGuesses[prevGuesses.length - 1];
      const distNew = Math.abs(secret - guess);
      const distPrev = Math.abs(secret - prev);
      if (distNew < distPrev) warmth = 'Warmer! 🔥';
      else if (distNew > distPrev) warmth = 'Colder! 🧊';
      else warmth = 'Same temp.';
    }
    const attemptsLeft = 8 - session.guesses.length;
    await saveSession(session);
    if (attemptsLeft <= 0) {
      await pog.pm("🌡️ " + direction + " — " + warmth + " Out of guesses! The number was " + secret + ".");
    } else {
      await pog.pm("🌡️ " + direction + " — " + warmth + " (" + attemptsLeft + " left)");
    }
  }
}

await main();
