import { data, takaro } from '@takaro/helpers';

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.id;

  // Read active round
  const r = await takaro.variable.variableControllerSearch({
    filters: { key: ['minigames_active_round'], moduleId: [moduleId], gameServerId: [gameServerId] },
    limit: 1,
  });

  if (r.data.data.length === 0) return;

  const roundVar = r.data.data[0];
  let round;
  try {
    round = JSON.parse(roundVar.value);
  } catch (e) {
    // Corrupt variable — delete it
    await takaro.variable.variableControllerDelete(roundVar.id);
    return;
  }

  // Check if expired
  if (!round.expiresAt) return;
  if (new Date() <= new Date(round.expiresAt)) return;

  // Round has expired with no winner — announce and clean up
  const emojiMap = {
    trivia: '❓',
    scramble: '🔤',
    mathrace: '➗',
    reactionrace: '⚡',
  };
  const emoji = emojiMap[round.game] || '🎮';

  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: `${emoji} Time's up! Nobody got it. The answer was: ${round.answer}`,
  });

  await takaro.variable.variableControllerDelete(roundVar.id);
}

await main();
