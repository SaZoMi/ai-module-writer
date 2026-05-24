import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, gameServerId } = data;
  const moduleId = data.module.moduleId;

  if (!checkPermission(pog, 'MINIGAMES_MANAGE')) {
    throw new TakaroUserError('You do not have permission to use this command.');
  }

  async function readVar(key) {
    const res = await takaro.variable.variableControllerSearch({
      filters: { key: [key], gameServerId: [gameServerId], moduleId: [moduleId] },
      page: 0, limit: 1
    });
    return res.data.data.length > 0 ? { id: res.data.data[0].id, value: JSON.parse(res.data.data[0].value) } : null;
  }

  async function deleteVar(id) {
    await takaro.variable.variableControllerDelete(id);
  }

  const activeRound = await readVar('minigames_active_round');

  if (!activeRound) {
    await pog.pm('No active round to skip.');
    return;
  }

  await deleteVar(activeRound.id);

  await takaro.gameserver.gameServerControllerSendMessage(gameServerId, {
    message: '⏭️ Current round skipped by admin.'
  });

  await pog.pm('✅ Round skipped.');
}

await main();
