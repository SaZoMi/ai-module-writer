import { data, takaro } from '@takaro/helpers';

async function main() {
  const { gameServerId, module: mod } = data;
  const moduleId = mod.id;

  async function varSearch(key) {
    const r = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] },
      page: { limit: 1 }
    });
    return r.data.data[0] || null;
  }

  async function varDelete(id) {
    return takaro.variable.variableControllerDelete(id);
  }

  async function broadcast(msg) {
    await takaro.gameserver.gameServerControllerSendMessage(gameServerId, { message: msg });
  }

  const roundV = await varSearch('minigames_active_round');
  if (!roundV) return; // No active round

  const round = JSON.parse(roundV.value);
  if (new Date(round.expiresAt) > new Date()) return; // Not expired yet

  // Round expired with no winner — announce
  const emoji = {
    trivia: '?', scramble: 'SCRAMBLE', mathrace: 'MATH', reactionrace: 'REACTION'
  }[round.game] || 'GAME';

  const answerText = round.answerType === 'number' ? String(round.answer) : round.answer;
  await broadcast('[' + emoji + '] Time\'s up! Nobody got it. The answer was: ' + answerText);

  // Clear the round
  await varDelete(roundV.id);
}

await main();
