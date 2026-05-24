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

  async function awardPoints(pid, playerName, game, basePoints) {
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
      try { await takaro.gameserver.gameServerControllerSendMessage(gameServerId, { message: `🎉 BIG SCORE! ${playerName} earned ${actualPoints} points in ${game}!` }); } catch(e) {}
    }
    return { actualPoints };
  }

  // Step 1: Read active round
  const roundSearch = await takaro.variable.variableControllerSearch({
    filters: { key: ['minigames_active_round'], moduleId: [moduleId], gameServerId: [gameServerId] },
    limit: 1
  });

  if (roundSearch.data.data.length === 0) {
    throw new TakaroUserError('No active round right now. Wait for the next one!');
  }

  const roundRecord = roundSearch.data.data[0];
  const round = JSON.parse(roundRecord.value);

  // Step 2: Check expiry
  if (new Date() > new Date(round.expiresAt)) {
    throw new TakaroUserError('That round has ended. Better luck next time!');
  }

  // Step 3: Dispatch on game type
  const playerId = player.id;
  const playerName = player.name;

  if (round.game === 'reactionrace') {
    await pog.pm('Reaction race answers are sent in chat, not as commands.');
    return;
  }

  function normalize(str) {
    return String(str).trim().toLowerCase().replace(/[^\w\s]/g, '');
  }

  let correct = false;

  if (round.game === 'trivia') {
    const playerAnswer = normalize(data.arguments.response);
    const storedAnswer = normalize(round.answer);
    correct = playerAnswer === storedAnswer;
  } else if (round.game === 'scramble') {
    const playerAnswer = normalize(data.arguments.response);
    const storedAnswer = normalize(round.answer);
    correct = playerAnswer === storedAnswer;
  } else if (round.game === 'mathrace') {
    const playerAnswer = parseInt(data.arguments.response, 10);
    if (isNaN(playerAnswer)) return;
    correct = playerAnswer === round.answer;
  }

  // Step 4: Wrong answer — silent return
  if (!correct) return;

  // Step 5: Correct answer
  // a. Delete the active round variable to prevent double-winners
  await takaro.variable.variableControllerDelete(roundRecord.id);

  // b. Determine points
  let basePoints = 40;
  if (round.game === 'trivia') basePoints = userConfig.pointsTriviaWin || 40;
  else if (round.game === 'scramble') basePoints = userConfig.pointsScrambleWin || 40;
  else if (round.game === 'mathrace') basePoints = userConfig.pointsMathRaceWin || 40;

  // c. Award points
  const { actualPoints } = await awardPoints(playerId, playerName, round.game, basePoints);

  // d. Server-wide announcement
  let announcement = '';
  if (round.game === 'trivia') {
    announcement = `❓ CORRECT! @${playerName} wins +${actualPoints} points. Answer: ${round.answer}.`;
  } else if (round.game === 'scramble') {
    announcement = `🔤 CORRECT! @${playerName} unscrambled ${round.answer}. +${actualPoints} points.`;
  } else if (round.game === 'mathrace') {
    announcement = `➗ CORRECT! @${playerName} = ${round.answer}. +${actualPoints} points.`;
  }

  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, { message: announcement });
}

await main();
