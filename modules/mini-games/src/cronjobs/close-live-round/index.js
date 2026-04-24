import { data, takaro } from '@takaro/helpers';
import { getActiveRound, clearActiveRound } from './mini-games-helpers.js';

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.moduleId;

  const round = await getActiveRound(gameServerId, moduleId);
  if (!round) return;

  if (!round.expiresAt || new Date(round.expiresAt) > new Date()) return;

  // Round expired with no winner
  await clearActiveRound(gameServerId, moduleId);

  const emojiMap = { trivia: '❓', scramble: '🔤', mathrace: '➗', reactionrace: '⚡' };
  const emoji = emojiMap[round.game] ?? '🎮';

  const answerDisplay = Array.isArray(round.answer)
    ? round.answer.join(', ')
    : String(round.answer);

  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: `${emoji} Time's up! Nobody got it. The answer was: ${answerDisplay}.`,
    opts: {},
  });

  console.log(`miniGames closeLiveRound: closed expired round game=${round.game}, answer=${answerDisplay}`);
}

await main();
