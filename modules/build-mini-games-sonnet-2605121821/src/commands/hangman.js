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
  const rawArg = data.arguments.letterOrWord;
  const letterOrWord = (rawArg && rawArg !== '__status__') ? rawArg : null;

  const puzzleRes = await takaro.variable.variableControllerSearch({ filters: { key: ['minigames_puzzle_today'], gameServerId: [gameServerId] } });
  if (puzzleRes.data.data.length === 0) { await pog.pm("🎪 Today's Hangman isn't available yet. Ask an admin to seed the word bank."); return; }
  const puzzleData = JSON.parse(puzzleRes.data.data[0].value || '{}');
  const target = puzzleData.hangman ? puzzleData.hangman.toUpperCase() : null;
  if (!target) { await pog.pm("🎪 Today's Hangman isn't available yet. Ask an admin to seed the word bank."); return; }

  const today = new Date().toISOString().slice(0, 10);
  const sessionKey = `minigames_session:${playerId}:hangman`;
  const sessionRes = await takaro.variable.variableControllerSearch({ filters: { key: [sessionKey], gameServerId: [gameServerId] } });
  let session = { lettersTried: [], wrongCount: 0, solved: false, completedAt: null, date: today };
  let sessionId = null;
  if (sessionRes.data.data.length > 0) {
    const loaded = JSON.parse(sessionRes.data.data[0].value);
    sessionId = sessionRes.data.data[0].id;
    if (loaded.date && loaded.date !== today) { session = { lettersTried: [], wrongCount: 0, solved: false, completedAt: null, date: today }; sessionId = null; }
    else { session = loaded; if (!session.date) session.date = today; }
  }

  async function saveSession(s) {
    if (sessionId) { await takaro.variable.variableControllerUpdate(sessionId, { value: JSON.stringify(s) }); }
    else { const created = await takaro.variable.variableControllerCreate({ key: sessionKey, value: JSON.stringify(s), gameServerId, moduleId }); sessionId = created.data.data.id; }
  }

  function getMasked(word, lettersTried) { return word.split('').map(c => lettersTried.includes(c) ? c : '_').join(' '); }
  function isFullyRevealed(word, lettersTried) { return word.split('').every(c => lettersTried.includes(c)); }

  if (session.solved || session.wrongCount >= 6) { await pog.pm("🎪 You've finished today's Hangman. Come back tomorrow!"); return; }

  if (!letterOrWord) {
    const masked = getMasked(target, session.lettersTried);
    const tried = session.lettersTried.join(' ') || 'none';
    await pog.pm(`🎪 ${masked} | Wrong: ${session.wrongCount}/6 | Tried: ${tried}`);
    return;
  }

  const input = letterOrWord.toUpperCase().replace(/[^A-Z]/g, '');
  if (input.length === 0) throw new TakaroUserError('Please provide a letter (a-z) or a full word.');

  if (input.length === 1) {
    const letter = input[0];
    if (session.lettersTried.includes(letter)) throw new TakaroUserError(`You already tried '${letter}'.`);
    session.lettersTried.push(letter);
    if (target.includes(letter)) {
      if (isFullyRevealed(target, session.lettersTried)) {
        session.solved = true; session.completedAt = new Date().toISOString(); await saveSession(session);
        const points = Math.round((userConfig.pointsHangmanBase ?? 80) * (7 - session.wrongCount) / 7);
        const { actualPoints, currencyPaid } = await awardPoints(playerId, gameServerId, 'hangman', points, playerName);
        let msg = `🎪 SOLVED! ${target} +${actualPoints} pts`; if (currencyPaid > 0) msg += `, +${currencyPaid} currency`;
        await pog.pm(msg);
      } else {
        await saveSession(session);
        await pog.pm(`🎪 '${letter.toLowerCase()}' is in the word! ${getMasked(target, session.lettersTried)}`);
      }
    } else {
      session.wrongCount++;
      if (session.wrongCount >= 6) { session.completedAt = new Date().toISOString(); await saveSession(session); await pog.pm(`🎪 Game over! The word was ${target}.`); }
      else { await saveSession(session); await pog.pm(`🎪 '${letter.toLowerCase()}' is not in the word. ${getMasked(target, session.lettersTried)} | Wrong: ${session.wrongCount}/6`); }
    }
  } else {
    if (input === target) {
      session.solved = true; session.completedAt = new Date().toISOString(); await saveSession(session);
      const points = Math.round((userConfig.pointsHangmanBase ?? 80) * (7 - session.wrongCount) / 7);
      const { actualPoints, currencyPaid } = await awardPoints(playerId, gameServerId, 'hangman', points, playerName);
      let msg = `🎪 SOLVED! ${target} +${actualPoints} pts`; if (currencyPaid > 0) msg += `, +${currencyPaid} currency`;
      await pog.pm(msg);
    } else {
      session.wrongCount = 6; session.completedAt = new Date().toISOString(); await saveSession(session);
      await pog.pm(`🎪 Wrong word! Game over. The word was ${target}.`);
    }
  }
}

await main();
