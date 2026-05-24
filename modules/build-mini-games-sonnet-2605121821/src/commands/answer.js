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
    let stats = { totalPoints: 0, gamesPlayed: 0, biggestScore: { points: 0, game: '', at: '' }, perGame: {}, streaks: {} };
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

  // Check MINIGAMES_PLAY permission
  if (!checkPermission(pog, 'MINIGAMES_PLAY')) {
    throw new TakaroUserError('You do not have permission to play mini-games.');
  }

  const playerResponse = (data.arguments.response ?? '').trim().toLowerCase();

  // Read active round variable
  const roundRes = await takaro.variable.variableControllerSearch({
    filters: { key: ['minigames_active_round'], gameServerId: [gameServerId] }
  });

  if (roundRes.data.data.length === 0) {
    throw new TakaroUserError('No active round right now. Watch for announcements!');
  }

  const roundVar = roundRes.data.data[0];
  const round = JSON.parse(roundVar.value);

  // Check expiry
  if (new Date(round.expiresAt) < new Date()) {
    throw new TakaroUserError('No active round right now. Watch for announcements!');
  }

  // Reaction race is handled by chat hook
  if (round.game === 'reactionrace') {
    throw new TakaroUserError('This round is a Reaction Race — type the token in chat directly!');
  }

  // Normalize stored answer
  const storedAnswer = (round.answer ?? '').trim().toLowerCase();

  // Compare based on answerType
  let isCorrect = false;
  if (round.answerType === 'number') {
    isCorrect = parseInt(playerResponse, 10) === parseInt(storedAnswer, 10);
  } else {
    // text — strip punctuation for trivia comparison
    const normalize = (s) => s.replace(/[^a-z0-9 ]/g, '');
    isCorrect = normalize(playerResponse) === normalize(storedAnswer);
  }

  // Wrong answer — silently return
  if (!isCorrect) {
    return;
  }

  // Correct answer flow
  // Delete the active round variable first (atomic claim)
  await takaro.variable.variableControllerDelete(roundVar.id);

  // Determine points from config
  const pointsMap = {
    trivia: userConfig.pointsTriviaWin ?? 40,
    scramble: userConfig.pointsScrambleWin ?? 40,
    mathrace: userConfig.pointsMathRaceWin ?? 40,
  };
  const basePoints = pointsMap[round.game] ?? 40;

  const playerName = player.name ?? pog.playerName ?? 'Unknown';

  const { actualPoints } = await awardPoints(pog.playerId, gameServerId, round.game, basePoints, playerName);

  // Game-specific emoji
  const emojiMap = { trivia: '❓', scramble: '🔤', mathrace: '➗' };
  const emoji = emojiMap[round.game] ?? '🏅';

  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: `${emoji} CORRECT! ${playerName} wins +${actualPoints} pts. Answer: ${round.answer}.`
  });
}

await main();
