import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';
import {
  getVariable, checkBanAndCap, awardPoints, clearActiveRound, normaliseAnswer, recordPlay,
} from './mini-games-helpers.js';

async function main() {
  const { pog, player, gameServerId, arguments: args, module: mod } = data;

  if (!checkPermission(pog, 'MINIGAMES_PLAY')) {
    throw new TakaroUserError('You do not have permission to use mini-games.');
  }

  const moduleId = mod.moduleId;
  const config = mod.userConfig;

  const round = await getVariable(gameServerId, moduleId, 'minigames_active_round');
  if (!round) {
    throw new TakaroUserError('There is no active live round right now. Wait for the next one!');
  }

  // Check if expired
  if (round.expiresAt && new Date(round.expiresAt) < new Date()) {
    throw new TakaroUserError('That round has already expired!');
  }

  const response = args.response ? String(args.response).trim() : '';
  if (!response) {
    throw new TakaroUserError('Please provide an answer. Usage: /answer <your answer>');
  }

  // Check ban/cap BEFORE doing any game logic — banned players must not be able to grief
  await checkBanAndCap(gameServerId, moduleId, pog.playerId, config);

  const game = round.game;
  let correct = false;

  if (game === 'trivia' || game === 'scramble') {
    correct = normaliseAnswer(response) === normaliseAnswer(round.answer);
  } else if (game === 'mathrace') {
    const guessNum = parseInt(response, 10);
    correct = !isNaN(guessNum) && guessNum === round.answer;
  } else if (game === 'reactionrace') {
    // reaction race uses the chat hook, not /answer
    throw new TakaroUserError('This is a Reaction Race! Type the token in chat, not as a command.');
  } else {
    // Unknown game type — do nothing
    await pog.pm('No active round you can answer via /answer right now.');
    return;
  }

  if (!correct) {
    // Silent drop — don't spam chat with "wrong answer"
    return;
  }

  // Winner — award points first so a transient API failure doesn't leave the player
  // with a cleared round but no points
  const pointsMap = {
    trivia: config.pointsTriviaWin,
    scramble: config.pointsScrambleWin,
    mathrace: config.pointsMathRaceWin,
  };
  const basePoints = pointsMap[game] ?? 40;

  await recordPlay(gameServerId, moduleId, pog.playerId, game);
  const { actualPoints, multiplier, currencyPaid, cappedByDaily, clippedByDaily } = await awardPoints({
    gameServerId, moduleId, pog, game, points: basePoints, config, playerName: player.name,
  });

  // Clear round AFTER awarding — if award fails, round stays active
  await clearActiveRound(gameServerId, moduleId);

  const boostNote = multiplier > 1 ? ` (boost ×${multiplier.toFixed(2)})` : '';
  const currencyNote = currencyPaid > 0 ? ` +${currencyPaid} currency` : '';
  const capNote = cappedByDaily
    ? ' Daily point cap reached — no points awarded.'
    : clippedByDaily
      ? ` Daily cap clipped reward to ${actualPoints} points.`
      : '';

  const emojiMap = { trivia: '❓', scramble: '🔤', mathrace: '➗' };
  const emoji = emojiMap[game] ?? '🎮';

  const winMsg = game === 'mathrace'
    ? `${emoji} CORRECT! @${player.name} = ${round.answer}. +${actualPoints} points${boostNote}${currencyNote}.${capNote}`
    : game === 'scramble'
      ? `${emoji} CORRECT! @${player.name} unscrambled ${round.answer.toUpperCase()}. +${actualPoints} points${boostNote}${currencyNote}.${capNote}`
      : `${emoji} CORRECT! @${player.name} wins. Answer: ${round.answer}. +${actualPoints} points${boostNote}${currencyNote}.${capNote}`;

  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: winMsg,
    opts: {},
  });
}

await main();
