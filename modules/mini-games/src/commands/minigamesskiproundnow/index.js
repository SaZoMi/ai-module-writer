import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';
import { getActiveRound, clearActiveRound } from './mini-games-helpers.js';

async function main() {
  const { pog, gameServerId, module: mod } = data;

  if (!checkPermission(pog, 'MINIGAMES_MANAGE')) {
    throw new TakaroUserError('You do not have permission to manage mini-games.');
  }

  const moduleId = mod.moduleId;
  const round = await getActiveRound(gameServerId, moduleId);

  if (!round) {
    throw new TakaroUserError('There is no active live round to cancel.');
  }

  await clearActiveRound(gameServerId, moduleId);

  const emojiMap = { trivia: '❓', scramble: '🔤', mathrace: '➗', reactionrace: '⚡' };
  const emoji = emojiMap[round.game] ?? '🎮';

  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: `${emoji} Round cancelled by admin. The answer was: ${round.answer}.`,
    opts: {},
  });
}

await main();
