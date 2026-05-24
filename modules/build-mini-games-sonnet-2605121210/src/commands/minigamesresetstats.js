import { data, takaro, TakaroUserError, checkPermission } from '@takaro/helpers';

async function main() {
  const { pog, gameServerId } = data;
  const moduleId = data.module.moduleId;

  if (!checkPermission(pog, 'MINIGAMES_MANAGE')) {
    throw new TakaroUserError('You do not have permission to use this command.');
  }

  const targetPlayerId = data.arguments.player;

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

  const statsKey = `minigames_stats:${targetPlayerId}`;
  const existing = await readVar(statsKey);

  if (!existing) {
    await pog.pm('No stats found for that player.');
    return;
  }

  await deleteVar(existing.id);
  await pog.pm('✅ Stats reset for player.');
}

await main();
