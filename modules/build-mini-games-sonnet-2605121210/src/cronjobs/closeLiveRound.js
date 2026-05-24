import { data, takaro } from '@takaro/helpers';

async function main() {
  const moduleId = data.module.moduleId;
  const { gameServerId } = data;

  // 1. Read minigames_active_round variable
  const roundRes = await takaro.variable.variableControllerSearch({
    filters: { key: ['minigames_active_round'], gameServerId: [gameServerId], moduleId: [moduleId] },
    page: 0, limit: 1
  });

  // 2. If not present, nothing to close
  if (roundRes.data.data.length === 0) {
    return;
  }

  const roundRecord = roundRes.data.data[0];
  const round = JSON.parse(roundRecord.value);

  // 3. If round is not yet expired, return
  if (round.expiresAt && new Date(round.expiresAt) > new Date()) {
    return;
  }

  // 4. Announce time's up
  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: `❌ Time's up! Nobody got it. The answer was: ${round.answer}`
  });

  // 5. Delete the active round record
  await takaro.variable.variableControllerDelete(roundRecord.id);
}

await main();
