import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, player, gameServerId, module: mod } = data;
  const moduleId = mod.id;
  const userConfig = mod.userConfig;

  async function checkBanAndCap(pid, gsId) {
    const banRes = await takaro.variable.variableControllerSearch({ filters: { key: [`minigames_ban:${pid}`], gameServerId: [gsId] } });
    if (banRes.data.data.length > 0) {
      const bd = JSON.parse(banRes.data.data[0].value || '{}');
      if (!bd.expiresAt || new Date(bd.expiresAt) > new Date()) throw new TakaroUserError('You are banned from mini-games.');
    }
    const cap = userConfig.dailyPointsCapPerPlayer ?? 0;
    if (!cap) return { remainingToday: Infinity };
    const today = new Date().toISOString().slice(0, 10);
    const winRes = await takaro.variable.variableControllerSearch({ filters: { key: [`minigames_window:${pid}:${today}`], gameServerId: [gsId] } });
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
    let stats = { totalPoints: 0, gamesPlayed: 0, biggestScore: { points: 0, game: '', at: '' }, perGame: {}, streaks: {} };
    if (sRes.data.data.length > 0) stats = JSON.parse(sRes.data.data[0].value);
    stats.totalPoints = (stats.totalPoints ?? 0) + actual;
    stats.gamesPlayed = (stats.gamesPlayed ?? 0) + 1;
    if (!stats.perGame[game]) stats.perGame[game] = { points: 0, plays: 0, wins: 0 };
    stats.perGame[game].points += actual; stats.perGame[game].plays += 1; stats.perGame[game].wins += 1;
    if (actual > (stats.biggestScore?.points ?? 0)) stats.biggestScore = { points: actual, game, at: new Date().toISOString() };
    if (sRes.data.data.length > 0) {
      await takaro.variable.variableControllerUpdate(sRes.data.data[0].id, { value: JSON.stringify(stats) });
    } else {
      await takaro.variable.variableControllerCreate({ key: sKey, value: JSON.stringify(stats), gameServerId: gsId, moduleId });
    }
    let currencyPaid = 0;
    const rate = userConfig.pointsToCurrencyRate ?? 0;
    if (rate > 0) { currencyPaid = Math.round(actual * rate); await takaro.playerOnGameserver.playerOnGameServerControllerAddCurrency(pid, gsId, { currency: currencyPaid }); }
    const threshold = userConfig.bigScoreThreshold ?? 500;
    if (actual >= threshold) await takaro.gameserver.gameServerControllerSendMessage(gsId, { message: `🏆 BIG SCORE! ${playerName} earned ${actual} points playing ${game}!` });
    return { actualPoints: actual, currencyPaid };
  }

  const playerId = player.playerId;
  const playerName = player.name;
  const numberArg = data.arguments.number;
  // 0 is the defaultValue sentinel meaning "show status"
  const isStatusView = !numberArg && numberArg !== undefined;

  const puzzleRes = await takaro.variable.variableControllerSearch({ filters: { key: ['minigames_puzzle_today'], gameServerId: [gameServerId] } });
  if (puzzleRes.data.data.length === 0) { await pog.pm("🌡️ Today's Hot/Cold isn't available yet."); return; }
  const puzzleData = JSON.parse(puzzleRes.data.data[0].value || '{}');
  const secret = puzzleData.hotcold !== undefined ? parseInt(puzzleData.hotcold, 10) : null;
  if (secret === null || isNaN(secret)) { await pog.pm("🌡️ Today's Hot/Cold isn't available yet."); return; }

  const today = new Date().toISOString().slice(0, 10);
  const sessionKey = `minigames_session:${playerId}:hotcold`;
  const sessionRes = await takaro.variable.variableControllerSearch({ filters: { key: [sessionKey], gameServerId: [gameServerId] } });
  let session = { guesses: [], solved: false, completedAt: null, date: today };
  let sessionId = null;
  if (sessionRes.data.data.length > 0) {
    const loaded = JSON.parse(sessionRes.data.data[0].value);
    sessionId = sessionRes.data.data[0].id;
    if (loaded.date && loaded.date !== today) { session = { guesses: [], solved: false, completedAt: null, date: today }; sessionId = null; }
    else { session = loaded; if (!session.date) session.date = today; }
  }

  async function saveSession(s) {
    if (sessionId) { await takaro.variable.variableControllerUpdate(sessionId, { value: JSON.stringify(s) }); }
    else { const created = await takaro.variable.variableControllerCreate({ key: sessionKey, value: JSON.stringify(s), gameServerId, moduleId }); sessionId = created.data.data.id; }
  }

  if (session.solved || session.guesses.length >= 8) { await pog.pm("🌡️ You've finished today's Hot/Cold. Come back tomorrow!"); return; }

  if (!numberArg) {
    // Status view
    if (session.guesses.length === 0) { await pog.pm('🌡️ Hot/Cold: Guess a number between 1 and 1000! You have 8 guesses. Use /hotcold <number>'); return; }
    let trail = `🌡️ Hot/Cold — Your guesses (${8 - session.guesses.length} left):\n`;
    for (let i = 0; i < session.guesses.length; i++) {
      const g = session.guesses[i];
      const direction = g < secret ? 'Higher' : g > secret ? 'Lower' : 'Correct';
      let warmth = i === 0 ? 'Baseline' : (() => { const pd = Math.abs(secret - session.guesses[i-1]); const cd = Math.abs(secret - g); return cd < pd ? 'Warmer' : cd > pd ? 'Colder' : 'Same'; })();
      trail += `  ${i+1}: ${g} → ${direction}. ${warmth}.\n`;
    }
    await pog.pm(trail.trim());
    return;
  }

  const guessNum = parseInt(String(numberArg), 10);
  if (isNaN(guessNum) || guessNum < 1 || guessNum > 1000) throw new TakaroUserError('Your guess must be a whole number between 1 and 1000.');

  const prevGuess = session.guesses.length > 0 ? session.guesses[session.guesses.length - 1] : null;
  session.guesses.push(guessNum);
  const n = session.guesses.length;

  if (guessNum === secret) {
    session.solved = true; session.completedAt = new Date().toISOString(); await saveSession(session);
    const points = Math.round((userConfig.pointsHotColdBase ?? 60) * (9 - n) / 8);
    const { actualPoints, currencyPaid } = await awardPoints(playerId, gameServerId, 'hotcold', points, playerName);
    let msg = `🌡️ SOLVED in ${n}! The secret was ${secret}. +${actualPoints} pts`;
    if (currencyPaid > 0) msg += `, +${currencyPaid} currency`;
    await pog.pm(msg);
  } else {
    const direction = guessNum < secret ? 'Higher' : 'Lower';
    const warmth = prevGuess === null ? 'Baseline' : (() => { const pd = Math.abs(secret - prevGuess); const cd = Math.abs(secret - guessNum); return cd < pd ? 'Warmer' : cd > pd ? 'Colder' : 'Same'; })();
    const left = 8 - n;
    if (n >= 8) { session.completedAt = new Date().toISOString(); await saveSession(session); await pog.pm(`🌡️ Guess ${guessNum} → ${direction}. ${warmth}.\n🌡️ Game over! Secret was ${secret}.`); }
    else { await saveSession(session); await pog.pm(`🌡️ Guess ${guessNum} → ${direction}. ${warmth}. (${left} left)`); }
  }
}

await main();
